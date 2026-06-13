// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Chapter file I/O and chapter-shaped primitives shared by the story
 * engine. Kept in its own module so that `story-prompt-builder.ts` and
 * `story.ts` can both depend on these helpers without forming an import
 * cycle.
 *
 * Exports:
 *
 * - {@link ContinuePromptError} — internal error thrown by the continue
 *   flow's prompt builder; translated to a user-facing `ChatError` higher
 *   up.
 * - {@link parseChapterForContinue} — split a chapter file into the
 *   trailing user_message text and the assistant prefill remainder.
 * - {@link listChapterFiles} — list `NNN.md` files in a story directory.
 * - {@link atomicWriteChapter} — temp-file-and-rename chapter write.
 * - {@link copyChapterFile} — copy a chapter file between story
 *   directories, atomic on the destination.
 * - {@link resolveTargetChapterNumber} — single source of truth for the
 *   "what chapter number gets written next" rule.
 */

import { join } from "@std/path";
import { createLogger } from "./logger.ts";
import { pruneUsage } from "./usage.ts";
import type { ChapterEntry } from "../types.ts";

const log = createLogger("file");

/**
 * Internal error thrown by `buildContinuePromptFromStory` to signal a
 * user-facing failure. `executeContinue` translates this into a `ChatError`.
 * Defined here (rather than importing `ChatError` from `chat-shared.ts`) to
 * avoid a circular import — `chat-shared.ts` already imports helpers from
 * the story module surface.
 */
export class ContinuePromptError extends Error {
  override readonly name = "ContinuePromptError";
  constructor(
    public readonly code: "no-chapter" | "no-content",
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
  }
}

/**
 * Parse a chapter file content for the continue flow, splitting it into the
 * (first) `<user_message>` body and the surrounding prose that becomes the
 * assistant prefill.
 *
 * Behaviour:
 *  - The match is **case-insensitive** and **non-greedy**, so manually-edited
 *    tag variants like `<USER_MESSAGE>` are still recognised (mirrors
 *    `stripPromptTags()` semantics) and only the FIRST block is treated as
 *    the user input. Subsequent `<user_message>` blocks remain in the
 *    prefill remainder and are removed by `stripPromptTags`.
 *  - When the first block is found, `userMessageText` is its inner content
 *    (trimmed), and `assistantPrefill` is the rest of the chapter with that
 *    match removed, then run through `stripPromptTags` and trimmed.
 *  - When no block is present, `userMessageText = ""` and
 *    `assistantPrefill = stripPromptTags(rawContent).trim()`.
 *  - A literal `</user_message>` inside the user-message body is **not**
 *    supported: the regex stops at the first close tag, so the remainder
 *    leaks into `assistantPrefill`. This is intentional and pinned by tests.
 */
export function parseChapterForContinue(
  rawContent: string,
  stripPromptTags: (s: string) => string,
): { userMessageText: string; assistantPrefill: string } {
  const re = /<user_message>([\s\S]*?)<\/user_message>/i;
  const m = rawContent.match(re);
  if (m) {
    const userMessageText = (m[1] ?? "").trim();
    const remainder = rawContent.slice(0, m.index ?? 0) +
      rawContent.slice((m.index ?? 0) + m[0].length);
    const assistantPrefill = stripPromptTags(remainder).trim();
    return { userMessageText, assistantPrefill };
  }
  return {
    userMessageText: "",
    assistantPrefill: stripPromptTags(rawContent).trim(),
  };
}

/**
 * List chapter files (`NNN.md`) in the given directory, sorted by numeric order.
 *
 * Returns an empty array when the directory does not exist or cannot be read.
 *
 * @param dir - Absolute path to the story directory.
 * @returns Sorted array of chapter filenames like `["001.md", "002.md", …]`.
 */
