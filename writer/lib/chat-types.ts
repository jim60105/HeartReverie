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
 * Public types, error classes, and the {@link WriteMode} discriminated union
 * for the chat-execution pipeline. Extracted from `chat-shared.ts` so the
 * surface area used by route handlers (`routes/chat.ts`, `routes/ws.ts`,
 * `routes/plugin-actions.ts`) lives in one focused module that doesn't
 * pull in the streaming implementation.
 */

import type {
  AppConfig,
  BuildContinuePromptFn,
  BuildPromptFn,
  ChatMessage,
  LlmConfig,
  SafePathFn,
  TokenUsageRecord,
  VentoError,
} from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";

/** Options for executing a chat request. */
export interface ChatOptions {
  readonly series: string;
  readonly name: string;
  readonly message: string;
  readonly template?: string;
  readonly config: AppConfig;
  readonly safePath: SafePathFn;
  readonly hookDispatcher: HookDispatcher;
  readonly buildPromptFromStory: BuildPromptFn;
  readonly onDelta?: (content: string) => void;
  readonly signal?: AbortSignal;
}

/** Successful chat result. */
export interface ChatResult {
  readonly chapter: number;
  readonly content: string;
  readonly usage: TokenUsageRecord | null;
}

/** Options for `executeContinue` — continues the latest chapter file. */
export interface ContinueOptions {
  readonly series: string;
  readonly name: string;
  readonly template?: string;
  readonly config: AppConfig;
  readonly safePath: SafePathFn;
  readonly hookDispatcher: HookDispatcher;
  readonly buildContinuePromptFromStory: BuildContinuePromptFn;
  readonly onDelta?: (content: string) => void;
  readonly signal?: AbortSignal;
}

/** Successful continue result. */
export interface ContinueResult {
  readonly chapter: number;
  /** Full chapter content after the continue stream completes. */
  readonly content: string;
  readonly usage: TokenUsageRecord | null;
}

/** Error thrown when a chat generation is aborted by the client. */
export class ChatAbortError extends Error {
  override readonly name = "ChatAbortError";
}

/** Known failure modes surfaced by chat execution. */
export type ChatErrorCode =
  | "api-key"
  | "bad-path"
  | "vento"
  | "no-prompt"
  | "llm-api"
  | "llm-stream"
  | "no-body"
  | "no-content"
  | "story-config"
  | "no-chapter"
  | "concurrent"
  | "conflict";

/** Error thrown when chat execution encounters a known failure. */
export class ChatError extends Error {
  override readonly name = "ChatError";
  constructor(
    public readonly code: ChatErrorCode,
    message: string,
    public readonly httpStatus: number = 500,
    public readonly ventoError?: VentoError,
  ) {
    super(message);
  }
}

/**
 * Discriminated union describing how `streamLlmAndPersist` should persist
 * the LLM stream output:
 *
 * - `write-new-chapter`: existing chat behaviour — open the next chapter file,
 *   dispatch `pre-write`, write each delta after `response-stream` hook
 *   transformation, and dispatch `post-response` with `source: "chat"`.
 * - `append-to-existing-chapter`: plugin-action append mode — accumulate the
 *   stream in memory, on success persist it to the highest-numbered chapter
 *   file, then re-read that file and dispatch `post-response` with
 *   `source: "plugin-action"`. When `appendTag` is a string the engine
 *   normalises wrapper layers and atomically appends
 *   `\n<{appendTag}>\n…\n</{appendTag}>\n`. When `appendTag` is `null`
 *   (tagless append) the engine trims the accumulated content WITHOUT any
 *   wrapper-stripping pass and atomically appends `\n{trimmed content}\n`
 *   with NO synthetic wrapper element. `pre-write` and `response-stream`
 *   are NOT dispatched in either case.
 * - `discard`: plugin-action discard mode — accumulate the stream in memory
 *   and return it; no chapter mutation, no hook dispatches.
 * - `continue-last-chapter`: continue mode — append streaming bytes to an
 *   already-existing chapter file (specified by `targetChapterNumber`).
 *   Re-uses the per-chunk `response-stream` hook + `<think>` framing from
 *   `write-new-chapter`, but does NOT dispatch `pre-write` (no new user
 *   message exists), opens the file with `append: true` (no truncate, no
 *   create), and on entry verifies the on-disk bytes still match
 *   `existingContent` (snapshot guard against external editors racing the
 *   per-story lock — throws `ChatError("conflict", …, 409)` on mismatch).
 *   Finalisation re-reads the chapter file to compute `chapterContentAfter`
 *   and dispatches `post-response` with `source: "continue"`.
 * - `replace-last-chapter`: a plugin-action mode that atomically overwrites
 *   the highest-numbered chapter file with the LLM's full response after
 *   the stream completes. Used by the bundled `polish` plugin. Streaming
 *   deltas are accumulated in memory only — no file is opened during the
 *   stream, so an aborted/errored generation leaves the on-disk chapter
 *   untouched (byte-for-byte preservation). Finalisation calls
 *   `atomicWriteChapter` with `aiContent.trimEnd() + "\n"`, re-reads the
 *   file, appends one usage record (if available), and dispatches
 *   `post-response` with `source: "plugin-action"` and `pluginName`.
 *   Neither `pre-write` nor `response-stream` hooks fire in this mode.
 */
export type WriteMode =
  | {
    readonly kind: "write-new-chapter";
    readonly userMessage: string;
    readonly targetChapterNumber: number;
  }
  | {
    readonly kind: "append-to-existing-chapter";
    /**
     * Wrapper tag to wrap the appended content in, or `null` for a tagless
     * append. When `null` the model output is trimmed and appended verbatim
     * (no `<{tag}>…</{tag}>` wrapper element, no wrapper-stripping pass), so
     * any XML tags the model emitted are preserved exactly as produced.
     */
    readonly appendTag: string | null;
    readonly pluginName: string;
  }
  | { readonly kind: "discard" }
  | {
    readonly kind: "continue-last-chapter";
    readonly targetChapterNumber: number;
    readonly existingContent: string;
  }
  | { readonly kind: "replace-last-chapter"; readonly pluginName: string };

/** Arguments for `streamLlmAndPersist`. */
export interface StreamLlmArgs {
  readonly messages: ChatMessage[];
  readonly llmConfig: LlmConfig;
  readonly series: string;
  readonly name: string;
  readonly storyDir: string;
  readonly rootDir: string;
  readonly signal?: AbortSignal;
  readonly writeMode: WriteMode;
  readonly onDelta?: (chunk: string) => void;
  readonly hookDispatcher: HookDispatcher;
  readonly config: AppConfig;
  /**
   * Per-request correlation id. Minted at the inbound request boundary
   * (e.g. `executeChat` / `executeContinue`) and threaded through both the
   * `prompt-assembly` hook (via the prompt builders) and the `pre-llm-fetch`
   * + `response-stream` + `post-response` hooks. When omitted, a fresh
   * UUID is minted inside `streamLlmAndPersist` so the hook context always
   * observes a non-empty value (legacy callers / tests).
   */
  readonly correlationId?: string;
}

/** Result of `streamLlmAndPersist`. */
export interface StreamLlmResult {
  readonly content: string;
  readonly usage: TokenUsageRecord | null;
  readonly chapterPath: string | null;
  readonly chapterNumber: number | null;
  readonly chapterContentAfter: string | null;
  readonly aborted: boolean;
}
