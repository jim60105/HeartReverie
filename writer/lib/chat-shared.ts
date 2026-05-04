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
import type {
  AppConfig,
  ChatMessage,
  LlmConfig,
  SafePathFn,
  BuildPromptFn,
  BuildContinuePromptFn,
  LLMStreamChunk,
  VentoError,
  TokenUsageRecord,
} from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";
import {
  resolveTargetChapterNumber,
  listChapterFiles,
  atomicWriteChapter,
  ContinuePromptError,
} from "./story.ts";
import { resolveStoryLlmConfig, StoryConfigValidationError } from "./story-config.ts";
import { createLogger, createLlmLogger } from "./logger.ts";
import { appendUsage, buildRecord } from "./usage.ts";
import {
  tryMarkGenerationActive,
  clearGenerationActive,
} from "./generation-registry.ts";

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

/** Options for `executeContinue` — continues the latest chapter file. */
export interface ContinueOptions {
  readonly series: string;
  readonly name: string;
  readonly template?: string;
  readonly config: AppConfig;
  readonly safePath: SafePathFn;
  readonly hookDispatcher: HookDispatcher;
  readonly buildContinuePromptFromStory: BuildContinuePromptFn;
  readonly onDelta?: (content: string) => void;
  readonly signal?: AbortSignal;
}

/** Successful continue result. */
export interface ContinueResult {
  readonly chapter: number;
  /** Full chapter content after the continue stream completes. */
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
    public readonly code: "api-key" | "bad-path" | "vento" | "no-prompt" | "llm-api" | "llm-stream" | "no-body" | "no-content" | "story-config" | "no-chapter" | "concurrent" | "conflict",
    message: string,
    public readonly httpStatus: number = 500,
    public readonly ventoError?: VentoError,
  ) {
    super(message);
  }
}

/** Discriminated union describing how `streamLlmAndPersist` should persist
 * the LLM stream output:
 *
 * - `write-new-chapter`: existing chat behaviour — open the next chapter file,
 *   dispatch `pre-write`, write each delta after `response-stream` hook
 *   transformation, and dispatch `post-response` with `source: "chat"`.
 * - `append-to-existing-chapter`: plugin-action append mode — accumulate the
 *   stream in memory, on success normalise wrapper layers and atomically
 *   append `\n<{appendTag}>\n…\n</{appendTag}>\n` to the highest-numbered
 *   chapter file, then re-read that file and dispatch `post-response` with
 *   `source: "plugin-action"`. `pre-write` and `response-stream` are NOT
 *   dispatched.
 * - `discard`: plugin-action discard mode — accumulate the stream in memory
 *   and return it; no chapter mutation, no hook dispatches.
 * - `continue-last-chapter`: continue mode — append streaming bytes to an
 *   already-existing chapter file (specified by `targetChapterNumber`).
 *   Re-uses the per-chunk `response-stream` hook + `<think>` framing from
 *   `write-new-chapter`, but does NOT dispatch `pre-write` (no new user
 *   message exists), opens the file with `append: true` (no truncate, no
 *   create), and on entry verifies the on-disk bytes still match
 *   `existingContent` (snapshot guard against external editors racing the
 *   per-story lock — throws `ChatError("conflict", …, 409)` on mismatch).
 *   Finalisation re-reads the chapter file to compute `chapterContentAfter`
 *   and dispatches `post-response` with `source: "continue"`.
 */
export type WriteMode =
  | { readonly kind: "write-new-chapter"; readonly userMessage: string; readonly targetChapterNumber: number }
  | { readonly kind: "append-to-existing-chapter"; readonly appendTag: string; readonly pluginName: string }
  | { readonly kind: "discard" }
  | { readonly kind: "continue-last-chapter"; readonly targetChapterNumber: number; readonly existingContent: string }
  /**
   * `replace-last-chapter`: a plugin-action mode that atomically overwrites
   * the highest-numbered chapter file with the LLM's full response after
   * the stream completes. Used by the bundled `polish` plugin. Streaming
   * deltas are accumulated in memory only — no file is opened during the
   * stream, so an aborted/errored generation leaves the on-disk chapter
   * untouched (byte-for-byte preservation). Finalisation calls
   * `atomicWriteChapter` with `aiContent.trimEnd() + "\n"`, re-reads the
   * file, appends one usage record (if available), and dispatches
   * `post-response` with `source: "plugin-action"` and `pluginName`.
   * Neither `pre-write` nor `response-stream` hooks fire in this mode.
   */
  | { readonly kind: "replace-last-chapter"; readonly pluginName: string };

