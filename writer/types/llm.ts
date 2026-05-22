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
   * for reasoning-capable models). Must be a positive safe integer, OR `null`
   * meaning "no application-level limit; let the upstream provider decide" —
   * in which case the `max_completion_tokens` key is omitted from the upstream
   * request body entirely.
   */
  readonly maxCompletionTokens: number | null;
}

/**
 * Per-story override bag — every field is optional. Includes the optional
 * `reasoningEnabled` / `reasoningEffort` overrides.
 */
export type StoryLlmConfigOverrides = Partial<LlmConfig>;

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
  readonly maxCompletionTokens: number | null;
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
    /**
     * Upstream-billed cost in USD. Currently emitted by OpenRouter when the
     * request body opts into usage accounting via `usage: { include: true }`.
     * Other OpenAI-compatible providers ignore the opt-in and omit this field.
     */
    cost?: number;
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
  /**
   * Upstream-billed cost in USD, when the LLM provider reports it
   * (e.g. OpenRouter when the request opts into usage accounting).
   * `null` (or missing) when the provider does not report a cost.
   */
  readonly upstreamCostUsd?: number | null;
}

/** Aggregated totals over a list of `TokenUsageRecord`. */
export interface UsageTotals {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly count: number;
}
