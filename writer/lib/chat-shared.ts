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

import { join } from "@std/path";
import { readTemplate } from "../routes/prompt.ts";
import type { AppConfig, LlmConfig, SafePathFn, BuildPromptFn, LLMStreamChunk, VentoError, TokenUsageRecord } from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";
import { resolveTargetChapterNumber } from "./story.ts";
import { resolveStoryLlmConfig, StoryConfigValidationError } from "./story-config.ts";
import { createLogger, createLlmLogger } from "./logger.ts";
import { appendUsage, buildRecord } from "./usage.ts";
import { markGenerationActive, clearGenerationActive } from "./generation-registry.ts";

const log = createLogger("llm");
const fileLog = createLogger("file");

/**
 * OpenRouter app-attribution headers attached to every upstream chat request.
 * See https://openrouter.ai/docs/app-attribution for the spec. Forks that want
 * to attribute their usage separately MUST edit this constant in source — the
 * values are intentionally not configurable at runtime.
 *
 * The X-OpenRouter-Title is plain ASCII because OpenRouter's rankings UI does
 * not render non-Latin-1 / percent-encoded characters legibly.
 */
const LLM_APP_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "HTTP-Referer": "https://github.com/jim60105/HeartReverie",
  "X-OpenRouter-Title": "HeartReverie",
  "X-OpenRouter-Categories": "roleplay,creative-writing",
});

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

/** Error thrown when a chat generation is aborted by the client. */
export class ChatAbortError extends Error {
  override readonly name = "ChatAbortError";
}

/** Error thrown when chat execution encounters a known failure. */
export class ChatError extends Error {
  override readonly name = "ChatError";
  constructor(
    public readonly code: "api-key" | "bad-path" | "vento" | "no-prompt" | "llm-api" | "llm-stream" | "no-body" | "no-content" | "story-config",
    message: string,
    public readonly httpStatus: number = 500,
    public readonly ventoError?: VentoError,
  ) {
    super(message);
  }
}

/**
 * Execute a chat request: resolve template, build prompt, call LLM with streaming,
 * write to file incrementally, run post-response hooks.
 * @param options - Chat execution options including callbacks and dependencies
 * @returns The chapter number and full generated content
 */
