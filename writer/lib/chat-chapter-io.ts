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
import type {
  PostResponsePayload,
  TokenUsageRecord,
} from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";
import type { Logger } from "./logger.ts";
import {
  atomicWriteChapter,
  listChapterFiles,
} from "./story.ts";
import { appendUsage } from "./usage.ts";
import { ChatError, type WriteMode } from "./chat-types.ts";
import { deepFreeze } from "./chat-llm-fetch.ts";

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
    throw new ChatError("no-chapter", `Cannot ${verb}: no existing chapter file in story directory`, 400);
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
      file = await Deno.open(chapterPath, { write: true, create: true, truncate: true, mode: 0o664 });
      if (preContent) {
        await file.write(encoder.encode(preContent));
      }
      return { file, preContent };
    } catch (err) {
      try { file?.close(); } catch { /* nothing actionable; original error wins */ }
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
      try { file?.close(); } catch { /* nothing actionable; original error wins */ }
      if (err instanceof Deno.errors.NotFound) {
        throw new ChatError("no-chapter", "Cannot continue: chapter file no longer exists", 400);
      }
      throw err;
    }
  }

  return { file: null, preContent: "" };
}

/**
 * Mode-specific finalization that runs AFTER the streaming loop succeeded
 * (no abort, content seen). For each chapter-writing mode it performs the
 * required on-disk persistence (atomic-write for append/replace; nothing
 * extra for the modes that already wrote during streaming), appends the
 * usage record, and dispatches the `post-response` hook with a frozen
 * payload whose `usage` is a clone (so subsequent local mutation of the
 * usage ledger doesn't leak into observer plugins). `discard` mode is a
 * no-op.
 *
 * Returns the post-state chapter content (re-read from disk for the
 * modes that write during streaming, derived directly for modes that
 * compute the new chapter content here), or `null` for `discard`.
 */
