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

import type { Context, Next } from "@hono/hono";
import type { PluginManager } from "./lib/plugin-manager.ts";
import type { HookDispatcher } from "./lib/hooks.ts";
import type { Logger } from "./lib/logger.ts";

/**
 * Single source of truth for the reasoning-effort enum. The frontend imports
 * the same module so backend and frontend cannot drift.
 */
export const REASONING_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

/** Reasoning effort tier accepted by OpenRouter / OpenAI-compatible reasoning models. */
export type ReasoningEffort = typeof REASONING_EFFORTS[number];

/**
 * Resolved per-request LLM configuration (camelCase). Matches the upstream
 * chat/completions sampler knobs; `*_penalty` fields are mapped to snake_case
 * exactly once when building the upstream fetch body.
 */
export interface LlmConfig {
  readonly model: string;
  readonly temperature: number;
  readonly frequencyPenalty: number;
  readonly presencePenalty: number;
  readonly topK: number;
  readonly topP: number;
  readonly repetitionPenalty: number;
  readonly minP: number;
  readonly topA: number;
  readonly reasoningEnabled: boolean;
  readonly reasoningEffort: ReasoningEffort;
  /**
   * Upper bound on tokens the LLM may generate (sent as `max_completion_tokens`
   * in the OpenAI-compatible request body — covers reasoning + content combined
   * for reasoning-capable models). Must be a positive safe integer.
   */
  readonly maxCompletionTokens: number;
}

/**
 * Per-story override bag — every field is optional. Includes the optional
 * `reasoningEnabled` / `reasoningEffort` overrides.
 */
export type StoryLlmConfigOverrides = Partial<LlmConfig>;

/** Application configuration resolved from environment variables and defaults. */
export interface AppConfig {
  readonly ROOT_DIR: string;
  readonly PLAYGROUND_DIR: string;
  readonly READER_DIR: string;
  readonly PLUGINS_DIR: string;
  readonly PORT: number;
  readonly CERT_FILE: string | undefined;
  readonly KEY_FILE: string | undefined;
  readonly LLM_API_URL: string;
  readonly LLM_MODEL: string;
  readonly LLM_TEMPERATURE: number;
  readonly LLM_FREQUENCY_PENALTY: number;
  readonly LLM_PRESENCE_PENALTY: number;
  readonly LLM_TOP_K: number;
  readonly LLM_TOP_P: number;
  readonly LLM_REPETITION_PENALTY: number;
  readonly LLM_MIN_P: number;
  readonly LLM_TOP_A: number;
  readonly LLM_REASONING_ENABLED: boolean;
  readonly LLM_REASONING_EFFORT: ReasoningEffort;
  readonly LLM_REASONING_OMIT: boolean;
  readonly LLM_MAX_COMPLETION_TOKENS: number;
  readonly BACKGROUND_IMAGE: string;
  readonly PROMPT_FILE: string;
  /** Defaults for per-story LLM overrides, assembled from the flat `LLM_*` env vars. */
  readonly llmDefaults: LlmConfig;
}

/** Function that resolves path segments under the playground directory, returning null on traversal. */
export type SafePathFn = (...segments: string[]) => string | null;

/** Hono middleware handler signature. */
export type MiddlewareHandler = (c: Context, next: Next) => Promise<Response | void>;

/** Function signature for buildPromptFromStory. */
export type BuildPromptFn = (
  series: string,
  name: string,
  storyDir: string,
  message: string,
  template?: string
) => Promise<BuildPromptResult>;

/** Top-level dependency bag passed to createApp and route registrars. */
export interface AppDeps {
  readonly config: AppConfig;
  readonly safePath: SafePathFn;
  readonly pluginManager: PluginManager;
  readonly hookDispatcher: HookDispatcher;
  readonly buildPromptFromStory: BuildPromptFn;
  readonly verifyPassphrase: MiddlewareHandler;
}

