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
 * Prompt builders for the standard chat flow and the continue-last-chapter
 * flow. Extracted from `createStoryEngine` so the engine factory can stay a
 * thin DI wrapper. Both builders share:
 *
 * - {@link loadChaptersForPrompt} — list + cap + read the chapter files
 *   that participate in this prompt assembly call.
 * - A `prompt-assembly` hook dispatch with the same context shape, giving
 *   plugins one place to mutate `previousContext` regardless of flow.
 *
 * Each builder receives its environment via an explicit {@link PromptDeps}
 * struct: `stripPromptTags`, `renderSystemPrompt`, and `hookDispatcher`.
 * No closures over `PluginManager` or any other engine collaborator are
 * needed.
 */

import { join } from "@std/path";
import {
  ContinuePromptError,
  fileLog as log,
  listChapterFiles,
  parseChapterForContinue,
  resolveTargetChapterNumber,
} from "./story-chapter-io.ts";
import type { HookDispatcher } from "./hooks.ts";
import type {
  BuildPromptResult,
  ChapterEntry,
  ChatMessage,
  ContinuePromptResult,
  RenderOptions,
  RenderResult,
} from "../types.ts";

/** Maximum number of chapters retained for prompt assembly. */
const MAX_CHAPTERS = 200;

export interface PromptDeps {
  readonly stripPromptTags: (s: string) => string;
  readonly renderSystemPrompt: (
    series: string,
    story?: string,
    options?: RenderOptions,
  ) => Promise<RenderResult>;
  readonly hookDispatcher: HookDispatcher;
}

/**
 * Shared chapter-loading helper for the two prompt builders.
 *
 * Lists the directory, caps the result to the most recent {@link
 * MAX_CHAPTERS} chapter files, and reads each retained file. The caller is
 * responsible for emitting any flow-specific log messages around the call
 * to preserve the original log line shape per flow.
 */
async function loadChaptersForPrompt(
  storyDir: string,
): Promise<{
  chapterFiles: string[];
  chapters: ChapterEntry[];
  totalChapterCount: number;
}> {
  let chapterFiles: string[] = await listChapterFiles(storyDir);
  const totalChapterCount = chapterFiles.length;

  if (chapterFiles.length > MAX_CHAPTERS) {
    chapterFiles = chapterFiles.slice(-MAX_CHAPTERS);
  }

  const chapters: ChapterEntry[] = [];
  for (const f of chapterFiles) {
    const content = await Deno.readTextFile(join(storyDir, f));
    chapters.push({ number: parseInt(f, 10), content });
  }

  return { chapterFiles, chapters, totalChapterCount };
}

/**
 * Shared prompt construction logic for chat and preview endpoints. Reads
 * chapters, strips tags, detects first-round, renders prompt.
 *
 * @returns build result containing `{ messages, previousContext,
 * isFirstRound, ventoError, chapterFiles, chapters }`.
 */
export async function buildPromptFromStory(
  deps: PromptDeps,
  series: string,
  name: string,
  storyDir: string,
  message: string,
  template?: string,
  extraVariables?: Record<string, unknown>,
  correlationId?: string,
): Promise<BuildPromptResult> {
  const { stripPromptTags, renderSystemPrompt, hookDispatcher } = deps;
  // Mint a correlationId when callers don't supply one so the
  // prompt-assembly hook context always observes a non-empty value.
  const effectiveCorrelationId = correlationId ?? crypto.randomUUID();

  const { chapterFiles, chapters, totalChapterCount } =
    await loadChaptersForPrompt(storyDir);
  log.debug("Read story directory", {
    path: storyDir,
    chapterCount: chapterFiles.length,
  });
  log.debug("Loaded chapters for prompt building", {
    series,
    story: name,
    totalChapters: chapters.length,
    nonEmpty: chapters.filter((ch) => ch.content.trim().length > 0).length,
  });

  const isFirstRound: boolean = chapters.every((ch) =>
    ch.content.trim() === ""
  );

  // Compute target chapter number + previous content for plugin context.
  // `previousContent` is the *unstripped* content of the chapter immediately
  // preceding the target: if the target reuses a trailing empty file, use
  // the last non-empty chapter; otherwise use the last chapter on disk.
  const chapterNumber = resolveTargetChapterNumber(chapterFiles, chapters);
  let previousContent = "";
  const lastChapter = chapters[chapters.length - 1];
  if (lastChapter && lastChapter.content.trim() === "") {
    const lastNonEmpty = [...chapters].reverse().find((ch) =>
      ch.content.trim().length > 0
    );
    previousContent = lastNonEmpty ? lastNonEmpty.content : "";
  } else if (lastChapter) {
    previousContent = lastChapter.content;
  }

  // Filter to non-empty chapters first, then build both arrays from the same set
  // to keep indices aligned for the compaction plugin
  const nonEmptyChapters = chapters.filter((ch) =>
    ch.content.trim().length > 0
  );

  const previousContext: string[] = nonEmptyChapters
    .map((ch) => stripPromptTags(ch.content));

  const rawChapters: string[] = nonEmptyChapters
    .map((ch) => ch.content);

  // Allow plugins to modify previousContext (e.g., context compaction)
  const hookContext: Record<string, unknown> = {
    previousContext,
    rawChapters,
    storyDir,
    series,
    name,
    correlationId: effectiveCorrelationId,
  };
  await hookDispatcher.dispatch("prompt-assembly", hookContext);

  // Remove entries that became empty after stripping (before hook, some entries
  // may be empty if a chapter consisted only of stripped tags)
  const filteredContext = previousContext.filter((c) => c.length > 0);

  const { messages, error: ventoError } =
    await renderSystemPrompt(series, name, {
      previousContext: filteredContext,
      userInput: message,
      isFirstRound,
      storyDir,
      chapterNumber,
      previousContent,
      chapterCount: totalChapterCount,
      templateOverride: typeof template === "string" ? template : undefined,
      extraVariables,
    });

  return {
    messages: ventoError ? [] : messages,
    previousContext: filteredContext,
    isFirstRound,
    ventoError,
    chapterFiles,
    chapters,
  };
}

