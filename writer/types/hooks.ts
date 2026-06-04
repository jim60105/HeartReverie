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

import type { ChatMessage } from "./story.ts";
import type { TokenUsageRecord } from "./llm.ts";

/** Backend stages eligible for parallel dispatch declarations in manifest hooks[]. */
export type BackendParallelStage =
  | "prompt-assembly"
  | "post-response"
  | "response-stream"
  | "pre-llm-fetch";

/** Valid hook lifecycle stages. */
export type HookStage =
  | "prompt-assembly"
  | "pre-llm-fetch"
  | "response-stream"
  | "pre-write"
  | "post-response"
  | "strip-tags";

/**
 * Context payload dispatched for the `pre-llm-fetch` hook stage.
 *
 * Dispatched by `streamLlmAndPersist()` in `writer/lib/chat-shared.ts`
 * exactly once per upstream LLM request, immediately before the
 * `fetch(config.LLM_API_URL, ...)` call. Observation-only: mutating any
 * field SHALL NOT change the bytes posted upstream — the engine builds the
 * outgoing request body from local variables, not from this context.
 */
export interface PreLlmFetchPayload {
  /** Per-request correlation ID minted at the entry of `executeChat()` / `executeContinue()`. */
  readonly correlationId: string;
  /** Final messages array that will be serialised into `requestBody.messages`. */
  readonly messages: ReadonlyArray<ChatMessage>;
  /** Resolved upstream model name (`llmConfig.model`). */
  readonly model: string;
  /** Structured view of upstream sampler/control knobs (mirror of `requestBody` minus `messages`). */
  readonly requestMetadata: Readonly<Record<string, unknown>>;
  /** Absolute path to the story directory. */
  readonly storyDir: string;
  /** Series name under `playground/`. */
  readonly series: string;
  /** Story name under `playground/<series>/`. */
  readonly name: string;
  /** Discriminated write-mode tag (kind only is exposed; other fields stay internal). */
  readonly writeMode: { readonly kind: string };
  /** Logger injected by `HookDispatcher` at dispatch time. */
  readonly logger?: unknown;
}

/**
 * Context payload dispatched for the `post-response` hook stage.
 *
 * Dispatched by `streamLlmAndPersist()` in `writer/lib/chat-shared.ts`
 * exactly once per successful generation, in each of the four success
 * branches (`write-new-chapter`, `append-to-existing-chapter`,
 * `continue-last-chapter`, `replace-last-chapter`). Subscribers receive
 * the token-usage record (when available) and the resolved upstream
 * endpoint URL so they can attribute cost without re-reading
 * `_usage.json` or re-deriving the URL.
 *
 * The fully-assembled payload is deep-frozen at dispatch
 * (`Object.isFrozen(payload) === true`, recursively across nested
 * values including `usage`). Every field is `readonly`. Both top-level
 * reassignment (`ctx.usage = null`, `ctx.content = "..."`, …) and
 * nested mutation (`ctx.usage.totalTokens = 0`, adding new keys) SHALL
 * throw `TypeError` under strict mode (Deno ESM modules are strict).
 * This generalises the field-scoped deep-freeze contract that
 * `pre-llm-fetch` already establishes for `messages` / `requestMetadata`.
 */