/** Plugin manifest schema parsed from plugin.json. */
export interface PluginManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly type?: string;
  readonly tags?: readonly string[];
  readonly backendModule?: string;
  readonly frontendModule?: string;
  readonly promptStripTags?: readonly string[];
  readonly displayStripTags?: readonly string[];
  readonly promptFragments?: readonly PromptFragment[];
  readonly parameters?: readonly PluginParameter[];
  /**
   * Array of relative paths (from the plugin directory) to CSS files to inject
   * into the frontend via `<link rel="stylesheet">`. Each entry must end with
   * `.css`, must not be an absolute path, and must not contain `..` segments
   * (no path traversal). Paths are resolved and contained within the plugin's
   * directory at load time.
   */
  readonly frontendStyles?: readonly string[];
}

/** A prompt fragment declaration in a plugin manifest. */
export interface PromptFragment {
  readonly file: string;
  readonly variable?: string;
  readonly priority?: number;
}

/** A parameter declaration in a plugin manifest. */
export interface PluginParameter {
  readonly name: string;
  readonly type?: string;
  readonly description?: string;
}

/**
 * Context passed to plugin `getDynamicVariables()`.
 *
 * All fields are derived from data already materialized by
 * `buildPromptFromStory()` in `writer/lib/story.ts`. The object is a plain
 * serializable bag: no functions, file handles, streams, or `AppConfig`.
 */
export interface DynamicVariableContext {
  /** Series identifier for the current request. */
  readonly series: string;
  /** Story identifier for the current request. */
  readonly name: string;
  /** Absolute path to the story directory on disk. */
  readonly storyDir: string;
  /**
   * Raw user message that triggered this prompt build. May be a large
   * arbitrary string — plugin authors should scrub before persisting.
   * Empty string when the caller omitted a message (e.g., preview route).
   */
  readonly userInput: string;
  /**
   * 1-based number of the chapter that a subsequent write would target,
   * computed by `resolveTargetChapterNumber()`: reuse the trailing empty
   * chapter file if any, otherwise `max(existing) + 1`, otherwise `1`.
   */
  readonly chapterNumber: number;
  /**
   * Unstripped content of the chapter immediately preceding `chapterNumber`.
   * Empty string when no prior chapter exists. Can be large (tens of KB);
   * plugins that forward it into other variables should summarize first.
   */
  readonly previousContent: string;
  /** True when every existing chapter on disk is blank. */
  readonly isFirstRound: boolean;
  /** Total number of `NNN.md` chapter files on disk, including empty trailing files. */
  readonly chapterCount: number;
}

/** Hook registration interface exposed to plugins (subset of HookDispatcher). */
export interface PluginHooks {
  register(stage: HookStage, handler: HookHandler, priority?: number): void;
}

/** Context passed to plugin register() function. */
export interface PluginRegisterContext {
  readonly hooks: PluginHooks;
  readonly logger: Logger;
}

/** Interface for dynamically imported plugin backend modules. */
export interface PluginModule {
  register?: (context: PluginRegisterContext) => void | Promise<void>;
  default?: (context: PluginRegisterContext) => void | Promise<void>;
  getDynamicVariables?: (context: DynamicVariableContext) => Promise<Record<string, unknown>> | Record<string, unknown>;
}

/** Valid hook lifecycle stages. */
export type HookStage = "prompt-assembly" | "response-stream" | "pre-write" | "post-response" | "strip-tags";

/**
 * Context payload dispatched for the `response-stream` hook stage.
 *
 * Dispatched by `executeChat()` once per non-empty content delta parsed from
 * the LLM SSE stream, before the delta is persisted or emitted via `onDelta`.
 *
 * The `chunk` field is **mutable**: handlers MAY overwrite it to transform
 * the chunk (e.g., redaction, translation, censorship). Assigning `""` drops
 * the chunk entirely — no bytes are written to the chapter file, the
 * `aiContent` accumulator is not advanced, and `onDelta` is not invoked for
 * that delta. If `chunk` is not a string after dispatch (e.g., set to a
 * number, `undefined`, or deleted), it is coerced to `""` (drop).
 *
 * All other fields are read-only context for handlers; mutating them has no
 * effect on persistence.
 */
