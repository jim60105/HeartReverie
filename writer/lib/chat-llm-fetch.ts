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

import { errorMessage } from "./errors.ts";
import type {
  ChatMessage,
  LlmConfig,
  PreLlmFetchPayload,
} from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import { ChatAbortError, ChatError, type WriteMode } from "./chat-types.ts";

const log = createLogger("llm");

/**
 * Recursively freeze all own enumerable properties of `value`, including
 * array entries and nested objects. Used to make `pre-llm-fetch` payload
 * fields tamper-evident in strict mode so observer plugins cannot mutate
 * the shared snapshot and silently desync from the bytes posted upstream.
 *
 * Safe on primitives (returns as-is). Skips already-frozen subtrees to
 * avoid revisiting shared references in cyclic graphs (defence in depth —
 * `structuredClone` already breaks cycles upstream of the call site).
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const k of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[k]);
    }
  }
  return value;
}

/**
 * OpenRouter app-attribution headers attached to every upstream chat request.
 * See https://openrouter.ai/docs/app-attribution for the spec. Forks that want
 * to attribute their usage separately MUST edit this constant in source — the
 * values are intentionally not configurable at runtime.
 *
 * The X-OpenRouter-Title is plain ASCII because OpenRouter's rankings UI does
 * not render non-Latin-1 / percent-encoded characters legibly.
 */
export const LLM_APP_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "HTTP-Referer": "https://github.com/jim60105/HeartReverie",
  "X-OpenRouter-Title": "HeartReverie",
  "X-OpenRouter-Categories": "roleplay,creative-writing",
});

/**
 * Build the upstream LLM request body from the resolved `llmConfig` and
 * `messages`. Pure transformation — no I/O. `omitReasoning` mirrors the
 * `config.LLM_REASONING_OMIT` flag (some upstreams reject the `reasoning`
 * field entirely; setting this true omits it from the payload).
 */
export function buildLlmRequestBody(
  llmConfig: LlmConfig,
  messages: ChatMessage[],
  omitReasoning: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: llmConfig.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    usage: { include: true },
    temperature: llmConfig.temperature,
    frequency_penalty: llmConfig.frequencyPenalty,
    presence_penalty: llmConfig.presencePenalty,
    top_k: llmConfig.topK,
    top_p: llmConfig.topP,
    repetition_penalty: llmConfig.repetitionPenalty,
    min_p: llmConfig.minP,
    top_a: llmConfig.topA,
  };
  if (llmConfig.maxCompletionTokens !== null) {
    body.max_completion_tokens = llmConfig.maxCompletionTokens;
  }
  if (!omitReasoning) {
    body.reasoning = llmConfig.reasoningEnabled
      ? { enabled: true, effort: llmConfig.reasoningEffort }
      : { enabled: false };
  }
  return body;
}

/**
 * Dispatch the `pre-llm-fetch` observation hook. Derives `requestMetadata`
 * (the request body minus `messages`) internally so the hook payload
 * contract stays owned by this helper, not the caller.
 *
 * `messages` and `requestMetadata` are deep-cloned and deep-frozen, then
 * attached as non-writable enumerable properties so handlers cannot
 * reassign the outer keys (deep-freeze only protects the values; without
 * `writable: false`, `ctx.messages = []` would succeed and peer observers
 * in the parallel bucket would see the replaced reference).
 *
 * Per spec the upstream fetch proceeds regardless of dispatch failures;
 * we log a warning and return rather than rethrow.
 */
export async function dispatchPreLlmFetchHook(
  hookDispatcher: HookDispatcher,
  baseFields: Omit<PreLlmFetchPayload, "messages" | "requestMetadata" | "logger">,
  messages: ChatMessage[],
  requestBody: Record<string, unknown>,
): Promise<void> {
  const { messages: _omitMessages, ...requestMetadata } = requestBody;
  const payload: Record<string, unknown> = { ...baseFields };
  Object.defineProperty(payload, "messages", {
    value: deepFreeze(structuredClone(messages)),
    writable: false,
    enumerable: true,
    configurable: false,
  });
  Object.defineProperty(payload, "requestMetadata", {
    value: deepFreeze(structuredClone(requestMetadata)),
    writable: false,
    enumerable: true,
    configurable: false,
  });
  try {
    await hookDispatcher.dispatch("pre-llm-fetch", payload);
  } catch (err: unknown) {
    log.warn("pre-llm-fetch dispatch failed", {
      correlationId: baseFields.correlationId,
      error: errorMessage(err),
    });
  }
}