export interface PostResponsePayload {
  /** Per-request correlation ID minted on entry to `executeChat()` / `executeContinue()`. */
  readonly correlationId: string;
  /** Full chapter file content for plugin-action append, bare LLM response otherwise. */
  readonly content: string;
  /** Absolute path to the story directory. */
  readonly storyDir: string;
  /** Series name under `playground/`. */
  readonly series: string;
  /** Story name under `playground/<series>/`. */
  readonly name: string;
  /** Absolute path to the engine root directory. */
  readonly rootDir: string;
  /** The chapter number written or appended to. */
  readonly chapterNumber: number;
  /** Absolute path of the chapter file written or appended to. */
  readonly chapterPath: string;
  /**
   * Discriminator for the originating success branch:
   * - `"chat"` for `write-new-chapter`
   * - `"continue"` for `continue-last-chapter`
   * - `"plugin-action"` for `append-to-existing-chapter` and `replace-last-chapter`
   */
  readonly source: "chat" | "continue" | "plugin-action";
  /** Set when `source === "plugin-action"`. */
  readonly pluginName?: string;
  /**
   * The wrapper tag applied by a plugin-action append:
   * - a non-empty string for a tagged append (`append: true` + `appendTag`);
   * - `null` for a tagless append (`append: true`, no `appendTag` — the model
   *   output was appended verbatim with no wrapper element).
   *
   * Omitted (absent) for `source === "chat"`, `source === "continue"`,
   * `replace`-mode plugin-action runs, and `discard`-mode runs. A `null`
   * value therefore unambiguously indicates a tagless plugin-action append,
   * distinct from "not an append" (omitted). Consumers MUST treat this as a
   * possibly-absent, possibly-`null` value and MUST NOT perform
   * unconditional string operations on it.
   */
  readonly appendedTag?: string | null;
  /**
   * Resolved upstream LLM API URL used for this request (the same URL
   * the engine `fetch()`-ed — sourced from `config.LLM_API_URL`). Plugins
   * may key per-endpoint pricing (e.g. `models[endpoint][model]`) on
   * this value without re-deriving it from environment state.
   */
  readonly endpoint: string;
  /**
   * Token-usage record for this completion, or `null` when the upstream
   * LLM omitted token counts (or emitted a partial triple). When non-null
   * the value is deep-frozen along with the surrounding payload, so
   * neither nested mutation nor top-level reassignment is possible.
   */
  readonly usage: TokenUsageRecord | null;
}

/**
 * Per-handler observation event emitted by `HookDispatcher`'s
 * `subscribeHandlerEvents` / per-plugin `onHandlerStart` / `onHandlerEnd`
 * surfaces. See `openspec/specs/hook-observability/spec.md`.
 *
 * Subscribers receive raw events synchronously; throwing subscribers are
 * isolated from dispatch and auto-unsubscribed after two consecutive throws.
 *
 * `ctxBeforeSnapshot` / `ctxAfterSnapshot` are `structuredClone` deep copies
 * of a per-stage allowlist of context fields (empty `{}` for non-allowlisted
 * stages). `reassigned` is computed by reference comparison of the live
 * pre-clone refs (so reassignment of top-level slots is detected without
 * false positives from clone identity).
 */
export type HandlerEvent =
  | {
    readonly kind: "handler-start";
    readonly stage: HookStage;
    readonly plugin: string | undefined;
    readonly priority: number;
    readonly handlerIndex: number;
    readonly correlationId: string | undefined;
    readonly timestamp: number;
    readonly ctxBeforeSnapshot: unknown;
    readonly ctxBeforeRefs: Readonly<Record<string, unknown>>;
  }
  | {
    readonly kind: "handler-end";
    readonly stage: HookStage;
    readonly plugin: string | undefined;
    readonly priority: number;
    readonly handlerIndex: number;
    readonly correlationId: string | undefined;
    readonly timestamp: number;
    readonly ctxAfterSnapshot: unknown;
    readonly ctxAfterRefs: Readonly<Record<string, unknown>>;
    readonly reassigned: ReadonlyArray<string>;
    readonly error: { readonly message: string; readonly name: string } | undefined;
    readonly durationMs: number;
  };

/** Subscriber callback for per-handler `HookDispatcher` events. */
export type HandlerEventSubscriber = (event: HandlerEvent) => void;

/**
 * Optional metadata recorded alongside a `subscribeHandlerEvents` registration
 * so introspection surfaces (`/api/_debug/hooks`,
 * `/api/plugin-introspection/hooks`) can attribute observer subscriptions back
 * to a plugin and to the kind(s) of events the subscriber filters.
 */
export interface HandlerEventSubscriptionOptions {
  /** Owning plugin name; surfaced in introspection. */
  readonly plugin?: string;
  /** Restricted event kind this subscriber observes ("handler-start" or "handler-end"). */
  readonly kind?: "handler-start" | "handler-end";
}

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