export interface ResponseStreamPayload {
  /** Per-request correlation ID shared with all loggers in this chat execution. */
  readonly correlationId: string;
  /** Mutable content delta text. Overwrite to transform; set to `""` to drop. */
  chunk: string;
  /** Series name under `playground/`. */
  readonly series: string;
  /** Story name under `playground/<series>/`. */
  readonly name: string;
  /** Absolute path to the story directory. */
  readonly storyDir: string;
  /** Absolute path to the chapter file being written. */
  readonly chapterPath: string;
  /** Target chapter number (1-based). */
  readonly chapterNumber: number;
  /** Logger injected by `HookDispatcher` at dispatch time. */
  readonly logger?: unknown;
}

/** Hook handler function signature. */
export type HookHandler = (context: Record<string, unknown>) => Promise<void>;

/** Return type of createStoryEngine(). */
export interface StoryEngine {
  stripPromptTags: (content: string) => string;
  buildPromptFromStory: BuildPromptFn;
}

/** Return type of createTemplateEngine(). */
export interface TemplateEngine {
  renderSystemPrompt: (
    series: string,
    story?: string,
    options?: RenderOptions
  ) => Promise<RenderResult>;
  validateTemplate: (templateStr: string) => string[];
  ventoEnv: import("ventojs/core/environment").Environment;
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
}

/** Discriminated union for renderSystemPrompt return. */
export type RenderResult =
  | { content: string; error: null }
  | { content: null; error: VentoError };

/** Result of buildPromptFromStory. */
export interface BuildPromptResult {
  prompt: string | null;
  previousContext: string[];
  isFirstRound: boolean;
  ventoError: VentoError | null;
  chapterFiles: string[];
  chapters: ChapterEntry[];
}

/** A chapter entry with number and content. */
export interface ChapterEntry {
  number: number;
  content: string;
  stateDiff?: StateDiffPayload;
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
  readonly chapters: readonly { readonly number: number; readonly content: string }[];
}

/**
 * Response payload for `GET /api/llm-defaults`. The route is contractually
 * obligated to return the full 12-key resolved-defaults snapshot (every field
 * populated from env or hard-coded fallback). The frontend's runtime
 * `validateLlmDefaultsBody` rejects partial responses, so making these fields
 * required here prevents drift between the route and the client contract.
 */
export interface LlmDefaultsResponse {
  readonly model: string;
  readonly temperature: number;
  readonly frequencyPenalty: number;
  readonly presencePenalty: number;
  readonly topK: number;
  readonly topP: number;
  readonly repetitionPenalty: number;
  readonly minP: number;
  readonly topA: number;
  readonly reasoningEnabled: boolean;
  readonly reasoningEffort: ReasoningEffort;
  readonly maxCompletionTokens: number;
}

/** RFC 9457 Problem Details response shape. */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  [key: string]: unknown;
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

