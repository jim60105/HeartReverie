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
 * Story engine entry point. Owns:
 *
 * - {@link createStoryEngine} — DI factory that wires `stripPromptTags`
 *   (closes over {@link PluginManager} so the strip regex is re-fetched
 *   on every call) and delegates prompt construction to the focused
 *   `story-prompt-builder` module.
 * - Public re-exports of chapter I/O primitives and the
 *   {@link ContinuePromptError} class, kept for import-stability across
 *   the codebase.
 */

import type { RenderOptions, RenderResult, SafePathFn, StoryEngine } from "../types.ts";
import type { PluginManager } from "./plugin-manager.ts";
import type { HookDispatcher } from "./hooks.ts";
import { buildContinuePromptFromStory, buildPromptFromStory } from "./story-prompt-builder.ts";

export {
  atomicWriteChapter,
  ContinuePromptError,
  copyChapterFile,
  listChapterFiles,
  parseChapterForContinue,
  readStateDiff,
  resolveTargetChapterNumber,
} from "./story-chapter-io.ts";

export function createStoryEngine(
  pluginManager: PluginManager,
  _safePath: SafePathFn,
  renderSystemPrompt: (
    series: string,
    story?: string,
    options?: RenderOptions,
  ) => Promise<RenderResult>,
  hookDispatcher: HookDispatcher,
): StoryEngine {
  function stripPromptTags(content: string): string {
    const pluginRegex = pluginManager.getStripTagPatterns();
    if (pluginRegex) {
      return content.replace(pluginRegex, "").trim();
    }
    return content.trim();
  }

  const deps = { stripPromptTags, renderSystemPrompt, hookDispatcher };

  return {
    stripPromptTags,
    buildPromptFromStory: (
      series,
      name,
      storyDir,
      message,
      template,
      extraVariables,
      correlationId,
    ) =>
      buildPromptFromStory(
        deps,
        series,
        name,
        storyDir,
        message,
        template,
        extraVariables,
        correlationId,
      ),
    buildContinuePromptFromStory: (
      series,
      name,
      storyDir,
      template,
      correlationId,
    ) =>
      buildContinuePromptFromStory(
        deps,
        series,
        name,
        storyDir,
        template,
        correlationId,
      ),
  };
}
