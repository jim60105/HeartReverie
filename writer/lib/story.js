// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { join } from "@std/path";

export function createStoryEngine(pluginManager, safePath, renderSystemPrompt) {
  function stripPromptTags(content) {
    const pluginRegex = pluginManager.getStripTagPatterns();
    if (pluginRegex) {
      return content.replace(pluginRegex, "").trim();
    }
    return content.trim();
  }

  async function loadStatus(series, name) {
    const currentPath = safePath(series, name, "current-status.yml");
    const initPath = safePath(series, "init-status.yml");

    if (currentPath) {
      try {
        return await Deno.readTextFile(currentPath);
      } catch {
        // Fall through to init
      }
    }

    if (initPath) {
      try {
        return await Deno.readTextFile(initPath);
      } catch {
        // Neither exists
      }
    }

    return "";
  }

  /**
   * Shared prompt construction logic for chat and preview endpoints.
   * Reads chapters, strips tags, detects first-round, loads status, renders prompt.
   * @returns {{ prompt, previousContext, statusContent, isFirstRound, ventoError, chapterFiles, chapters }}
   */
  async function buildPromptFromStory(
    series,
    name,
    storyDir,
    message,
    template
  ) {
    let chapterFiles = [];
    try {
      const entries = [];
      for await (const entry of Deno.readDir(storyDir)) {
        entries.push(entry.name);
      }
      chapterFiles = entries
        .filter((f) => /^\d+\.md$/.test(f))
        .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    } catch {
      // Directory may not exist yet
    }

    const MAX_CHAPTERS = 200;
    if (chapterFiles.length > MAX_CHAPTERS) {
      chapterFiles = chapterFiles.slice(-MAX_CHAPTERS);
    }

    const chapters = [];
    for (const f of chapterFiles) {
      const content = await Deno.readTextFile(join(storyDir, f));
      chapters.push({ number: parseInt(f, 10), content });
    }

    const isFirstRound = chapters.every((ch) => ch.content.trim() === "");

    const previousContext = chapters
      .map((ch) => stripPromptTags(ch.content))
      .filter((content) => content.length > 0);

    const statusContent = await loadStatus(series, name);

    const { content: prompt, error: ventoError } =
      await renderSystemPrompt(series, {
        previousContext,
        userInput: message,
        status: statusContent,
        isFirstRound,
        templateOverride:
          typeof template === "string" ? template : undefined,
      });

    return {
      prompt,
      previousContext,
      statusContent,
      isFirstRound,
      ventoError,
      chapterFiles,
      chapters,
    };
  }

  return { stripPromptTags, loadStatus, buildPromptFromStory };
}