/**
 * POST the request body to the upstream LLM and return a streamable
 * `Response`. Maps the `fetch` exception, abort signal, non-2xx status,
 * and missing-body cases to `ChatError` / `ChatAbortError` and emits the
 * structured `LLM error` log entry that the analytics consumer relies on.
 *
 * Failures during downstream stream consumption (e.g., abort during the
 * non-OK body `.text()` read) bubble up unwrapped — same as the prior
 * inline behaviour.
 *
 * Caller-supplied `llmStartTime` is used to compute `latencyMs` for the
 * error logs (callers still need it for the downstream success path, so
 * the timestamp stays outside).
 */
export async function performLlmFetch(args: {
  apiUrl: string;
  requestBody: Record<string, unknown>;
  signal: AbortSignal | undefined;
  llmStartTime: number;
  model: string;
  reqLog: Logger;
  llmLog: Logger;
}): Promise<Response & { body: ReadableStream<Uint8Array> }> {
  const { apiUrl, requestBody, signal, llmStartTime, model, reqLog, llmLog } = args;
  let apiResponse: Response;
  try {
    apiResponse = await fetch(apiUrl, {
      method: "POST",
      headers: {
        ...LLM_APP_ATTRIBUTION_HEADERS,
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("LLM_API_KEY")}`,
      },
      body: JSON.stringify(requestBody),
      signal,
    });
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - llmStartTime);
    if (signal?.aborted === true) {
      llmLog.info("LLM error", { type: "error", errorCode: "aborted", latencyMs });
      throw new ChatAbortError("Generation aborted by client");
    }
    const errMsg = errorMessage(err);
    reqLog.error("LLM fetch failed", { latencyMs, error: errMsg });
    llmLog.info("LLM error", { type: "error", errorCode: "network", latencyMs, error: errMsg });
    throw new ChatError("llm-api", "AI service request failed", 502);
  }

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text();
    const latencyMs = Math.round(performance.now() - llmStartTime);
    reqLog.error("LLM API error", { status: apiResponse.status, latencyMs, model, errorBody });
    llmLog.info("LLM error", {
      type: "error",
      errorCode: "llm-api",
      httpStatus: apiResponse.status,
      latencyMs,
      errorBody,
    });
    const truncated = errorBody.length > 2000
      ? `${errorBody.slice(0, 2000)}…[truncated]`
      : errorBody;
    const detailMessage = truncated.length > 0
      ? `AI service request failed: ${truncated}`
      : "AI service request failed";
    throw new ChatError("llm-api", detailMessage, apiResponse.status);
  }

  if (!apiResponse.body) {
    const noBodyLatency = Math.round(performance.now() - llmStartTime);
    llmLog.info("LLM error", { type: "error", errorCode: "no-body", latencyMs: noBodyLatency });
    throw new ChatError("no-body", "No response body from AI service", 502);
  }

  return apiResponse as Response & { body: ReadableStream<Uint8Array> };
}

/**
 * Emit the two pre-fetch log entries (`debug` for ops + `info` on the
 * audit-stream logger). Pure observability — no I/O beyond the loggers.
 * Computes `roleCounts` once and reuses it across both entries.
 */
export function logLlmRequest(args: {
  reqLog: Logger;
  llmLog: Logger;
  writeMode: WriteMode;
  llmConfig: LlmConfig;
  messages: ChatMessage[];
  series: string;
  name: string;
  reasoningOmit: boolean;
}): void {
  const { reqLog, llmLog, writeMode, llmConfig, messages, series, name, reasoningOmit } = args;
  const roleCounts: Record<ChatMessage["role"], number> = { system: 0, user: 0, assistant: 0 };
  for (const m of messages) roleCounts[m.role]++;

  reqLog.debug("LLM request payload", {
    mode: writeMode.kind,
    model: llmConfig.model,
    temperature: llmConfig.temperature,
    reasoningEnabled: llmConfig.reasoningEnabled,
    reasoningEffort: llmConfig.reasoningEffort,
    maxCompletionTokens: llmConfig.maxCompletionTokens,
    messageCount: messages.length,
    roleCounts,
  });

  llmLog.info("LLM request", {
    type: "request",
    series,
    story: name,
    model: llmConfig.model,
    parameters: {
      temperature: llmConfig.temperature,
      frequencyPenalty: llmConfig.frequencyPenalty,
      presencePenalty: llmConfig.presencePenalty,
      topK: llmConfig.topK,
      topP: llmConfig.topP,
      repetitionPenalty: llmConfig.repetitionPenalty,
      minP: llmConfig.minP,
      topA: llmConfig.topA,
      reasoningEnabled: llmConfig.reasoningEnabled,
      reasoningEffort: llmConfig.reasoningEffort,
      maxCompletionTokens: llmConfig.maxCompletionTokens,
    },
    reasoningOmit,
    messages,
    messageCount: messages.length,
    roleCounts,
  });
}
