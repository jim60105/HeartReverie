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
 * @module llm-transport
 *
 * Transport planning: turns a validated OpenAI-SDK-style base URL into the
 * concrete endpoint URLs for both wire protocols, and decides the ordered list
 * of transports a single generation may attempt.
 *
 * The fallback capability cache is process-local and keyed by
 * (Responses URL, model): once an `auto` generation has fallen back to Chat
 * Completions successfully, later `auto` generations for that pair skip the
 * Responses probe entirely.
 */

import type { LlmApiMode, LlmTransport } from "../types/llm.ts";
import type { WriteMode } from "./chat-types.ts";

/** Concrete endpoint URLs derived from `LLM_API_BASE_URL`. */
export interface LlmEndpoints {
  readonly chatCompletionsUrl: string;
  readonly responsesUrl: string;
}

/**
 * Statuses that unambiguously mean "this upstream does not implement the
 * Responses API". Only these trigger the auto-mode fallback.
 */
export const RESPONSES_UNSUPPORTED_STATUSES: ReadonlySet<number> = new Set([404, 405, 501]);

/** Fallback cache entries: `${responsesUrl}\n${model}`. */
const fallbackCache = new Set<string>();

function cacheKey(endpoints: LlmEndpoints, model: string): string {
  return `${endpoints.responsesUrl}\n${model}`;
}

/**
 * Derive both transport URLs from `baseUrl` by removing every trailing `/`
 * and appending the transport path. No validation happens here — `config.ts`
 * already rejected full-endpoint and otherwise malformed base URLs.
 */
export function buildLlmEndpoints(baseUrl: string): LlmEndpoints {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    chatCompletionsUrl: `${base}/chat/completions`,
    responsesUrl: `${base}/responses`,
  };
}

/**
 * Plan the ordered transports for one generation.
 *
 * - `chat-completions` → only Chat Completions.
 * - `responses` → only Responses.
 * - `auto` → `["chat-completions"]` for `continue-last-chapter` (its
 *   trailing-assistant prefill is a Chat Completions behaviour) or when a
 *   fallback is cached for the pair; otherwise `["responses", "chat-completions"]`.
 */
export function planLlmTransports(
  mode: LlmApiMode,
  endpoints: LlmEndpoints,
  model: string,
  writeModeKind: WriteMode["kind"],
): readonly LlmTransport[] {
  if (mode === "chat-completions") return ["chat-completions"];
  if (mode === "responses") return ["responses"];
  if (writeModeKind === "continue-last-chapter") return ["chat-completions"];
  if (fallbackCache.has(cacheKey(endpoints, model))) return ["chat-completions"];
  return ["responses", "chat-completions"];
}

/** Resolve the full URL for a single transport. */
export function transportUrl(transport: LlmTransport, endpoints: LlmEndpoints): string {
  return transport === "responses" ? endpoints.responsesUrl : endpoints.chatCompletionsUrl;
}

/**
 * Record that Chat Completions served a generation after the Responses
 * endpoint was found unsupported. Later `auto` generations for the same
 * (Responses URL, model) pair skip the Responses probe.
 */
export function recordChatCompletionsFallback(endpoints: LlmEndpoints, model: string): void {
  fallbackCache.add(cacheKey(endpoints, model));
}

/** Test helper: clear every cached fallback capability. */
export function resetLlmTransportCache(): void {
  fallbackCache.clear();
}
