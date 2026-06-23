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
 * @module chat-stream-and-persist
 *
 * The streaming LLM coordinator. Given an already-resolved prompt +
 * config (the caller — `executeChat`, `executeContinue`, or
 * `plugin-actions-execute` — performs preflight), this module runs the
 * upstream request, consumes the SSE stream into the appropriate chapter
 * destination, builds the usage record, and dispatches mode-specific
 * finalization (lifecycle hooks + on-disk persistence) via
 * `chat-chapter-finalize`.
 *
 * Splits out from `chat-shared.ts` so the high-level chat/continue
 * entrypoints can read top-to-bottom as thin preflight + delegate calls.
 */

import type { TokenUsageRecord } from "../types.ts";
import { createLlmLogger, createLogger } from "./logger.ts";
import { buildRecord } from "./usage.ts";
import {
  ChatAbortError,
  ChatError,
  type StreamLlmArgs,
  type StreamLlmResult,
} from "./chat-types.ts";
import {
  buildLlmRequestBody,
  dispatchPreLlmFetchHook,
  logLlmRequest,
  performLlmFetch,
} from "./chat-llm-fetch.ts";
import {
  type ChapterTarget,
  finalizeStreamMode,
  openChapterForStream,
  resolveChapterTarget,
  type StoryContext,
} from "./chat-chapter-io.ts";
import { consumeLlmStream } from "./chat-stream.ts";

const log = createLogger("llm");
const fileLog = createLogger("file");

/**
 * Stream the upstream LLM response and persist it according to `writeMode`.
 *
 * The caller is responsible for: validating the upstream API key, resolving
 * `storyDir`, resolving `llmConfig`, building the `messages` array, and
 * acquiring/releasing the per-story generation lock. This helper focuses on
 * the OpenRouter request, SSE streaming, mode-specific persistence, and the
 * lifecycle hook dispatches associated with each mode.
 */
export async function streamLlmAndPersist(args: StreamLlmArgs): Promise<StreamLlmResult> {
  const {
    messages,
    llmConfig,
    series,
    name,
    storyDir,
    rootDir,
    signal,
    writeMode,
    onDelta,
    hookDispatcher,
    config,
    correlationId: correlationIdInput,
  } = args;

  // Always have a non-empty correlationId for downstream hook contexts.
  // Inbound chat/continue paths supply this; legacy/test paths fall back
  // to a fresh UUID.
  const correlationId = correlationIdInput ?? crypto.randomUUID();
  const reqLog = log.withContext({ correlationId });
  const reqFileLog = fileLog.withContext({ correlationId });
  const llmLog = createLlmLogger().withContext({ correlationId });

  // ── Resolve target chapter info (mode-dependent) ──
  const { targetNum, chapterPath } = await resolveChapterTarget(writeMode, storyDir);
  if (writeMode.kind === "write-new-chapter") {
    await Deno.mkdir(storyDir, { recursive: true, mode: 0o775 });
  }
  const target: ChapterTarget = { chapterPath, targetNum };
  const storyCtx: StoryContext = { storyDir, rootDir, series, name, correlationId };

  // ── Build upstream request body ──
  logLlmRequest({
    reqLog,
    llmLog,
    writeMode,
    llmConfig,
    messages,
    series,
    name,
    reasoningOmit: config.LLM_REASONING_OMIT,
  });

  const requestBody = buildLlmRequestBody(llmConfig, messages, config.LLM_REASONING_OMIT);

  // Dispatch the `pre-llm-fetch` observation hook AFTER `requestBody` is
  // fully constructed and BEFORE `fetch(config.LLM_API_URL, ...)` so handlers
  // see the exact serialisation we are about to send.
  await dispatchPreLlmFetchHook(
    hookDispatcher,
    {
      correlationId,
      model: llmConfig.model,
      storyDir,
      series,
      name,
      writeMode: { kind: writeMode.kind },
    },
    messages,
    requestBody,
  );

  const llmStartTime = performance.now();
  const apiResponse = await performLlmFetch({
    apiUrl: config.LLM_API_URL,
    requestBody,
    signal,
    llmStartTime,
    model: llmConfig.model,
    reqLog,
    llmLog,
  });

  // ── Mode-specific persistence setup ──
  const encoder = new TextEncoder();

  const { file, preContent } = await openChapterForStream({
    writeMode,
    target,
    storyCtx,
    hookDispatcher,
    reqFileLog,
    encoder,
  });

  // ── Consume the SSE stream (takes ownership of `file`) ──
  const { aiContent, sawModelContent, aborted, reasoningLength, tokenUsage } =
    await consumeLlmStream({
      apiResponse,
      file,
      encoder,
      writeMode,
      target,
      storyCtx,
      signal,
      onDelta,
      hookDispatcher,
      reqLog,
      llmLog,
      llmStartTime,
    });

  // ── Abort handling ──
  if (aborted) {
    const latencyMs = Math.round(performance.now() - llmStartTime);
    reqLog.warn("Generation aborted by client", { latencyMs, contentLength: aiContent.length });
    llmLog.info("LLM response", {
      type: "response",
      response: preContent + aiContent,
      latencyMs,
      chapter: targetNum,
      tokens: tokenUsage,
      aborted: true,
      partialLength: aiContent.length,
      reasoningLength,
    });
    throw new ChatAbortError("Generation aborted by client");
  }

  if (!sawModelContent) {
    const noContentLatency = Math.round(performance.now() - llmStartTime);
    reqLog.error("No content in AI response", { model: llmConfig.model });
    llmLog.info("LLM error", {
      type: "error",
      errorCode: "no-content",
      latencyMs: noContentLatency,
      model: llmConfig.model,
      reasoningLength,
    });
    throw new ChatError("no-content", "No content in AI response", 502);
  }

  const fullContent = preContent + aiContent;
  const latencyMs = Math.round(performance.now() - llmStartTime);
  reqLog.info("LLM response completed", {
    model: llmConfig.model,
    latencyMs,
    contentLength: fullContent.length,
    chapter: targetNum,
    mode: writeMode.kind,
  });
  reqLog.debug("LLM response content", { content: fullContent });
  llmLog.info("LLM response", {
    type: "response",
    response: fullContent,
    latencyMs,
    chapter: targetNum,
    tokens: tokenUsage,
    reasoningLength,
  });

  // ── Build usage record (always, regardless of mode) ──
  let usage: TokenUsageRecord | null = null;
  if (tokenUsage.prompt !== null && tokenUsage.completion !== null && tokenUsage.total !== null) {
    usage = buildRecord({
      chapter: targetNum ?? 0,
      promptTokens: tokenUsage.prompt,
      completionTokens: tokenUsage.completion,
      totalTokens: tokenUsage.total,
      model: llmConfig.model,
      upstreamCostUsd: tokenUsage.cost,
    });
  } else {
    reqLog.debug("Usage unavailable from upstream", { chapter: targetNum, model: llmConfig.model });
  }

  // ── Mode-specific finalization ──
  const { content: chapterContentAfter, insertedCount } = await finalizeStreamMode({
    writeMode,
    target,
    aiContent,
    fullContent,
    usage,
    endpoint: config.LLM_API_URL,
    storyCtx,
    hookDispatcher,
    reqFileLog,
    encoder,
  });

  return {
    content: aiContent,
    usage,
    chapterPath,
    chapterNumber: targetNum,
    chapterContentAfter,
    aborted: false,
    insertedCount,
  };
}
