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
 * Story / template engine return types and prompt-assembly result shapes.
 * Kept together because `BuildPromptResult` / `ContinuePromptResult` /
 * `RenderResult` are all transitively reachable from `ChatMessage`,
 * `VentoError`, and `ChapterEntry`.
 */

/**
 * A single chat message belonging to the upstream LLM `messages` array.
 *
 * Roles are constrained to the OpenAI-compatible Chat Completions allow-list
 * supported by the `{{ message }}` Vento tag (`vento-message-tag` capability).
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Vento template error details. */
export interface VentoError {
  type?: string;
  stage?: string;
  message: string;
  source?: string;
  line?: number | null;
  suggestion?: string | null;
  title?: string;
  detail?: string;
  expressions?: string[];
}

/** A single entry in a state diff between consecutive chapters. */
export interface StateDiffEntry {
  path: string;
  kind: "added" | "removed" | "modified" | "truncated";
  oldValue?: unknown;
  newValue?: unknown;
}

/** Payload for per-chapter state diff data. */
export interface StateDiffPayload {
  generatedAt: string;
  chapterNum: number;
  entries: StateDiffEntry[];
}

/** A chapter entry with number and content. */
export interface ChapterEntry {
  number: number;
  content: string;
  stateDiff?: StateDiffPayload;
}

/** Options for renderSystemPrompt. */
export interface RenderOptions {
  previousContext?: string[];
  userInput?: string;
  isFirstRound?: boolean;
  templateOverride?: string;
  storyDir?: string;
  chapterNumber?: number;
  previousContent?: string;
  chapterCount?: number;
  /**
   * Additional Vento variables provided by callers (e.g. plugin-action
   * `run-prompt` requests). Spread into the render context BEFORE the built-in
   * variables so callers cannot override reserved names — collision detection
   * is the route's responsibility.
   */
  extraVariables?: Record<string, unknown>;
}

/**
 * Discriminated union returned by `renderSystemPrompt()`.
 *
 * On success, `messages` is a non-empty array (assembly guarantees at least
 * one `user`-role message via `assertHasUserMessage`); on failure, `messages`
 * is empty and `error` carries an RFC 9457-shaped `VentoError`.
 */
export type RenderResult =
  | { messages: ChatMessage[]; error: null }
  | { messages: []; error: VentoError };

/**
 * Result of `buildPromptFromStory()`. The legacy `prompt: string` field has
 * been replaced by a fully assembled `messages` array — the template is now
 * the authoritative source of the upstream `messages` payload.
 */
export interface BuildPromptResult {
  messages: ChatMessage[];
  previousContext: string[];
  isFirstRound: boolean;
  ventoError: VentoError | null;
  chapterFiles: string[];
  chapters: ChapterEntry[];
}

/**
 * Result of `buildContinuePromptFromStory()`. Carries the rendered
 * `messages` (with the optional trailing assistant prefill already
 * appended), plus the metadata required by `streamLlmAndPersist` to operate
 * on the existing latest chapter file (`targetChapterNumber`,
 * `existingContent` for the snapshot guard).
 *
 * On Vento failure `messages` is empty and `ventoError` carries the
 * RFC 9457-shaped error.
 */
export interface ContinuePromptResult {
  messages: ChatMessage[];
  ventoError: VentoError | null;
  targetChapterNumber: number;
  /** Unstripped chapter-n bytes captured at parse time. */
  existingContent: string;
  userMessageText: string;
  assistantPrefill: string;
}

/** Function signature for buildPromptFromStory. */
export type BuildPromptFn = (
  series: string,
  name: string,
  storyDir: string,
  message: string,
  template?: string,
  extraVariables?: Record<string, unknown>,
  correlationId?: string,
) => Promise<BuildPromptResult>;

/** Function signature for buildContinuePromptFromStory. */
export type BuildContinuePromptFn = (
  series: string,
  name: string,
  storyDir: string,
  template?: string,
  correlationId?: string,
) => Promise<ContinuePromptResult>;

/** Return type of createStoryEngine(). */
export interface StoryEngine {
  stripPromptTags: (content: string) => string;
  buildPromptFromStory: BuildPromptFn;
  buildContinuePromptFromStory: BuildContinuePromptFn;
}

/** Return type of createTemplateEngine(). */
export interface TemplateEngine {
  renderSystemPrompt: (
    series: string,
    story?: string,
    options?: RenderOptions,
  ) => Promise<RenderResult>;
  validateTemplate: (templateStr: string) => string[];
  ventoEnv: import("ventojs/core/environment").Environment;
}

/**
 * Story export payload shape emitted by `GET /api/stories/:series/:name/export?format=json`.
 *
 * Chapters are sorted by ascending `number`. Content is stripped of plugin
 * tags (both `promptStripTags` and `displayStripTags`) and empty entries
 * (after trim) are omitted from the array.
 */
export interface StoryExportJson {
  readonly series: string;
  readonly name: string;
  readonly exportedAt: string;
  readonly chapters: readonly {
    readonly number: number;
    readonly content: string;
  }[];
}

// ── Chapter Edit / Rewind / Branch ──

/** Request body for `PUT /api/stories/:series/:name/chapters/:number`. */
export interface ChapterEditRequest {
  readonly content: string;
}

/** Response body for `PUT /api/stories/:series/:name/chapters/:number`. */
export interface ChapterEditResponse {
  readonly number: number;
  readonly content: string;
}

/** Response body for `DELETE /api/stories/:series/:name/chapters/after/:number`. */
export interface ChapterRewindResponse {
  readonly deleted: readonly number[];
}

/** Request body for `POST /api/stories/:series/:name/branch`. */
export interface BranchRequest {
  readonly fromChapter: number;
  readonly newName?: string;
}

/** Response body for `POST /api/stories/:series/:name/branch`. */
export interface BranchResponse {
  readonly series: string;
  readonly name: string;
  readonly copiedChapters: readonly number[];
}
