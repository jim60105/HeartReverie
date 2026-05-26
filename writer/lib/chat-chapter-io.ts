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

import { join } from "@std/path";
import type { HookDispatcher } from "./hooks.ts";
import type { Logger } from "./logger.ts";
import { listChapterFiles } from "./story.ts";
import { ChatError, type WriteMode } from "./chat-types.ts";

/**
 * Story-scoped request context shared across the post-stream helpers.
 * Bundled so callers don't have to thread five fields through each helper
 * (and so future additions don't churn every signature).
 */
export type StoryContext = {
  readonly storyDir: string;
  readonly rootDir: string;
  readonly series: string;
  readonly name: string;
  readonly correlationId: string;
};

/**
 * Resolved chapter target for the current write mode. Both fields are
 * `null` for `discard` mode (no chapter ever touched).
 */
export type ChapterTarget = {
  readonly chapterPath: string | null;
  readonly targetNum: number | null;
};

/**
 * Resolve the target chapter file for a given `writeMode`.
 *
 * Non-mutating resolution — no filesystem writes. The caller is responsible
 * for any mode-specific side effects (e.g., `mkdir` for `write-new-chapter`).
 *
 * Returns `{ targetNum: null, chapterPath: null }` for modes that don't
 * touch a chapter file on disk (currently only `discard`).
 *
 * Throws `ChatError("no-chapter", …, 400)` when an append/replace mode is
 * requested but no chapter file exists in `storyDir`.
 */
export async function resolveChapterTarget(
  writeMode: WriteMode,
  storyDir: string,
): Promise<{ targetNum: number | null; chapterPath: string | null }> {
  switch (writeMode.kind) {
    case "write-new-chapter":
    case "continue-last-chapter": {
      const targetNum = writeMode.targetChapterNumber;
      const padded = String(targetNum).padStart(3, "0");
      return { targetNum, chapterPath: join(storyDir, `${padded}.md`) };
    }
    case "append-to-existing-chapter":
      return await resolveLastChapter(storyDir, "append");
    case "replace-last-chapter":
      return await resolveLastChapter(storyDir, "replace");
    case "discard":
      return { targetNum: null, chapterPath: null };
  }
}

/** Locate the highest-numbered chapter file in `storyDir`. */
async function resolveLastChapter(
  storyDir: string,
  action: "append" | "replace",
): Promise<{ targetNum: number; chapterPath: string }> {
  const chapterFiles = await listChapterFiles(storyDir);
  if (chapterFiles.length === 0) {
    const verb = action === "append" ? "append" : "replace";
    throw new ChatError(
      "no-chapter",
      `Cannot ${verb}: no existing chapter file in story directory`,
      400,
    );
  }
  const lastFile = chapterFiles[chapterFiles.length - 1]!;
  return { targetNum: parseInt(lastFile, 10), chapterPath: join(storyDir, lastFile) };
}

/**
 * Prepare the on-disk chapter file BEFORE streaming starts. Two branches
 * have side effects; other modes are a no-op.
 *
 * - `write-new-chapter` dispatches the `pre-write` hook (which may rewrite
 *   `preContent`), opens the target path with `truncate`, and writes the
 *   pre-content bytes.
 * - `continue-last-chapter` runs the snapshot guard (re-reads disk and
 *   compares against `writeMode.existingContent`; mismatch → 409) and
 *   opens the file in append mode.
 *
 * **Ownership:** on successful return the caller owns the returned `file`
 * handle (must `.close()` it). On any throw after the helper opened a
 * handle internally, the helper closes the handle itself so leak-free
 * recovery is guaranteed.
 */
export async function openChapterForStream(args: {
  writeMode: WriteMode;
  target: ChapterTarget;
  storyCtx: StoryContext;
  hookDispatcher: HookDispatcher;
  reqFileLog: Logger;
  encoder: TextEncoder;
}): Promise<{ file: Deno.FsFile | null; preContent: string }> {
  const { writeMode, target, storyCtx, hookDispatcher, reqFileLog, encoder } = args;
  const { chapterPath, targetNum } = target;
  const { storyDir, series, name, correlationId } = storyCtx;

  if (writeMode.kind === "write-new-chapter" && chapterPath !== null && targetNum !== null) {
    reqFileLog.info("Writing chapter file", { op: "write", path: chapterPath, chapter: targetNum });

    const preWriteCtx = await hookDispatcher.dispatch("pre-write", {
      correlationId,
      message: writeMode.userMessage,
      chapterPath,
      storyDir,
      series,
      name,
      preContent: "",
    });
    const preContent = typeof preWriteCtx.preContent === "string" ? preWriteCtx.preContent : "";

    let file: Deno.FsFile | null = null;
    try {
      file = await Deno.open(chapterPath, {
        write: true,
        create: true,
        truncate: true,
        mode: 0o664,
      });
      if (preContent) {
        await file.write(encoder.encode(preContent));
      }
      return { file, preContent };
    } catch (err) {
      try {
        file?.close();
      } catch { /* nothing actionable; original error wins */ }
      throw err;
    }
  }

  if (writeMode.kind === "continue-last-chapter" && chapterPath !== null && targetNum !== null) {
    let onDiskContent: string;
    try {
      onDiskContent = await Deno.readTextFile(chapterPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new ChatError("no-chapter", "Cannot continue: chapter file no longer exists", 400);
      }
      throw err;
    }
    if (onDiskContent !== writeMode.existingContent) {
      throw new ChatError(
        "conflict",
        "Latest chapter changed during continue; please retry",
        409,
      );
    }

    reqFileLog.info("Appending to chapter file (continue)", {
      op: "append",
      path: chapterPath,
      chapter: targetNum,
    });

    let file: Deno.FsFile | null = null;
    try {
      file = await Deno.open(chapterPath, { write: true, append: true, mode: 0o664 });
      return { file, preContent: "" };
    } catch (err) {
      try {
        file?.close();
      } catch { /* nothing actionable; original error wins */ }
      if (err instanceof Deno.errors.NotFound) {
        throw new ChatError("no-chapter", "Cannot continue: chapter file no longer exists", 400);
      }
      throw err;
    }
  }

  return { file: null, preContent: "" };
}

// Mode-specific finalization + content-normalisation helpers live in a
// sibling module; re-export here so existing call sites in chat-shared.ts
// (and any downstream consumers) keep working without churn.
export { finalizeStreamMode, normaliseAppendContent } from "./chat-chapter-finalize.ts";
