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
import { readTemplate } from "../routes/prompt.ts";
import type { LlmConfig, TokenUsageRecord } from "../types.ts";
import {
  ContinuePromptError,
  resolveTargetChapterNumber,
} from "./story.ts";
import {
  resolveStoryLlmConfig,
  StoryConfigValidationError,
} from "./story-config.ts";
import { createLlmLogger, createLogger } from "./logger.ts";
import { buildRecord } from "./usage.ts";
import {
  clearGenerationActive,
  tryMarkGenerationActive,
} from "./generation-registry.ts";
import {
  ChatAbortError,
  ChatError,
  type ChatErrorCode,
  type ChatOptions,
  type ChatResult,
  type ContinueOptions,
  type ContinueResult,
  type StreamLlmArgs,
  type StreamLlmResult,
  type WriteMode,
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
  normaliseAppendContent,
  openChapterForStream,
  resolveChapterTarget,
  type StoryContext,
} from "./chat-chapter-io.ts";
import { consumeLlmStream } from "./chat-stream.ts";

export {
  ChatAbortError,
  ChatError,
  type ChatErrorCode,
  type ChatOptions,
  type ChatResult,
  type ContinueOptions,
  type ContinueResult,
  type StreamLlmArgs,
  type StreamLlmResult,
  type WriteMode,
};

// Re-exported so existing callers/tests that imported it from this module
// continue to work after the chapter-IO extraction. The implementation lives
// in `chat-chapter-io.ts` alongside the other chapter-persistence helpers.
export { normaliseAppendContent };

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
  const chapterContentAfter = await finalizeStreamMode({
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
  };
}

/**
 * Execute a chat request: resolve template, build prompt, call LLM with
 * streaming, write to file incrementally, and run lifecycle hooks. Thin
 * wrapper around `streamLlmAndPersist({ writeMode: { kind: "write-new-chapter" } })`
 * that handles the chat-specific prep work (auth, story config, prompt build,
 * generation-lock acquisition).
 */
export async function executeChat(options: ChatOptions): Promise<ChatResult> {
  const {
    series,
    name,
    message,
    template,
    config,
    safePath,
    hookDispatcher,
    buildPromptFromStory,
    onDelta,
    signal,
  } = options;
  const reqLog = log;

  reqLog.info("Chat execution started", { series, story: name, messageLength: message.length });

  // Mint the per-request correlationId at the inbound boundary so both
  // `prompt-assembly` (via buildPromptFromStory) and `pre-llm-fetch`
  // (inside streamLlmAndPersist) observe the same UUID.
  const correlationId = crypto.randomUUID();

  if (!Deno.env.get("LLM_API_KEY")) {
    reqLog.error("LLM_API_KEY not configured");
    throw new ChatError("api-key", "LLM_API_KEY is not configured", 500);
  }

  const storyDir = safePath(series, name);
  if (!storyDir) {
    throw new ChatError("bad-path", "Invalid path", 400);
  }

  let llmConfig: LlmConfig;
  try {
    llmConfig = await resolveStoryLlmConfig(storyDir, config.llmDefaults);
  } catch (err) {
    if (err instanceof StoryConfigValidationError) {
      reqLog.error("Invalid story _config.json", { series, story: name, error: err.message });
      throw new ChatError("story-config", `Invalid _config.json: ${err.message}`, 422);
    }
    const msg = errorMessage(err);
    reqLog.error("Failed to read story _config.json", { series, story: name, error: msg });
    throw new ChatError("story-config", "Failed to read story configuration", 500);
  }

  let templateOverride: string | undefined;
  if (typeof template === "string") {
    templateOverride = template;
  } else {
    try {
      const tpl = await readTemplate(config);
      if (tpl.source === "custom") {
        templateOverride = tpl.content;
      }
    } catch (err: unknown) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error(`[chat] Failed to read system prompt: ${errorMessage(err)}`);
      }
      // NotFound is expected — proceed with default
    }
  }

  const {
    messages: templateMessages,
    ventoError,
    chapterFiles,
    chapters,
  } = await buildPromptFromStory(series, name, storyDir, message, templateOverride, undefined, correlationId);

  if (ventoError) {
    throw new ChatError("vento", "Template rendering error", 422, ventoError);
  }

  if (templateMessages.length === 0) {
    throw new ChatError("no-prompt", "Failed to generate prompt", 500);
  }

  const targetChapterNumber = resolveTargetChapterNumber(chapterFiles, chapters);

  if (!tryMarkGenerationActive(series, name)) {
    throw new ChatError("concurrent", "Another generation is already in progress for this story", 409);
  }
  try {
    const result = await streamLlmAndPersist({
      messages: templateMessages,
      llmConfig,
      series,
      name,
      storyDir,
      rootDir: config.ROOT_DIR,
      signal,
      writeMode: { kind: "write-new-chapter", userMessage: message, targetChapterNumber },
      onDelta,
      hookDispatcher,
      config,
      correlationId,
    });
    return {
      chapter: result.chapterNumber ?? 0,
      content: result.chapterContentAfter ?? result.content,
      usage: result.usage,
    };
  } finally {
    clearGenerationActive(series, name);
  }
}