export async function listChapterFiles(dir: string): Promise<string[]> {
  const entries: string[] = [];
  try {
    for await (const entry of Deno.readDir(dir)) {
      entries.push(entry.name);
    }
  } catch (err: unknown) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  return entries
    .filter((f) => /^\d+\.md$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

/**
 * Result of {@link deleteLastChapter}. On success it carries the deleted
 * chapter number; on a no-op it explains why so the caller can map it to a
 * transport-appropriate client response.
 */
export type DeleteLastChapterResult =
  | { ok: true; deleted: number }
  | { ok: false; reason: "no-chapters" };

/**
 * Delete a story's highest-numbered chapter and reconcile its side artifacts.
 *
 * This is the single shared implementation behind both the HTTP
 * `DELETE /api/stories/:series/:name/chapters/last` route and the WebSocket
 * `chat:resend` path so the two transports behave identically. It:
 *
 *  1. lists chapter files via {@link listChapterFiles};
 *  2. removes the highest-numbered `NNN.md` file;
 *  3. best-effort removes its sidecar artifacts (`NNN-state.yaml`,
 *     `NNN-state-diff.yaml`, `current-status.yaml`) without failing when any
 *     is absent; and
 *  4. prunes the deleted chapter's usage record via
 *     `pruneUsage(dirPath, lastNum - 1)`.
 *
 * The caller owns the active-generation guard and the client-response
 * mapping: the helper is intentionally transport-agnostic. Filesystem errors
 * other than the best-effort sidecar cleanups propagate to the caller's catch
 * block.
 *
 * @param dirPath - Absolute path to the story directory.
 * @returns `{ ok: true, deleted }` on success, or
 *   `{ ok: false, reason: "no-chapters" }` when no chapter files exist.
 */
export async function deleteLastChapter(dirPath: string): Promise<DeleteLastChapterResult> {
  const chapterFiles = await listChapterFiles(dirPath);
  if (chapterFiles.length === 0) {
    return { ok: false, reason: "no-chapters" };
  }

  const lastFile = chapterFiles[chapterFiles.length - 1]!;
  const lastNum = parseInt(lastFile, 10);
  const deletePath = join(dirPath, lastFile);
  await Deno.remove(deletePath);
  log.info("Chapter deleted", { op: "delete", path: deletePath, chapter: lastNum });

  // Best-effort cleanup of state/diff artifacts for the deleted chapter.
  const paddedNum = String(lastNum).padStart(3, "0");
  await Promise.allSettled([
    Deno.remove(join(dirPath, `${paddedNum}-state.yaml`)),
    Deno.remove(join(dirPath, `${paddedNum}-state-diff.yaml`)),
    Deno.remove(join(dirPath, "current-status.yaml")),
  ]);

  // Keep usage records aligned with the remaining chapters.
  await pruneUsage(dirPath, lastNum - 1);

  return { ok: true, deleted: lastNum };
}

/**
 * Atomically write a chapter file by staging a temp file in the same
 * directory and renaming it over the target path.
 *
 * The temp file name includes a UUID to avoid collisions between concurrent
 * writers. On any failure the temp file is best-effort removed.
 *
 * @param dirPath - Absolute path to the story directory.
 * @param chapterFile - Chapter filename such as `"003.md"`.
 * @param content - New chapter content to write.
 */
export async function atomicWriteChapter(
  dirPath: string,
  chapterFile: string,
  content: string,
): Promise<void> {
  const tmpName = `${chapterFile}.tmp-${crypto.randomUUID()}`;
  const tmpPath = join(dirPath, tmpName);
  const finalPath = join(dirPath, chapterFile);
  let renamed = false;
  try {
    await Deno.writeTextFile(tmpPath, content, { mode: 0o664 });
    await Deno.rename(tmpPath, finalPath);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        await Deno.remove(tmpPath);
      } catch {
        // temp file may not exist; ignore
      }
    }
  }
}

/**
 * Copy a chapter file from one story directory to another via
 * `atomicWriteChapter`, preserving the default chapter file mode.
 *
 * @param srcDir - Absolute path to the source story directory.
 * @param dstDir - Absolute path to the destination story directory.
 * @param chapterFile - Chapter filename such as `"003.md"`.
 */
export async function copyChapterFile(
  srcDir: string,
  dstDir: string,
  chapterFile: string,
): Promise<void> {
  const content = await Deno.readTextFile(join(srcDir, chapterFile));
  await atomicWriteChapter(dstDir, chapterFile, content);
}

/**
 * Resolve the 1-based chapter number that the next write will target.
 *
 * Rule: if the last chapter file is empty, reuse its number; otherwise use
 * `max(existing numbers) + 1`; when no chapter files exist, return `1`.
 *
 * This helper is the single source of truth for the target-chapter policy
 * shared by `buildPromptFromStory()` (for plugin context) and
 * `executeChat()` (for the actual write target).
 *
 * @param chapterFiles - Ordered `NNN.md` filenames already loaded from disk.
 * @param chapters - Parsed chapter entries aligned with `chapterFiles`.
 * @returns 1-based chapter number.
 */
export function resolveTargetChapterNumber(
  chapterFiles: readonly string[],
  chapters: readonly ChapterEntry[],
): number {
  const lastFile = chapterFiles[chapterFiles.length - 1];
  const lastChapter = chapters[chapters.length - 1];
  if (lastFile && lastChapter && lastChapter.content.trim() === "") {
    return parseInt(lastFile, 10);
  }
  if (chapterFiles.length === 0) return 1;
  return Math.max(...chapterFiles.map((f) => parseInt(f, 10))) + 1;
}

// Re-export the file logger so callers in the same logical "file" channel
// (e.g. story-prompt-builder) can share the channel without re-deriving it.
export { log as fileLog };
