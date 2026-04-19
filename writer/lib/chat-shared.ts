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
import type { AppConfig, LlmConfig, SafePathFn, BuildPromptFn, LLMStreamChunk, VentoError } from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";
import { resolveTargetChapterNumber } from "./story.ts";
import { resolveStoryLlmConfig, StoryConfigValidationError } from "./story-config.ts";
import { createLogger, createLlmLogger } from "./logger.ts";

const log = createLogger("llm");
const fileLog = createLogger("file");

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
}

/** Error thrown when a chat generation is aborted by the client. */
export class ChatAbortError extends Error {
  override readonly name = "ChatAbortError";
}

/** Error thrown when chat execution encounters a known failure. */
export class ChatError extends Error {
  override readonly name = "ChatError";
  constructor(
    public readonly code: "api-key" | "bad-path" | "vento" | "no-prompt" | "llm-api" | "no-body" | "no-content" | "story-config",
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
    },
    systemPrompt,
    userMessage: message,
  });

  const llmStartTime = performance.now();
  let apiResponse: Response;
  try {
    apiResponse = await fetch(config.LLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${Deno.env.get("LLM_API_KEY")}`,
      },
      body: JSON.stringify({
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
      }),
      signal,
    });
  } catch (err: unknown) {
    const latencyMs = Math.round(performance.now() - llmStartTime);
    if (err instanceof DOMException && err.name === "AbortError") {
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
    throw new ChatError("llm-api", "AI service request failed", apiResponse.status);
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

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;

        const payload = trimmed.slice(6);
        if (payload === "[DONE]") continue;

        try {
          const raw: unknown = JSON.parse(payload);
          if (typeof raw !== "object" || raw === null) continue;
          const parsed = raw as LLMStreamChunk;
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            sawModelContent = true;
            await persistChunk(delta);
          }
          if (parsed.usage) {
            tokenUsage = {
              prompt: parsed.usage.prompt_tokens ?? null,
              completion: parsed.usage.completion_tokens ?? null,
              total: parsed.usage.total_tokens ?? null,
            };
          }
        } catch {
          // Skip malformed JSON chunks
        }
      }
    }

    // Process any remaining data in the buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ") && trimmed.slice(6) !== "[DONE]") {
        try {
          const raw: unknown = JSON.parse(trimmed.slice(6));
          if (typeof raw === "object" && raw !== null) {
            const parsed = raw as LLMStreamChunk;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              sawModelContent = true;
              await persistChunk(delta);
            }
            if (parsed.usage) {
              tokenUsage = {
                prompt: parsed.usage.prompt_tokens ?? null,
                completion: parsed.usage.completion_tokens ?? null,
                total: parsed.usage.total_tokens ?? null,
              };
            }
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof DOMException && err.name === "AbortError") {
      aborted = true;
    } else {
      // Log unexpected stream errors before rethrowing
      const latencyMs = Math.round(performance.now() - llmStartTime);
      const errMsg = err instanceof Error ? err.message : String(err);
      llmLog.info("LLM error", { type: "error", errorCode: "stream", latencyMs, error: errMsg, partialLength: aiContent.length });
      throw err;
    }
  } finally {
    file.close();
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
  });
  reqFileLog.info("Chapter file written", { op: "write", path: chapterPath, bytes: encoder.encode(fullContent).length });

  // 8. Run post-response hooks
  await hookDispatcher.dispatch("post-response", {
    correlationId,
    content: fullContent,
    storyDir,
    series,
    name,
    rootDir: config.ROOT_DIR,
  });

  return { chapter: targetNum, content: fullContent };
}
