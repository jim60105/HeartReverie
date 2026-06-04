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
 * Post-stream finalization for chat write modes. Owns the four mode
 * branches that persist the chapter, append the usage record, and
 * dispatch the `post-response` hook. Extracted from `chat-chapter-io.ts`
 * so each branch's persistence policy can be read in isolation.
 *
 * Strict ordering rules preserved across all branches:
 *  1. Persist chapter bytes (atomic-write for append/replace; no-op for
 *     modes that wrote during streaming).
 *  2. Re-read the chapter (or use `fullContent` for write-new where the
 *     stream wrote directly to the open handle).
 *  3. Append the usage record BEFORE the hook dispatch so subscribers
 *     that re-read `_usage.json` and subscribers that read `ctx.usage`
 *     observe a consistent ledger state.
 *  4. Dispatch `post-response` with a deep-frozen payload whose `usage`
 *     is a `structuredClone` of the local record (so subsequent ledger
 *     writes can't leak through observer plugins).
 */

import type { PostResponsePayload, TokenUsageRecord } from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";
import type { Logger } from "./logger.ts";
import { atomicWriteChapter } from "./story.ts";
import { appendUsage } from "./usage.ts";
import type { WriteMode } from "./chat-types.ts";
import { deepFreeze } from "./chat-llm-fetch.ts";
import type { ChapterTarget, StoryContext } from "./chat-chapter-io.ts";

/**
 * Strip exactly one matching outer `<{tag}>…</{tag}>` wrapper from `content`
 * (after trimming) when present, then re-trim. If no matching outer wrapper
 * is present (or the wrapper is malformed), returns the trimmed content
 * unchanged. Only ONE outer layer is ever stripped — legitimately nested
 * same-name elements are preserved.
 */
export function normaliseAppendContent(
  content: string,
  appendTag: string,
): string {
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

/** Args common to every per-mode finalizer. */
interface FinalizeArgs {
  readonly chapterPath: string;
  readonly targetNum: number;
  readonly aiContent: string;
  readonly fullContent: string;
  readonly usage: TokenUsageRecord | null;
  readonly usageForDispatch: TokenUsageRecord | null;
  readonly endpoint: string;
  readonly storyCtx: StoryContext;
  readonly hookDispatcher: HookDispatcher;
  readonly reqFileLog: Logger;
  readonly encoder: TextEncoder;
}

/**
 * Append the usage record (if any) and dispatch `post-response` with a
 * deep-frozen payload. Centralised so the ordering invariant
 * (`appendUsage` BEFORE `dispatch`) is structurally hard to violate.
 */
async function persistUsageAndDispatch(
  args: {
    readonly storyDir: string;
    readonly endpoint: string;
    readonly usage: TokenUsageRecord | null;
    readonly usageForDispatch: TokenUsageRecord | null;
    readonly hookDispatcher: HookDispatcher;
    readonly base: Omit<PostResponsePayload, "usage" | "endpoint">;
  },
): Promise<void> {
  if (args.usage !== null) {
    await appendUsage(args.storyDir, args.usage);
  }
  const payload: PostResponsePayload = {
    ...args.base,
    endpoint: args.endpoint,
    usage: args.usageForDispatch,
  };
  await args.hookDispatcher.dispatch(
    "post-response",
    deepFreeze(payload) as unknown as Record<string, unknown>,
  );
}

async function finalizeWriteNewChapter(args: FinalizeArgs): Promise<string> {
  const {
    chapterPath,
    targetNum,
    fullContent,
    storyCtx,
    hookDispatcher,
    reqFileLog,
    encoder,
    endpoint,
    usage,
    usageForDispatch,
  } = args;
  const { storyDir, rootDir, series, name, correlationId } = storyCtx;

  reqFileLog.info("Chapter file written", {
    op: "write",
    path: chapterPath,
    bytes: encoder.encode(fullContent).length,
  });

  await persistUsageAndDispatch({
    storyDir,
    endpoint,
    usage,
    usageForDispatch,
    hookDispatcher,
    base: {
      correlationId,
      content: fullContent,
      storyDir,
      series,
      name,
      rootDir,
      chapterNumber: targetNum,
      chapterPath,
      source: "chat",
    },
  });

  return fullContent;
}

async function finalizeAppendToExisting(
  args: FinalizeArgs & {
    readonly appendTag: string | null;
    readonly pluginName: string;
  },
): Promise<string> {
  const {
    chapterPath,
    targetNum,
    aiContent,
    appendTag,
    pluginName,
    storyCtx,
    hookDispatcher,
    reqFileLog,
    endpoint,
    usage,
    usageForDispatch,
  } = args;
  const { storyDir, rootDir, series, name, correlationId } = storyCtx;

  // Tagless append (`appendTag === null`): trim and append the model output
  // verbatim with NO wrapper element and NO wrapper-stripping pass, so any
  // XML tags the model emitted (e.g. multiple `<image>` blocks) survive
  // exactly. Tagged append keeps the existing single-outer-strip + re-wrap.
  const normalised = appendTag === null
    ? aiContent.trim()
    : normaliseAppendContent(aiContent, appendTag);
  const wrapped = appendTag === null
    ? `\n${normalised}\n`
    : `\n<${appendTag}>\n${normalised}\n</${appendTag}>\n`;
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

  await persistUsageAndDispatch({
    storyDir,
    endpoint,
    usage,
    usageForDispatch,
    hookDispatcher,
    base: {
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
    },
  });

  return chapterContentAfter;
}

async function finalizeContinueLastChapter(
  args: FinalizeArgs,
): Promise<string> {
  const {
    chapterPath,
    targetNum,
    aiContent,
    storyCtx,
    hookDispatcher,
    reqFileLog,
    encoder,
    endpoint,
    usage,
    usageForDispatch,
  } = args;
  const { storyDir, rootDir, series, name, correlationId } = storyCtx;

  // Re-read the chapter file from disk to obtain the FULL updated content
  // (original pre-continue bytes + everything appended during this stream).
  const chapterContentAfter = await Deno.readTextFile(chapterPath);

  reqFileLog.info("Chapter file appended (continue)", {
    op: "append",
    path: chapterPath,
    bytes: encoder.encode(aiContent).length,
  });

  await persistUsageAndDispatch({
    storyDir,
    endpoint,
    usage,
    usageForDispatch,
    hookDispatcher,
    base: {
      correlationId,
      content: chapterContentAfter,
      storyDir,
      series,
      name,
      rootDir,
      chapterNumber: targetNum,
      chapterPath,
      source: "continue",
    },
  });

  return chapterContentAfter;
}

async function finalizeReplaceLastChapter(
  args: FinalizeArgs & { readonly pluginName: string },
): Promise<string> {
  const {
    chapterPath,
    targetNum,
    aiContent,
    pluginName,
    storyCtx,
    hookDispatcher,
    reqFileLog,
    encoder,
    endpoint,
    usage,
    usageForDispatch,
  } = args;
  const { storyDir, rootDir, series, name, correlationId } = storyCtx;

  const padded = String(targetNum).padStart(3, "0");
  // Atomic replace: only commit AFTER the stream completes successfully.
  // Aborts / errors are caught by upstream try/catch blocks and the
  // pre-existing file remains untouched (no file handle was opened
  // during the stream phase for this mode).
  const newContent = aiContent.trimEnd() + "\n";
  await atomicWriteChapter(storyDir, `${padded}.md`, newContent);

  const chapterContentAfter = await Deno.readTextFile(chapterPath);

  reqFileLog.info("Chapter file replaced (plugin-action)", {
    op: "replace",
    path: chapterPath,
    pluginName,
    bytes: encoder.encode(newContent).length,
  });

  await persistUsageAndDispatch({
    storyDir,
    endpoint,
    usage,
    usageForDispatch,
    hookDispatcher,
    base: {
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
    },
  });

  return chapterContentAfter;
}

/**
 * Mode-specific finalization that runs AFTER the streaming loop succeeded
 * (no abort, content seen). Routes to the appropriate per-mode helper.
 *
 * Returns the post-state chapter content, or `null` for `discard` and for
 * non-discard modes that arrive with an unresolved target (defensive — the
 * preceding pipeline never produces this combination in practice).
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
  const { writeMode, target, usage } = args;
  const { chapterPath, targetNum } = target;

  if (writeMode.kind === "discard") return null;
  if (chapterPath === null || targetNum === null) return null;

  // Pre-clone the usage record so the value reachable through the frozen
  // hook payload stays independent of the local mutable record that
  // append-to-`_usage.json` may continue to touch.
  const usageForDispatch: TokenUsageRecord | null = usage === null ? null : structuredClone(usage);

  const common: FinalizeArgs = {
    chapterPath,
    targetNum,
    aiContent: args.aiContent,
    fullContent: args.fullContent,
    usage: args.usage,
    usageForDispatch,
    endpoint: args.endpoint,
    storyCtx: args.storyCtx,
    hookDispatcher: args.hookDispatcher,
    reqFileLog: args.reqFileLog,
    encoder: args.encoder,
  };

  switch (writeMode.kind) {
    case "write-new-chapter":
      return await finalizeWriteNewChapter(common);
    case "append-to-existing-chapter":
      return await finalizeAppendToExisting({
        ...common,
        appendTag: writeMode.appendTag,
        pluginName: writeMode.pluginName,
      });
    case "continue-last-chapter":
      return await finalizeContinueLastChapter(common);
    case "replace-last-chapter":
      return await finalizeReplaceLastChapter({
        ...common,
        pluginName: writeMode.pluginName,
      });
  }
}