/** Arguments for `streamLlmAndPersist`. */
export interface StreamLlmArgs {
  readonly messages: ChatMessage[];
  readonly llmConfig: LlmConfig;
  readonly series: string;
  readonly name: string;
  readonly storyDir: string;
  readonly rootDir: string;
  readonly signal?: AbortSignal;
  readonly writeMode: WriteMode;
  readonly onDelta?: (chunk: string) => void;
  readonly hookDispatcher: HookDispatcher;
  readonly config: AppConfig;
}

/** Result of `streamLlmAndPersist`. */
export interface StreamLlmResult {
  readonly content: string;
  readonly usage: TokenUsageRecord | null;
  readonly chapterPath: string | null;
  readonly chapterNumber: number | null;
  readonly chapterContentAfter: string | null;
  readonly aborted: boolean;
}

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
  } = args;

  const correlationId = crypto.randomUUID();
  const reqLog = log.withContext({ correlationId });
  const reqFileLog = fileLog.withContext({ correlationId });
  const llmLog = createLlmLogger().withContext({ correlationId });

  // ── Resolve target chapter info (mode-dependent) ──
  let targetNum: number | null = null;
  let chapterPath: string | null = null;
  if (writeMode.kind === "write-new-chapter") {
    targetNum = writeMode.targetChapterNumber;
    const padded = String(targetNum).padStart(3, "0");
    await Deno.mkdir(storyDir, { recursive: true, mode: 0o775 });
    chapterPath = join(storyDir, `${padded}.md`);
  } else if (writeMode.kind === "append-to-existing-chapter") {
    const chapterFiles = await listChapterFiles(storyDir);
    if (chapterFiles.length === 0) {
      throw new ChatError("no-chapter", "Cannot append: no existing chapter file in story directory", 400);
    }
    const lastFile = chapterFiles[chapterFiles.length - 1]!;
    targetNum = parseInt(lastFile, 10);
    chapterPath = join(storyDir, lastFile);
  } else if (writeMode.kind === "continue-last-chapter") {
    targetNum = writeMode.targetChapterNumber;
    const padded = String(targetNum).padStart(3, "0");
    chapterPath = join(storyDir, `${padded}.md`);
  } else if (writeMode.kind === "replace-last-chapter") {
    const chapterFiles = await listChapterFiles(storyDir);
    if (chapterFiles.length === 0) {
      throw new ChatError("no-chapter", "Cannot replace: no existing chapter file in story directory", 400);
    }
    const lastFile = chapterFiles[chapterFiles.length - 1]!;
    targetNum = parseInt(lastFile, 10);
    chapterPath = join(storyDir, lastFile);
  }

  // ── Build upstream request body ──
  const roleCounts: Record<ChatMessage["role"], number> = { system: 0, user: 0, assistant: 0 };
  for (const m of messages) roleCounts[m.role]++;

  reqLog.debug("LLM request payload", {
    mode: writeMode.kind,
    model: llmConfig.model,
    temperature: llmConfig.temperature,
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
    reasoningOmit: config.LLM_REASONING_OMIT,
    messages,
    messageCount: messages.length,
    roleCounts,
  });

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

  const llmStartTime = performance.now();
  let apiResponse: Response;
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
    reqLog.error("LLM API error", { status: apiResponse.status, latencyMs, model: llmConfig.model, errorBody });
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

  // ── Mode-specific persistence setup ──
  const encoder = new TextEncoder();
  let aiContent = "";
  let sawModelContent = false;
  let aborted = false;

  // write-new-chapter only: open file, dispatch pre-write, write preContent
  let file: Deno.FsFile | null = null;
  let preContent = "";
  let inThinkBlock = false;
  let reasoningLength = 0;
  if (writeMode.kind === "write-new-chapter" && chapterPath !== null && targetNum !== null) {
    reqFileLog.info("Writing chapter file", { op: "write", path: chapterPath, chapter: targetNum });

    const preWriteCtx = await hookDispatcher.dispatch("pre-write", {
      correlationId,
      message: writeMode.userMessage,
      chapterPath,
      storyDir,
      series,
      name,
      preContent: "",
    });
    preContent = typeof preWriteCtx.preContent === "string" ? preWriteCtx.preContent : "";

    file = await Deno.open(chapterPath, { write: true, create: true, truncate: true, mode: 0o664 });
    if (preContent) {
      await file.write(encoder.encode(preContent));
    }
  } else if (writeMode.kind === "continue-last-chapter" && chapterPath !== null && targetNum !== null) {
    // Snapshot guard (defence-in-depth against external editors racing the
    // per-story generation lock): re-read the file and compare against the
    // bytes captured at parse time. Mismatch → 409 Conflict.
    let onDiskContent: string;
    try {
      onDiskContent = await Deno.readTextFile(chapterPath);
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new ChatError("no-chapter", "Cannot continue: chapter file no longer exists", 400);
      }
      throw err;
    }
    if (onDiskContent !== writeMode.existingContent) {
      throw new ChatError(
        "conflict",
        "Latest chapter changed during continue; please retry",
        409,
      );
    }

    reqFileLog.info("Appending to chapter file (continue)", {
      op: "append",
      path: chapterPath,
      chapter: targetNum,
    });

    try {
      file = await Deno.open(chapterPath, { write: true, append: true, mode: 0o664 });
    } catch (err) {
      if (err instanceof Deno.errors.NotFound) {
        throw new ChatError("no-chapter", "Cannot continue: chapter file no longer exists", 400);
      }
      throw err;
    }
  }

  /** Extract reasoning text from a stream chunk delta. */
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

  const writeFile = (bytes: string): Promise<number> => {
    if (!file) return Promise.resolve(0);
    return file.write(encoder.encode(bytes));
  };
  const notifyDelta = (bytes: string): void => { onDelta?.(bytes); };

  const closeThinkBlockOnExit = async (): Promise<void> => {
    if (!inThinkBlock || !file) return;
    await writeFile("\n</think>\n");
    inThinkBlock = false;
    notifyDelta("\n</think>\n");
  };

  let tokenUsage: { prompt: number | null; completion: number | null; total: number | null } = {
    prompt: null,
    completion: null,
    total: null,
  };

  /** Persist a content delta — mode-specific. */
  const persistChunk = async (delta: string): Promise<void> => {
    if (writeMode.kind === "write-new-chapter" || writeMode.kind === "continue-last-chapter") {
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
        await writeFile(out);
        onDelta?.(out);
      }
    } else {
      // append / discard: accumulate only, no hook
      aiContent += delta;
      onDelta?.(delta);
    }
  };

  try {
    const reader = apiResponse.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handlePayload = async (payload: string): Promise<void> => {
      if (payload === "[DONE]") return;
      let raw: unknown;
      try {
        raw = JSON.parse(payload);
      } catch {
        return;
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

      // Reasoning bytes — only frame as `<think>` for chapter-writing modes.
      const reasoningText = extractReasoningText(delta);
      const isChapterWritingMode = writeMode.kind === "write-new-chapter"
        || writeMode.kind === "continue-last-chapter";
      if (reasoningText.length > 0 && isChapterWritingMode) {
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
        if (inThinkBlock && isChapterWritingMode) {
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

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data: ")) {
        await handlePayload(trimmed.slice(6));
      }
    }
  } catch (err: unknown) {
    if (err instanceof ChatError) {
      throw err;
    }
    const latencyMs = Math.round(performance.now() - llmStartTime);
    const errMsg = err instanceof Error ? err.message : String(err);
    llmLog.info("LLM error", {
      type: "error",
      errorCode: "stream",
      latencyMs,
      error: errMsg,
      partialLength: aiContent.length,
      reasoningLength,
    });
    throw err;
  } finally {
    try {
      await closeThinkBlockOnExit();
    } catch (cleanupErr) {
      const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      reqLog.warn("close-think-block failed during streaming finally", { error: msg });
    } finally {
      if (file) file.close();
    }
  }

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
    });
  } else {
    reqLog.debug("Usage unavailable from upstream", { chapter: targetNum, model: llmConfig.model });
  }

  let chapterContentAfter: string | null = null;

  // ── Mode-specific finalization ──
  if (writeMode.kind === "write-new-chapter" && chapterPath !== null && targetNum !== null) {
    reqFileLog.info("Chapter file written", {
      op: "write",
      path: chapterPath,
      bytes: encoder.encode(fullContent).length,
    });

    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    chapterContentAfter = fullContent;

    await hookDispatcher.dispatch("post-response", {
      correlationId,
      content: fullContent,
      storyDir,
      series,
      name,
      rootDir,
      chapterNumber: targetNum,
      chapterPath,
      source: "chat",
    });
  } else if (writeMode.kind === "append-to-existing-chapter" && chapterPath !== null && targetNum !== null) {
    const { appendTag, pluginName } = writeMode;
    const normalised = normaliseAppendContent(aiContent, appendTag);
    const wrapped = `\n<${appendTag}>\n${normalised}\n</${appendTag}>\n`;

    const existingChapter = await Deno.readTextFile(chapterPath);
    const newChapterContent = existingChapter + wrapped;
    const padded = String(targetNum).padStart(3, "0");
    await atomicWriteChapter(storyDir, `${padded}.md`, newChapterContent);
    chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file appended (plugin-action)", {
      op: "append",
      path: chapterPath,
      appendedTag: appendTag,
      pluginName,
    });

    await hookDispatcher.dispatch("post-response", {
      correlationId,
      content: chapterContentAfter,
      storyDir,
      series,
      name,
      rootDir,
      chapterNumber: targetNum,
      chapterPath,
      source: "plugin-action",
      pluginName,
      appendedTag: appendTag,
    });
  } else if (writeMode.kind === "continue-last-chapter" && chapterPath !== null && targetNum !== null) {
    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    // Re-read the chapter file from disk to obtain the FULL updated content
    // (original pre-continue bytes + everything appended during this stream).
    chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file appended (continue)", {
      op: "append",
      path: chapterPath,
      bytes: encoder.encode(aiContent).length,
    });

    await hookDispatcher.dispatch("post-response", {
      correlationId,
      content: chapterContentAfter,
      storyDir,
      series,
      name,
      rootDir,
      chapterNumber: targetNum,
      chapterPath,
      source: "continue",
    });
  } else if (writeMode.kind === "replace-last-chapter" && chapterPath !== null && targetNum !== null) {
    const { pluginName } = writeMode;
    const padded = String(targetNum).padStart(3, "0");
    // Atomic replace: only commit AFTER the stream completes successfully.
    // Aborts / errors are caught by upstream try/catch blocks and the
    // pre-existing file remains untouched (no file handle was opened
    // during the stream phase for this mode).
    const newContent = aiContent.trimEnd() + "\n";
    await atomicWriteChapter(storyDir, `${padded}.md`, newContent);

    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file replaced (plugin-action)", {
      op: "replace",
      path: chapterPath,
      pluginName,
      bytes: encoder.encode(newContent).length,
    });

    await hookDispatcher.dispatch("post-response", {
      correlationId,
      content: chapterContentAfter,
      storyDir,
      series,
      name,
      rootDir,
      chapterNumber: targetNum,
      chapterPath,
      source: "plugin-action",
      pluginName,
    });
  }
  // discard: no chapter mutation, no hook dispatch

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
 * Strip exactly one matching outer `<{tag}>…</{tag}>` wrapper from `content`
 * (after trimming) when present, then re-trim. If no matching outer wrapper
 * is present (or the wrapper is malformed), returns the trimmed content
 * unchanged. Only ONE outer layer is ever stripped — legitimately nested
 * same-name elements are preserved.
 */
export function normaliseAppendContent(content: string, appendTag: string): string {
  const trimmed = content.trim();
  const escaped = appendTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const wrapperRe = new RegExp(
    `^<${escaped}\\b[^>]*>([\\s\\S]*)</${escaped}>\\s*$`,
  );
  const match = trimmed.match(wrapperRe);
  if (match) {
    return (match[1] ?? "").trim();
  }
  return trimmed;
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
    const msg = err instanceof Error ? err.message : String(err);
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
    } catch {
      // No custom file and no system.md readable — proceed with default rendering
    }
  }

  const {
    messages: templateMessages,
    ventoError,
    chapterFiles,
    chapters,
  } = await buildPromptFromStory(series, name, storyDir, message, templateOverride);

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
    const msg = err instanceof Error ? err.message : String(err);
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
    } catch {
      // fall through to default rendering
    }
  }

  let promptResult;
  try {
    promptResult = await buildContinuePromptFromStory(series, name, storyDir, templateOverride);
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
