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
  SafePathFn,
  StoryEngine,
  BuildPromptResult,
  ContinuePromptResult,
  RenderResult,
  RenderOptions,
  ChapterEntry,
  ChatMessage,
} from "../types.ts";
import type { PluginManager } from "./plugin-manager.ts";
import type { HookDispatcher } from "./hooks.ts";
import { createLogger } from "./logger.ts";

/**
 * Internal error thrown by `buildContinuePromptFromStory` to signal a
 * user-facing failure. `executeContinue` translates this into a `ChatError`.
 * Defined here (rather than importing `ChatError` from `chat-shared.ts`) to
 * avoid a circular import — `chat-shared.ts` already imports helpers from
 * this module.
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
    const remainder = rawContent.slice(0, m.index ?? 0)
      + rawContent.slice((m.index ?? 0) + m[0].length);
    const assistantPrefill = stripPromptTags(remainder).trim();
    return { userMessageText, assistantPrefill };
  }
  return {
    userMessageText: "",
    assistantPrefill: stripPromptTags(rawContent).trim(),
  };
}

const log = createLogger("file");

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
  } catch {
    return [];
  }
  return entries
    .filter((f) => /^\d+\.md$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
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

export function createStoryEngine(
  pluginManager: PluginManager,
  _safePath: SafePathFn,
  renderSystemPrompt: (series: string, story?: string, options?: RenderOptions) => Promise<RenderResult>,
  hookDispatcher: HookDispatcher,
): StoryEngine {
  function stripPromptTags(content: string): string {
    const pluginRegex = pluginManager.getStripTagPatterns();
    if (pluginRegex) {
      return content.replace(pluginRegex, "").trim();
    }
    return content.trim();
  }

  /**
   * Shared prompt construction logic for chat and preview endpoints.
   * Reads chapters, strips tags, detects first-round, renders prompt.
   * @returns {{ prompt, previousContext, isFirstRound, ventoError, chapterFiles, chapters }}
   */
  async function buildPromptFromStory(
    series: string,
    name: string,
    storyDir: string,
    message: string,
    template?: string,
    extraVariables?: Record<string, unknown>,
  ): Promise<BuildPromptResult> {
    let chapterFiles: string[] = await listChapterFiles(storyDir);
    log.debug("Read story directory", { path: storyDir, chapterCount: chapterFiles.length });

    const totalChapterCount = chapterFiles.length;

    const MAX_CHAPTERS: number = 200;
    if (chapterFiles.length > MAX_CHAPTERS) {
      chapterFiles = chapterFiles.slice(-MAX_CHAPTERS);
    }

    const chapters: ChapterEntry[] = [];
    for (const f of chapterFiles) {
      const content = await Deno.readTextFile(join(storyDir, f));
      chapters.push({ number: parseInt(f, 10), content });
    }
    log.debug("Loaded chapters for prompt building", {
      series,
      story: name,
      totalChapters: chapters.length,
      nonEmpty: chapters.filter((ch) => ch.content.trim().length > 0).length,
    });

    const isFirstRound: boolean = chapters.every((ch) => ch.content.trim() === "");

    // Compute target chapter number + previous content for plugin context.
    // `previousContent` is the *unstripped* content of the chapter immediately
    // preceding the target: if the target reuses a trailing empty file, use
    // the last non-empty chapter; otherwise use the last chapter on disk.
    const chapterNumber = resolveTargetChapterNumber(chapterFiles, chapters);
    let previousContent = "";
    const lastChapter = chapters[chapters.length - 1];
    if (lastChapter && lastChapter.content.trim() === "") {
      const lastNonEmpty = [...chapters].reverse().find((ch) => ch.content.trim().length > 0);
      previousContent = lastNonEmpty ? lastNonEmpty.content : "";
    } else if (lastChapter) {
      previousContent = lastChapter.content;
    }

    // Filter to non-empty chapters first, then build both arrays from the same set
    // to keep indices aligned for the compaction plugin
    const nonEmptyChapters = chapters.filter((ch) => ch.content.trim().length > 0);

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
        templateOverride:
          typeof template === "string" ? template : undefined,
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
  async function buildContinuePromptFromStory(
    series: string,
    name: string,
    storyDir: string,
    template?: string,
  ): Promise<ContinuePromptResult> {
    let chapterFiles: string[] = await listChapterFiles(storyDir);
    log.debug("Read story directory (continue)", { path: storyDir, chapterCount: chapterFiles.length });

    if (chapterFiles.length === 0) {
      throw new ContinuePromptError("no-chapter", "Cannot continue: no existing chapter file", 400);
    }

    const totalChapterCount = chapterFiles.length;

    const MAX_CHAPTERS: number = 200;
    if (chapterFiles.length > MAX_CHAPTERS) {
      chapterFiles = chapterFiles.slice(-MAX_CHAPTERS);
    }

    // Read all retained chapters fresh from disk on every call (no caching).
    const chapters: ChapterEntry[] = [];
    for (const f of chapterFiles) {
      const content = await Deno.readTextFile(join(storyDir, f));
      chapters.push({ number: parseInt(f, 10), content });
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
    const nonEmptyPrior = priorChapters.filter((ch) => ch.content.trim().length > 0);
    const previousContext: string[] = nonEmptyPrior.map((ch) => stripPromptTags(ch.content));
    const rawChapters: string[] = nonEmptyPrior.map((ch) => ch.content);

    const hookContext: Record<string, unknown> = {
      previousContext,
      rawChapters,
      storyDir,
      series,
      name,
    };
    await hookDispatcher.dispatch("prompt-assembly", hookContext);

    const filteredContext = previousContext.filter((c) => c.length > 0);

    // previousContent for the renderer is the chapter immediately preceding
    // the target — same shape as buildPromptFromStory uses for chapter N's
    // context when the target reuses an empty trailing file. For continue,
    // chapter n-1 (last non-empty prior chapter) is the natural choice.
    const lastPriorNonEmpty = [...priorChapters].reverse().find((ch) => ch.content.trim().length > 0);
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

  return { stripPromptTags, buildPromptFromStory, buildContinuePromptFromStory };
}