export async function executeChat(options: ChatOptions): Promise<ChatResult> {
  const { series, name, message, template, config, safePath, hookDispatcher, buildPromptFromStory, onDelta, signal } = options;
  const correlationId = crypto.randomUUID();
  const reqLog = log.withContext({ correlationId });
  const reqFileLog = fileLog.withContext({ correlationId });
  const llmLog = createLlmLogger().withContext({ correlationId });

  reqLog.info("Chat execution started", { series, story: name, messageLength: message.length });

  // 1. Validate API key
  if (!Deno.env.get("LLM_API_KEY")) {
    reqLog.error("LLM_API_KEY not configured");
    throw new ChatError("api-key", "LLM_API_KEY is not configured", 500);
  }

  // 2. Resolve story directory
  const storyDir = safePath(series, name);
  if (!storyDir) {
    throw new ChatError("bad-path", "Invalid path", 400);
  }

  // 2b. Load per-story LLM overrides merged over env defaults
  let llmConfig: LlmConfig;
  try {
    llmConfig = await resolveStoryLlmConfig(storyDir, config.llmDefaults);
  } catch (err) {
    if (err instanceof StoryConfigValidationError) {
      reqLog.error("Invalid story _config.json", { series, story: name, error: err.message });
      throw new ChatError("story-config", `Invalid _config.json: ${err.message}`, 422);
    }
    const msg = err instanceof Error ? err.message : String(err);
    reqLog.error("Failed to read story _config.json", { series, story: name, error: msg });
    throw new ChatError("story-config", "Failed to read story configuration", 500);
  }

  // 3. Resolve template: body override > custom file > system.md
  let templateOverride: string | undefined;
  if (typeof template === "string") {
    templateOverride = template;
  } else {
    try {
      const tpl = await readTemplate(config);
      if (tpl.source === "custom") {
        templateOverride = tpl.content;
      }
    } catch {
      // No custom file and no system.md readable — proceed with default rendering
    }
  }

  // 4. Build prompt
  const {
    prompt: systemPrompt,
    ventoError,
    chapterFiles,
    chapters,
  } = await buildPromptFromStory(series, name, storyDir, message, templateOverride);

  if (ventoError) {
    throw new ChatError("vento", "Template rendering error", 422, ventoError);
  }

  if (!systemPrompt) {
    throw new ChatError("no-prompt", "Failed to generate prompt", 500);
  }

  // Mark this story as having an active generation; guard destructive
  // edits/rewinds/branches from concurrent writers. The matching clear
  // runs in the `finally` block at the end of this function.
  markGenerationActive(series, name);
  try {

  // 5. Call LLM API with streaming
  const messages: Array<{ role: string; content: string }> = [
    { role: "system", content: systemPrompt },
    { role: "user", content: message },
  ];

  reqLog.debug("LLM request payload", {
    model: llmConfig.model,
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
    reasoningOmit: config.LLM_REASONING_OMIT,
    systemPromptLength: systemPrompt.length,
    userMessageLength: message.length,
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
    reasoningOmit: config.LLM_REASONING_OMIT,
    systemPrompt,
    userMessage: message,
  });

  const llmStartTime = performance.now();
  let apiResponse: Response;
  // Build the upstream request body. The `reasoning` block is included by
  // default; deployments targeting strict OpenAI-compatible providers can
  // suppress it entirely with `LLM_REASONING_OMIT=true`.
  const requestBody: Record<string, unknown> = {
    model: llmConfig.model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: llmConfig.temperature,
    frequency_penalty: llmConfig.frequencyPenalty,
    presence_penalty: llmConfig.presencePenalty,
    top_k: llmConfig.topK,
    top_p: llmConfig.topP,
    repetition_penalty: llmConfig.repetitionPenalty,
    min_p: llmConfig.minP,
    top_a: llmConfig.topA,
    max_completion_tokens: llmConfig.maxCompletionTokens,
  };
  if (!config.LLM_REASONING_OMIT) {
    requestBody.reasoning = llmConfig.reasoningEnabled
      ? { enabled: true, effort: llmConfig.reasoningEffort }
      : { enabled: false };
  }
  try {
    apiResponse = await fetch(config.LLM_API_URL, {
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
    const errMsg = err instanceof Error ? err.message : String(err);
    reqLog.error("LLM fetch failed", { latencyMs, error: errMsg });
    llmLog.info("LLM error", { type: "error", errorCode: "network", latencyMs, error: errMsg });
    throw new ChatError("llm-api", "AI service request failed", 502);
  }

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text();
    const latencyMs = Math.round(performance.now() - llmStartTime);
    reqLog.error("LLM API error", {
      status: apiResponse.status,
      latencyMs,
      model: llmConfig.model,
      errorBody,
    });
    llmLog.info("LLM error", {
      type: "error",
      errorCode: "llm-api",
      httpStatus: apiResponse.status,
      latencyMs,
      errorBody,
    });
    // Surface a truncated copy of the upstream body so the RFC 9457 detail
    // returned to the client is diagnosable end-to-end (full body remains in
    // the operational log entry above).
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
    llmLog.info("LLM error", {
      type: "error",
      errorCode: "no-body",
      latencyMs: noBodyLatency,
    });
    throw new ChatError("no-body", "No response body from AI service", 502);
  }

  // 6. Determine target chapter: reuse last empty file or create next
  const targetNum: number = resolveTargetChapterNumber(chapterFiles, chapters);
  const padded = String(targetNum).padStart(3, "0");

  await Deno.mkdir(storyDir, { recursive: true, mode: 0o775 });

  const chapterPath = join(storyDir, `${padded}.md`);
  const encoder = new TextEncoder();
  let aiContent = "";
  let sawModelContent = false;
  reqFileLog.info("Writing chapter file", { op: "write", path: chapterPath, chapter: targetNum });

  // Dispatch pre-write hook before file truncation
  const preWriteCtx = await hookDispatcher.dispatch("pre-write", {
    correlationId,
    message,
    chapterPath,
    storyDir,
    series,
    name,
    preContent: "",
  });
  const preContent = preWriteCtx.preContent as string;

  const file = await Deno.open(chapterPath, { write: true, create: true, truncate: true, mode: 0o664 });
  if (preContent) {
    await file.write(encoder.encode(preContent));
  }

  let aborted = false;
  // Reasoning streaming state. Reasoning text from `delta.reasoning` (or the
  // fallback `delta.reasoning_details[].text`) is framed as `<think>...</think>`
  // blocks placed between the `<user_message>` prefix and the model content.
  // Reasoning bytes bypass the `response-stream` hook and the `aiContent`
  // accumulator — see openspec capability `reasoning-think-block`.
  let inThinkBlock = false;
  let reasoningLength = 0;

  /**
   * Extract reasoning text from a stream chunk's delta. Prefer the simple
   * `delta.reasoning` string; otherwise concatenate `text` fields from
   * `delta.reasoning_details` items, silently skipping any entry whose `text`
   * is not a non-empty string. Returns `""` when no reasoning is present.
   */
  const extractReasoningText = (delta: unknown): string => {
    if (!delta || typeof delta !== "object") return "";
    const direct = (delta as { reasoning?: unknown }).reasoning;
    if (typeof direct === "string" && direct.length > 0) return direct;
    const details = (delta as { reasoning_details?: unknown }).reasoning_details;
    if (!Array.isArray(details)) return "";
    let out = "";
    for (const item of details) {
      if (item && typeof item === "object") {
        const t = (item as { text?: unknown }).text;
        if (typeof t === "string" && t.length > 0) out += t;
      }
    }
    return out;
  };

  /**
   * Persist reasoning bytes: write to chapter file FIRST, then notify
   * `onDelta`. Callers MUST update state-machine flags AFTER `writeFile()`
   * returns and BEFORE calling `notifyDelta()` so a thrown `onDelta` does not
   * leave `inThinkBlock` inconsistent with what is on disk.
   */
  const writeFile = (bytes: string): Promise<number> => file.write(encoder.encode(bytes));
  const notifyDelta = (bytes: string): void => { onDelta?.(bytes); };

  /**
   * Close the open `<think>` block (if any) with a single trailing newline,
   * intended for the streaming `finally` (no content follows). State is
   * cleared after the file write succeeds; an onDelta failure after the
   * write is propagated by the caller's nested try/catch and does not
   * re-open the block.
   */
  const closeThinkBlockOnExit = async (): Promise<void> => {
    if (!inThinkBlock) return;
    await writeFile("\n</think>\n");
    inThinkBlock = false;
    notifyDelta("\n</think>\n");
  };

  let tokenUsage: {
    prompt: number | null;
    completion: number | null;
    total: number | null;
  } = { prompt: null, completion: null, total: null };

  /**
   * Dispatch the `response-stream` hook for a delta and persist the resulting
   * chunk. Handlers may mutate `context.chunk` to transform or drop (via `""`)
   * the delta; non-string values coerce to `""`.
   */
  const persistChunk = async (delta: string): Promise<void> => {
    const ctx = await hookDispatcher.dispatch("response-stream", {
      correlationId,
      chunk: delta,
      series,
      name,
      storyDir,
      chapterPath,
      chapterNumber: targetNum,
    });
    const out = typeof ctx.chunk === "string" ? ctx.chunk : "";
    if (out.length > 0) {
      aiContent += out;
      await file.write(encoder.encode(out));
      onDelta?.(out);
    }
  };
  try {
    // 7. Parse SSE stream and write incrementally, calling onDelta for each chunk
    const reader = apiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    /**
     * Parse a single SSE `data:` payload (without the `data: ` prefix) and act on it.
     * - Skips `[DONE]` and JSON-parse failures (treated as malformed chunks).
     * - Detects OpenRouter mid-stream errors via top-level `error` or
     *   `choices[0].finish_reason === "error"`, logs once, and throws ChatError.
     * - Otherwise extracts content delta and usage.
     *
     * Detection runs OUTSIDE the parse-catch so the throw is not swallowed.
     */
    const handlePayload = async (payload: string): Promise<void> => {
      if (payload === "[DONE]") return;
      let raw: unknown;
      try {
        raw = JSON.parse(payload);
      } catch {
        return; // Skip malformed JSON chunks
      }
      if (typeof raw !== "object" || raw === null) return;
      const parsed = raw as LLMStreamChunk;

      const errObj = parsed.error;
      const hasErrorField = typeof errObj === "object" && errObj !== null;
      const finishedWithError = parsed.choices?.[0]?.finish_reason === "error";
      if (hasErrorField || finishedWithError) {
        const messageRaw = errObj?.message;
        const codeRaw = errObj?.code;
        const message = (typeof messageRaw === "string" && messageRaw.length > 0)
          ? messageRaw
          : (codeRaw !== undefined ? String(codeRaw) : "Mid-stream provider error");
        const latencyMs = Math.round(performance.now() - llmStartTime);
        llmLog.info("LLM error", {
          type: "error",
          errorCode: "stream-error",
          latencyMs,
          error: message,
          partialLength: aiContent.length,
          reasoningLength,
        });
        throw new ChatError("llm-stream", message, 502);
      }

      const choice = parsed.choices?.[0];
      const delta = choice?.delta;

      // Reasoning text first: open `<think>` lazily, write reasoning bytes,
      // never pass through `response-stream`, never append to `aiContent`.
      // Order: file.write → mutate state → onDelta. A thrown `onDelta` after a
      // successful write must NOT desynchronise inThinkBlock from disk.
      const reasoningText = extractReasoningText(delta);
      if (reasoningText.length > 0) {
        if (!inThinkBlock) {
          await writeFile("<think>\n");
          inThinkBlock = true;
          notifyDelta("<think>\n");
        }
        await writeFile(reasoningText);
        reasoningLength += reasoningText.length;
        notifyDelta(reasoningText);
      }

      const contentDelta = delta?.content;
      if (contentDelta) {
        // Closing the think block before content guarantees byte order:
        // reasoning → close → content, even when one chunk carries both.
        if (inThinkBlock) {
          await writeFile("\n</think>\n\n");
          inThinkBlock = false;
          notifyDelta("\n</think>\n\n");
        }
        sawModelContent = true;
        await persistChunk(contentDelta);
      }
      if (parsed.usage) {
        tokenUsage = {
          prompt: parsed.usage.prompt_tokens ?? null,
          completion: parsed.usage.completion_tokens ?? null,
          total: parsed.usage.total_tokens ?? null,
        };
      }
    };

    while (true) {
      // Narrow the abort-discriminating try around `reader.read()` only so file
      // writes, hook dispatch, and JSON-parse failures propagate as themselves
      // instead of being silently misclassified as aborts.
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        if (signal?.aborted === true) {
          aborted = true;
          break;
        }
        throw err;
      }
      if (chunk.done) break;

      buffer += decoder.decode(chunk.value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        await handlePayload(trimmed.slice(6));
      }
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        await handlePayload(trimmed.slice(6));
      }
    }
  } catch (err: unknown) {
    // ChatError already logged its own `errorCode: "stream-error"` entry inside
    // handlePayload — rethrow without adding a duplicate `"stream"` log entry.
    if (err instanceof ChatError) {
      throw err;
    }
    // NOTE: aborts are detected solely inside the narrow try around
    // `reader.read()` above (which sets `aborted = true; break;`). Errors that
    // reach this outer catch came from non-read operations (decode, parse,
    // persistChunk, onDelta, hooks) and MUST propagate as themselves even if
    // `signal.aborted` happens to be true concurrently — otherwise legitimate
    // file/hook/onDelta failures would be silently misclassified as aborts.
    const latencyMs = Math.round(performance.now() - llmStartTime);
    const errMsg = err instanceof Error ? err.message : String(err);
    llmLog.info("LLM error", { type: "error", errorCode: "stream", latencyMs, error: errMsg, partialLength: aiContent.length, reasoningLength });
    throw err;
  } finally {
    // Close any open `<think>` block before file.close(); a failure here MUST
    // NOT mask the primary error from the streaming loop and MUST NOT prevent
    // file.close() from running.
    try {
      await closeThinkBlockOnExit();
    } catch (cleanupErr) {
      const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      reqLog.warn("close-think-block failed during streaming finally", { error: msg });
    } finally {
      file.close();
    }
  }

  // On abort: throw ChatAbortError after file cleanup so callers can handle it
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
  reqFileLog.info("Chapter file written", { op: "write", path: chapterPath, bytes: encoder.encode(fullContent).length });

  // 8a. Persist token usage when the upstream provider reported complete numbers
  let usage: TokenUsageRecord | null = null;
  if (
    tokenUsage.prompt !== null &&
    tokenUsage.completion !== null &&
    tokenUsage.total !== null
  ) {
    usage = buildRecord({
      chapter: targetNum,
      promptTokens: tokenUsage.prompt,
      completionTokens: tokenUsage.completion,
      totalTokens: tokenUsage.total,
      model: llmConfig.model,
    });
    await appendUsage(storyDir, usage);
  } else {
    reqLog.debug("Usage unavailable from upstream", { chapter: targetNum, model: llmConfig.model });
  }

  // 8. Run post-response hooks
  await hookDispatcher.dispatch("post-response", {
    correlationId,
    content: fullContent,
    storyDir,
    series,
    name,
    rootDir: config.ROOT_DIR,
    chapterNumber: targetNum,
    chapterPath,
  });

  return { chapter: targetNum, content: fullContent, usage };
  } finally {
    clearGenerationActive(series, name);
  }
}