/**
 * Build the prompt for a continue-last-chapter request. Re-reads the
 * latest chapter from disk on every call, parses it via
 * `parseChapterForContinue`, and routes the extracted user_message text
 * into the trailing user turn (`userInput`). When the parsed assistant
 * prefill is non-empty, an extra `{ role: "assistant", content: prefill }`
 * entry is appended after the rendered messages so the upstream LLM
 * continues from where the chapter left off; otherwise the rendered array
 * is returned unchanged (an empty assistant message would be rejected by
 * `assertNoEmptyMessages` and by some providers).
 */
export async function buildContinuePromptFromStory(
  deps: PromptDeps,
  series: string,
  name: string,
  storyDir: string,
  template?: string,
  correlationId?: string,
): Promise<ContinuePromptResult> {
  const { stripPromptTags, renderSystemPrompt, hookDispatcher } = deps;
  const effectiveCorrelationId = correlationId ?? crypto.randomUUID();

  const { chapterFiles, chapters, totalChapterCount } =
    await loadChaptersForPrompt(storyDir);
  log.debug("Read story directory (continue)", {
    path: storyDir,
    chapterCount: chapterFiles.length,
  });

  if (chapterFiles.length === 0) {
    throw new ContinuePromptError(
      "no-chapter",
      "Cannot continue: no existing chapter file",
      400,
    );
  }

  const lastFile = chapterFiles[chapterFiles.length - 1]!;
  const targetChapterNumber = parseInt(lastFile, 10);
  const lastChapter = chapters[chapters.length - 1]!;
  const existingContent = lastChapter.content;

  const { userMessageText, assistantPrefill } = parseChapterForContinue(
    existingContent,
    stripPromptTags,
  );

  if (userMessageText.trim() === "" && assistantPrefill.trim() === "") {
    throw new ContinuePromptError(
      "no-content",
      "Latest chapter is empty; nothing to continue",
      400,
    );
  }

  // previousContext = chapters 1..n-1 (exclude the chapter we are continuing).
  const priorChapters = chapters.slice(0, -1);
  const nonEmptyPrior = priorChapters.filter((ch) =>
    ch.content.trim().length > 0
  );
  const previousContext: string[] = nonEmptyPrior.map((ch) =>
    stripPromptTags(ch.content)
  );
  const rawChapters: string[] = nonEmptyPrior.map((ch) => ch.content);

  const hookContext: Record<string, unknown> = {
    previousContext,
    rawChapters,
    storyDir,
    series,
    name,
    correlationId: effectiveCorrelationId,
  };
  await hookDispatcher.dispatch("prompt-assembly", hookContext);

  const filteredContext = previousContext.filter((c) => c.length > 0);

  // previousContent for the renderer is the chapter immediately preceding
  // the target — same shape as buildPromptFromStory uses for chapter N's
  // context when the target reuses an empty trailing file. For continue,
  // chapter n-1 (last non-empty prior chapter) is the natural choice.
  const lastPriorNonEmpty = [...priorChapters].reverse().find((ch) =>
    ch.content.trim().length > 0
  );
  const previousContent = lastPriorNonEmpty ? lastPriorNonEmpty.content : "";

  // `isFirstRound` mirrors the semantics of `buildPromptFromStory`: it is
  // true when there is no previous narrative context to display. Custom
  // system.md templates commonly gate the "previous context" assistant
  // message on `!isFirstRound`; without this flag the template would emit
  // an empty assistant message (e.g. when continuing the very first
  // chapter, or when all prior chapters contain only stripped-away tags
  // like `<user_message>`). `assertNoEmptyMessages` would then reject the
  // render with `multi-message:empty-message`.
  const isFirstRound = filteredContext.length === 0;

  const { messages: renderedMessages, error: ventoError } =
    await renderSystemPrompt(series, name, {
      previousContext: filteredContext,
      userInput: userMessageText,
      isFirstRound,
      storyDir,
      chapterNumber: targetChapterNumber,
      previousContent,
      chapterCount: totalChapterCount,
      templateOverride: typeof template === "string" ? template : undefined,
    });

  if (ventoError) {
    return {
      messages: [],
      ventoError,
      targetChapterNumber,
      existingContent,
      userMessageText,
      assistantPrefill,
    };
  }

  // Append trailing assistant prefill ONLY when non-empty — empty
  // assistant messages are rejected by `assertNoEmptyMessages` and by
  // strict providers.
  const messages: ChatMessage[] = assistantPrefill.trim().length > 0
    ? [...renderedMessages, { role: "assistant", content: assistantPrefill }]
    : renderedMessages;

  return {
    messages,
    ventoError: null,
    targetChapterNumber,
    existingContent,
    userMessageText,
    assistantPrefill,
  };
}