export async function finalizeStreamMode(args: {
  writeMode: WriteMode;
  target: ChapterTarget;
  aiContent: string;
  fullContent: string;
  usage: TokenUsageRecord | null;
  endpoint: string;
  storyCtx: StoryContext;
  hookDispatcher: HookDispatcher;
  reqFileLog: Logger;
  encoder: TextEncoder;
}): Promise<string | null> {
  const {
    writeMode,
    target,
    aiContent,
    fullContent,
    usage,
    endpoint,
    storyCtx,
    hookDispatcher,
    reqFileLog,
    encoder,
  } = args;
  const { chapterPath, targetNum } = target;
  const { storyDir, rootDir, series, name, correlationId } = storyCtx;

  // Pre-clone the usage record so the value reachable through the frozen
  // hook payload stays independent of the local mutable record that
  // append-to-`_usage.json` may continue to touch.
  const usageForDispatch: TokenUsageRecord | null = usage === null
    ? null
    : structuredClone(usage);

  function buildPostResponsePayload(
    base: Omit<PostResponsePayload, "usage" | "endpoint">,
  ): Readonly<PostResponsePayload> {
    const payload: PostResponsePayload = {
      ...base,
      endpoint,
      usage: usageForDispatch,
    };
    return deepFreeze(payload);
  }

  if (writeMode.kind === "write-new-chapter" && chapterPath !== null && targetNum !== null) {
    reqFileLog.info("Chapter file written", {
      op: "write",
      path: chapterPath,
      bytes: encoder.encode(fullContent).length,
    });

    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    const chapterContentAfter = fullContent;

    await hookDispatcher.dispatch(
      "post-response",
      buildPostResponsePayload({
        correlationId,
        content: fullContent,
        storyDir,
        series,
        name,
        rootDir,
        chapterNumber: targetNum,
        chapterPath,
        source: "chat",
      }) as unknown as Record<string, unknown>,
    );

    return chapterContentAfter;
  }

  if (writeMode.kind === "append-to-existing-chapter" && chapterPath !== null && targetNum !== null) {
    const { appendTag, pluginName } = writeMode;
    const normalised = normaliseAppendContent(aiContent, appendTag);
    const wrapped = `\n<${appendTag}>\n${normalised}\n</${appendTag}>\n`;

    const existingChapter = await Deno.readTextFile(chapterPath);
    const newChapterContent = existingChapter + wrapped;
    const padded = String(targetNum).padStart(3, "0");
    await atomicWriteChapter(storyDir, `${padded}.md`, newChapterContent);
    const chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file appended (plugin-action)", {
      op: "append",
      path: chapterPath,
      appendedTag: appendTag,
      pluginName,
    });

    // Parity with the other three success branches: append the usage
    // record BEFORE dispatching `post-response` so subscribers that
    // re-read `_usage.json` (legacy path) and subscribers that read
    // `ctx.usage` (new path) observe a consistent ledger state.
    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    await hookDispatcher.dispatch(
      "post-response",
      buildPostResponsePayload({
        correlationId,
        content: chapterContentAfter,
        storyDir,
        series,
        name,
        rootDir,
        chapterNumber: targetNum,
        chapterPath,
        source: "plugin-action",
        pluginName,
        appendedTag: appendTag,
      }) as unknown as Record<string, unknown>,
    );

    return chapterContentAfter;
  }

  if (writeMode.kind === "continue-last-chapter" && chapterPath !== null && targetNum !== null) {
    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    // Re-read the chapter file from disk to obtain the FULL updated content
    // (original pre-continue bytes + everything appended during this stream).
    const chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file appended (continue)", {
      op: "append",
      path: chapterPath,
      bytes: encoder.encode(aiContent).length,
    });

    await hookDispatcher.dispatch(
      "post-response",
      buildPostResponsePayload({
        correlationId,
        content: chapterContentAfter,
        storyDir,
        series,
        name,
        rootDir,
        chapterNumber: targetNum,
        chapterPath,
        source: "continue",
      }) as unknown as Record<string, unknown>,
    );

    return chapterContentAfter;
  }

  if (writeMode.kind === "replace-last-chapter" && chapterPath !== null && targetNum !== null) {
    const { pluginName } = writeMode;
    const padded = String(targetNum).padStart(3, "0");
    // Atomic replace: only commit AFTER the stream completes successfully.
    // Aborts / errors are caught by upstream try/catch blocks and the
    // pre-existing file remains untouched (no file handle was opened
    // during the stream phase for this mode).
    const newContent = aiContent.trimEnd() + "\n";
    await atomicWriteChapter(storyDir, `${padded}.md`, newContent);

    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    const chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file replaced (plugin-action)", {
      op: "replace",
      path: chapterPath,
      pluginName,
      bytes: encoder.encode(newContent).length,
    });

    await hookDispatcher.dispatch(
      "post-response",
      buildPostResponsePayload({
        correlationId,
        content: chapterContentAfter,
        storyDir,
        series,
        name,
        rootDir,
        chapterNumber: targetNum,
        chapterPath,
        source: "plugin-action",
        pluginName,
      }) as unknown as Record<string, unknown>,
    );

    return chapterContentAfter;
  }

  // discard: no chapter mutation, no hook dispatch
  return null;
}

/**
 * Strip exactly one matching outer `<{tag}>…</{tag}>` wrapper from `content`
 * (after trimming) when present, then re-trim. If no matching outer wrapper
 * is present (or the wrapper is malformed), returns the trimmed content
 * unchanged. Only ONE outer layer is ever stripped — legitimately nested
 * same-name elements are preserved.
 */
export function normaliseAppendContent(content: string, appendTag: string): string {
  const trimmed = content.trim();
  const escaped = appendTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wrapperRe = new RegExp(
    `^<${escaped}\\b[^>]*>([\\s\\S]*)</${escaped}>\\s*$`,
  );
  const match = trimmed.match(wrapperRe);
  if (match) {
    return (match[1] ?? "").trim();
  }
  return trimmed;
}
