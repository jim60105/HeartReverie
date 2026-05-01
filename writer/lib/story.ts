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
import type { SafePathFn, StoryEngine, BuildPromptResult, RenderResult, RenderOptions, ChapterEntry } from "../types.ts";
import type { PluginManager } from "./plugin-manager.ts";
import type { HookDispatcher } from "./hooks.ts";
import { createLogger } from "./logger.ts";

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

  return { stripPromptTags, buildPromptFromStory };
}
