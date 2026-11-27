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
 * @module llm-stream-frames
 *
 * Pure normalisers that turn one parsed SSE JSON payload — Chat Completions or
 * Responses — into the same {@link LlmStreamFrame} shape. No I/O, no logging,
 * no state: `consumeLlmStream` owns the `<think>` state machine and the usage
 * accumulator, this module only interprets a single event.
 */

import type { LLMStreamChunk } from "../types/llm.ts";

/** Token usage reported by a single stream event; every field is `null` when absent. */
export interface LlmStreamUsage {
  readonly prompt: number | null;
  readonly completion: number | null;
  readonly total: number | null;
  readonly cost: number | null;
}

/** Transport-agnostic view of one stream event. */
export interface LlmStreamFrame {
  /** Output text delta; `""` when the event carries none. */
  readonly content: string;
  /** Reasoning delta; `""` when the event carries none. */
  readonly reasoning: string;
  /** Which reasoning channel produced {@link reasoning}; `null` iff it is `""`. */
  readonly reasoningKind: "text" | "summary" | null;
  /** Usage reported by this event, or `null`. */
  readonly usage: LlmStreamUsage | null;
  /** Provider error message when this event is an error, else `null`. */
  readonly error: string | null;
}

/** Shared empty frame; every normaliser spreads it and overrides what it read. */
const EMPTY_FRAME: LlmStreamFrame = {
  content: "",
  reasoning: "",
  reasoningKind: null,
  usage: null,
  error: null,
};

/**
 * Resolve the provider error message: a non-empty string `message`, else
 * `String(code)` when the code is defined, else a generic fallback.
 */
function providerErrorMessage(messageRaw: unknown, codeRaw: unknown): string {
  if (typeof messageRaw === "string" && messageRaw.length > 0) return messageRaw;
  if (codeRaw !== undefined) return String(codeRaw);
  return "Mid-stream provider error";
}

/**
 * Normalise one Chat Completions SSE payload.
 *
 * Reasoning extraction priority: `delta.reasoning`, then
 * `delta.reasoning_content` (DeepSeek / vLLM), then the in-order concatenation
 * of `delta.reasoning_details[].text`. Reasoned frames are always kind
 * `"text"` on this transport.
 */
export function parseChatCompletionsFrame(raw: unknown): LlmStreamFrame {
  if (typeof raw !== "object" || raw === null) return EMPTY_FRAME;
  const parsed = raw as LLMStreamChunk;

  const errObj = parsed.error;
  const hasErrorField = typeof errObj === "object" && errObj !== null;
  const finishedWithError = parsed.choices?.[0]?.finish_reason === "error";
  if (hasErrorField || finishedWithError) {
    return { ...EMPTY_FRAME, error: providerErrorMessage(errObj?.message, errObj?.code) };
  }

  const delta = parsed.choices?.[0]?.delta;
  const content = typeof delta?.content === "string" ? delta.content : "";

  let reasoning = "";
  if (typeof delta?.reasoning === "string" && delta.reasoning.length > 0) {
    reasoning = delta.reasoning;
  } else if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
    reasoning = delta.reasoning_content;
  } else if (Array.isArray(delta?.reasoning_details)) {
    for (const item of delta.reasoning_details) {
      if (item && typeof item === "object") {
        const text = item.text;
        if (typeof text === "string" && text.length > 0) reasoning += text;
      }
    }
  }

  let usage: LlmStreamUsage | null = null;
  if (parsed.usage) {
    const costRaw = (parsed.usage as Record<string, unknown>).cost;
    usage = {
      prompt: (parsed.usage.prompt_tokens ?? null) as number | null,
      completion: (parsed.usage.completion_tokens ?? null) as number | null,
      total: (parsed.usage.total_tokens ?? null) as number | null,
      cost: typeof costRaw === "number" && isFinite(costRaw) && costRaw >= 0 ? costRaw : null,
    };
  }

  return {
    content,
    reasoning,
    reasoningKind: reasoning.length > 0 ? "text" : null,
    usage,
    error: null,
  };
}

/**
 * Normalise one Responses API SSE payload by its `type` field.
 *
 * - `response.output_text.delta` → content.
 * - `response.reasoning_text.delta` / `response.reasoning_summary_text.delta` → reasoning.
 * - `response.reasoning_summary_part.added` with `summary_index > 0` → a `"\n\n"` separator.
 * - `response.completed` / `response.incomplete` → usage.
 * - `response.failed`, `error`, and any top-level `error` object → error.
 * - Anything else (including `[DONE]`, handled by the caller) → empty frame.
 */
export function parseResponsesFrame(raw: unknown): LlmStreamFrame {
  if (typeof raw !== "object" || raw === null) return EMPTY_FRAME;
  const event = raw as Record<string, unknown>;

  const topLevelError = event.error;
  if (typeof topLevelError === "object" && topLevelError !== null) {
    const err = topLevelError as Record<string, unknown>;
    return { ...EMPTY_FRAME, error: providerErrorMessage(err.message, err.code) };
  }

  switch (event.type) {
    case "response.output_text.delta": {
      const delta = event.delta;
      return typeof delta === "string" && delta.length > 0
        ? { ...EMPTY_FRAME, content: delta }
        : EMPTY_FRAME;
    }
    case "response.reasoning_text.delta": {
      const delta = event.delta;
      return typeof delta === "string" && delta.length > 0
        ? { ...EMPTY_FRAME, reasoning: delta, reasoningKind: "text" }
        : EMPTY_FRAME;
    }
    case "response.reasoning_summary_text.delta": {
      const delta = event.delta;
      return typeof delta === "string" && delta.length > 0
        ? { ...EMPTY_FRAME, reasoning: delta, reasoningKind: "summary" }
        : EMPTY_FRAME;
    }
    case "response.reasoning_summary_part.added": {
      const index = event.summary_index;
      return typeof index === "number" && index > 0
        ? { ...EMPTY_FRAME, reasoning: "\n\n", reasoningKind: "summary" }
        : EMPTY_FRAME;
    }
    case "response.completed":
    case "response.incomplete": {
      const response = event.response;
      if (typeof response !== "object" || response === null) return EMPTY_FRAME;
      const usageRaw = (response as Record<string, unknown>).usage;
      if (typeof usageRaw !== "object" || usageRaw === null) return EMPTY_FRAME;
      const usage = usageRaw as Record<string, unknown>;
      const costRaw = usage.cost;
      return {
        ...EMPTY_FRAME,
        usage: {
          prompt: (usage.input_tokens ?? null) as number | null,
          completion: (usage.output_tokens ?? null) as number | null,
          total: (usage.total_tokens ?? null) as number | null,
          cost: typeof costRaw === "number" && isFinite(costRaw) && costRaw >= 0 ? costRaw : null,
        },
      };
    }
    case "response.failed": {
      const response = event.response;
      const errorRaw = typeof response === "object" && response !== null
        ? (response as Record<string, unknown>).error
        : undefined;
      const err = typeof errorRaw === "object" && errorRaw !== null
        ? errorRaw as Record<string, unknown>
        : undefined;
      return { ...EMPTY_FRAME, error: providerErrorMessage(err?.message, err?.code) };
    }
    case "error":
      return { ...EMPTY_FRAME, error: providerErrorMessage(event.message, event.code) };
    default:
      return EMPTY_FRAME;
  }
}