/** LLM SSE stream chunk shape (OpenAI-compatible format). */
export interface LLMStreamChunk {
  choices?: ReadonlyArray<{
    delta?: {
      content?: string;
      /**
       * OpenRouter reasoning text shortcut. Populated by reasoning-capable
       * models when the upstream request includes `reasoning: { enabled: true }`.
       * Treat as the next slice of human-readable scratchpad text.
       */
      reasoning?: string;
      /**
       * Structured reasoning items. Each entry MAY carry a string `text` field
       * (extract those) plus opaque provider metadata such as `signature` or
       * `format` (ignore those).
       */
      reasoning_details?: ReadonlyArray<{
        type?: string;
        text?: string;
        signature?: string;
        format?: string;
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  /**
   * OpenRouter mid-stream error envelope. After HTTP 200 has been sent, errors
   * arrive as an SSE chunk with this top-level `error` field plus
   * `choices[0].finish_reason === "error"`.
   * See https://openrouter.ai/docs/api/reference/streaming#stream-cancellation.
   */
  error?: {
    message?: string;
    code?: number | string;
  } | null;
}

/**
 * One token-usage record appended to `<storyDir>/_usage.json` after each
 * successful chat generation that reported usage numbers from the upstream
 * provider. All fields are required and finite; `timestamp` is ISO-8601.
 */
export interface TokenUsageRecord {
  readonly chapter: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly model: string;
  readonly timestamp: string;
}

/** Aggregated totals over a list of `TokenUsageRecord`. */
export interface UsageTotals {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly count: number;
}

// ── WebSocket Message Types ──

/** Client-to-server: authentication handshake. */
export interface WsAuthMessage {
  readonly type: "auth";
  readonly passphrase: string;
}

/** Client-to-server: send a chat message. */
export interface WsChatSendMessage {
  readonly type: "chat:send";
  readonly id: string;
  readonly series: string;
  readonly story: string;
  readonly message: string;
}

/** Client-to-server: resend (delete last chapter + re-send). */
export interface WsChatResendMessage {
  readonly type: "chat:resend";
  readonly id: string;
  readonly series: string;
  readonly story: string;
  readonly message: string;
}

/** Client-to-server: subscribe to chapter updates for a story. */
export interface WsSubscribeMessage {
  readonly type: "subscribe";
  readonly series: string;
  readonly story: string;
}

/** Client-to-server: abort an active chat generation. */
export interface WsChatAbortMessage {
  readonly type: "chat:abort";
  readonly id: string;
}

/** All client-to-server message types. */
export type WsClientMessage =
  | WsAuthMessage
  | WsChatSendMessage
  | WsChatResendMessage
  | WsChatAbortMessage
  | WsSubscribeMessage;

/** Server-to-client: authentication successful. */
export interface WsAuthOkMessage {
  readonly type: "auth:ok";
}

/** Server-to-client: authentication failed. */
export interface WsAuthErrorMessage {
  readonly type: "auth:error";
  readonly detail: string;
}

/** Server-to-client: streaming LLM delta chunk. */
export interface WsChatDeltaMessage {
  readonly type: "chat:delta";
  readonly id: string;
  readonly content: string;
}

/** Server-to-client: generation complete. */
export interface WsChatDoneMessage {
  readonly type: "chat:done";
  readonly id: string;
  readonly usage?: TokenUsageRecord | null;
}

/** Server-to-client: chat error. */
export interface WsChatErrorMessage {
  readonly type: "chat:error";
  readonly id: string;
  readonly detail: string;
}

/** Server-to-client: chapter count changed. */
export interface WsChaptersUpdatedMessage {
  readonly type: "chapters:updated";
  readonly series: string;
  readonly story: string;
  readonly count: number;
}

/** Server-to-client: chapter content changed. */
export interface WsChaptersContentMessage {
  readonly type: "chapters:content";
  readonly series: string;
  readonly story: string;
  readonly chapter: number;
  readonly content: string;
  readonly stateDiff?: StateDiffPayload;
}

/** Server-to-client: generic protocol error. */
export interface WsErrorMessage {
  readonly type: "error";
  readonly detail: string;
}

/** Server-to-client: chat generation aborted. */
export interface WsChatAbortedMessage {
  readonly type: "chat:aborted";
  readonly id: string;
}

/** All server-to-client message types. */
export type WsServerMessage =
  | WsAuthOkMessage
  | WsAuthErrorMessage
  | WsChatDeltaMessage
  | WsChatDoneMessage
  | WsChatErrorMessage
  | WsChatAbortedMessage
  | WsChaptersUpdatedMessage
  | WsChaptersContentMessage
  | WsErrorMessage;