/**
 * Execute a continue-last-chapter request: re-read latest chapter, parse
 * `<user_message>` + assistant prefill, build prompt with the trailing
 * assistant turn (when prefill non-empty), then stream LLM output and
 * append to the existing chapter file. Translates `ContinuePromptError`
 * (from `parseChapterForContinue` failures) into `ChatError`.
 */
export async function executeContinue(options: ContinueOptions): Promise<ContinueResult> {
  const {
    series,
    name,
    template,
    config,
    safePath,
    hookDispatcher,
    buildContinuePromptFromStory,
    onDelta,
    signal,
  } = options;
  const reqLog = log;

  reqLog.info("Continue execution started", { series, story: name });

  // Mint correlationId at the inbound boundary; threaded through
  // prompt-assembly and pre-llm-fetch.
  const correlationId = crypto.randomUUID();

  if (!Deno.env.get("LLM_API_KEY")) {
    reqLog.error("LLM_API_KEY not configured");
    throw new ChatError("api-key", "LLM_API_KEY is not configured", 500);
  }

  const storyDir = safePath(series, name);
  if (!storyDir) {
    throw new ChatError("bad-path", "Invalid path", 400);
  }

  let llmConfig: LlmConfig;
  try {
    llmConfig = await resolveStoryLlmConfig(storyDir, config.llmDefaults);
  } catch (err) {
    if (err instanceof StoryConfigValidationError) {
      reqLog.error("Invalid story _config.json", { series, story: name, error: err.message });
      throw new ChatError("story-config", `Invalid _config.json: ${err.message}`, 422);
    }
    const msg = errorMessage(err);
    reqLog.error("Failed to read story _config.json", { series, story: name, error: msg });
    throw new ChatError("story-config", "Failed to read story configuration", 500);
  }

  let templateOverride: string | undefined;
  if (typeof template === "string") {
    templateOverride = template;
  } else {
    try {
      const tpl = await readTemplate(config);
      if (tpl.source === "custom") {
        templateOverride = tpl.content;
      }
    } catch (err: unknown) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error(`[chat] Failed to read system prompt: ${errorMessage(err)}`);
      }
      // NotFound is expected — proceed with default
    }
  }

  let promptResult;
  try {
    promptResult = await buildContinuePromptFromStory(series, name, storyDir, templateOverride, correlationId);
  } catch (err) {
    if (err instanceof ContinuePromptError) {
      throw new ChatError(err.code, err.message, err.httpStatus);
    }
    throw err;
  }

  const { messages, ventoError, targetChapterNumber, existingContent } = promptResult;

  if (ventoError) {
    throw new ChatError("vento", "Template rendering error", 422, ventoError);
  }
  if (messages.length === 0) {
    throw new ChatError("no-prompt", "Failed to generate prompt", 500);
  }

  if (!tryMarkGenerationActive(series, name)) {
    throw new ChatError("concurrent", "Another generation is already in progress for this story", 409);
  }
  try {
    const result = await streamLlmAndPersist({
      messages,
      llmConfig,
      series,
      name,
      storyDir,
      rootDir: config.ROOT_DIR,
      signal,
      writeMode: { kind: "continue-last-chapter", targetChapterNumber, existingContent },
      onDelta,
      hookDispatcher,
      config,
      correlationId,
    });
    return {
      chapter: result.chapterNumber ?? targetChapterNumber,
      content: result.chapterContentAfter ?? "",
      usage: result.usage,
    };
  } finally {
    clearGenerationActive(series, name);
  }
}
