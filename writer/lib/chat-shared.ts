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
import { join } from "@std/path";
import { readTemplate } from "../routes/prompt.ts";
import type {
  ChatMessage,
  LlmConfig,
  LLMStreamChunk,
  PostResponsePayload,
  PreLlmFetchPayload,
  TokenUsageRecord,
} from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";
import {
  atomicWriteChapter,
  ContinuePromptError,
  listChapterFiles,
  resolveTargetChapterNumber,
} from "./story.ts";
import {
  resolveStoryLlmConfig,
  StoryConfigValidationError,
} from "./story-config.ts";
import { createLlmLogger, createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import { appendUsage, buildRecord } from "./usage.ts";
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

const log = createLogger("llm");
const fileLog = createLogger("file");

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
function deepFreeze<T>(value: T): T {
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
const LLM_APP_ATTRIBUTION_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "HTTP-Referer": "https://github.com/jim60105/HeartReverie",
  "X-OpenRouter-Title": "HeartReverie",
  "X-OpenRouter-Categories": "roleplay,creative-writing",
});


/**
 * Resolve the target chapter file for a given `writeMode`.
 *
 * Non-mutating resolution — no filesystem writes. The caller is responsible
 * for any mode-specific side effects (e.g., `mkdir` for `write-new-chapter`).
 *
 * Returns `{ targetNum: null, chapterPath: null }` for modes that don't
 * touch a chapter file on disk (currently only `discard`).
 *
 * Throws `ChatError("no-chapter", …, 400)` when an append/replace mode is
 * requested but no chapter file exists in `storyDir`.
 */
async function resolveChapterTarget(
  writeMode: WriteMode,
  storyDir: string,
): Promise<{ targetNum: number | null; chapterPath: string | null }> {
  switch (writeMode.kind) {
    case "write-new-chapter":
    case "continue-last-chapter": {
      const targetNum = writeMode.targetChapterNumber;
      const padded = String(targetNum).padStart(3, "0");
      return { targetNum, chapterPath: join(storyDir, `${padded}.md`) };
    }
    case "append-to-existing-chapter":
      return await resolveLastChapter(storyDir, "append");
    case "replace-last-chapter":
      return await resolveLastChapter(storyDir, "replace");
    case "discard":
      return { targetNum: null, chapterPath: null };
  }
}

/** Locate the highest-numbered chapter file in `storyDir`. */
async function resolveLastChapter(
  storyDir: string,
  action: "append" | "replace",
): Promise<{ targetNum: number; chapterPath: string }> {
  const chapterFiles = await listChapterFiles(storyDir);
  if (chapterFiles.length === 0) {
    const verb = action === "append" ? "append" : "replace";
    throw new ChatError("no-chapter", `Cannot ${verb}: no existing chapter file in story directory`, 400);
  }
  const lastFile = chapterFiles[chapterFiles.length - 1]!;
  return { targetNum: parseInt(lastFile, 10), chapterPath: join(storyDir, lastFile) };
}

/**
 * Build the upstream LLM request body from the resolved `llmConfig` and
 * `messages`. Pure transformation — no I/O. `omitReasoning` mirrors the
 * `config.LLM_REASONING_OMIT` flag (some upstreams reject the `reasoning`
 * field entirely; setting this true omits it from the payload).
 */
function buildLlmRequestBody(
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
async function dispatchPreLlmFetchHook(
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
async function performLlmFetch(args: {
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
 * Story-scoped request context shared across the post-stream helpers.
 * Bundled so callers don't have to thread five fields through each helper
 * (and so future additions don't churn every signature).
 */
type StoryContext = {
  readonly storyDir: string;
  readonly rootDir: string;
  readonly series: string;
  readonly name: string;
  readonly correlationId: string;
};

/**
 * Resolved chapter target for the current write mode. Both fields are
 * `null` for `discard` mode (no chapter ever touched).
 */
type ChapterTarget = {
  readonly chapterPath: string | null;
  readonly targetNum: number | null;
};

/**
 * Emit the two pre-fetch log entries (`debug` for ops + `info` on the
 * audit-stream logger). Pure observability — no I/O beyond the loggers.
 * Computes `roleCounts` once and reuses it across both entries.
 */
function logLlmRequest(args: {
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

/**
 * Prepare the on-disk chapter file BEFORE streaming starts. Two branches
 * have side effects; other modes are a no-op.
 *
 * - `write-new-chapter` dispatches the `pre-write` hook (which may rewrite
 *   `preContent`), opens the target path with `truncate`, and writes the
 *   pre-content bytes.
 * - `continue-last-chapter` runs the snapshot guard (re-reads disk and
 *   compares against `writeMode.existingContent`; mismatch → 409) and
 *   opens the file in append mode.
 *
 * **Ownership:** on successful return the caller owns the returned `file`
 * handle (must `.close()` it). On any throw after the helper opened a
 * handle internally, the helper closes the handle itself so leak-free
 * recovery is guaranteed.
 */
async function openChapterForStream(args: {
  writeMode: WriteMode;
  target: ChapterTarget;
  storyCtx: StoryContext;
  hookDispatcher: HookDispatcher;
  reqFileLog: Logger;
  encoder: TextEncoder;
}): Promise<{ file: Deno.FsFile | null; preContent: string }> {
  const { writeMode, target, storyCtx, hookDispatcher, reqFileLog, encoder } = args;
  const { chapterPath, targetNum } = target;
  const { storyDir, series, name, correlationId } = storyCtx;

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
    const preContent = typeof preWriteCtx.preContent === "string" ? preWriteCtx.preContent : "";

    let file: Deno.FsFile | null = null;
    try {
      file = await Deno.open(chapterPath, { write: true, create: true, truncate: true, mode: 0o664 });
      if (preContent) {
        await file.write(encoder.encode(preContent));
      }
      return { file, preContent };
    } catch (err) {
      try { file?.close(); } catch { /* nothing actionable; original error wins */ }
      throw err;
    }
  }

  if (writeMode.kind === "continue-last-chapter" && chapterPath !== null && targetNum !== null) {
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

    let file: Deno.FsFile | null = null;
    try {
      file = await Deno.open(chapterPath, { write: true, append: true, mode: 0o664 });
      return { file, preContent: "" };
    } catch (err) {
      try { file?.close(); } catch { /* nothing actionable; original error wins */ }
      if (err instanceof Deno.errors.NotFound) {
        throw new ChatError("no-chapter", "Cannot continue: chapter file no longer exists", 400);
      }
      throw err;
    }
  }

  return { file: null, preContent: "" };
}

/**
 * Mode-specific finalization that runs AFTER the streaming loop succeeded
 * (no abort, content seen). For each chapter-writing mode it performs the
 * required on-disk persistence (atomic-write for append/replace; nothing
 * extra for the modes that already wrote during streaming), appends the
 * usage record, and dispatches the `post-response` hook with a frozen
 * payload whose `usage` is a clone (so subsequent local mutation of the
 * usage ledger doesn't leak into observer plugins). `discard` mode is a
 * no-op.
 *
 * Returns the post-state chapter content (re-read from disk for the
 * modes that write during streaming, derived directly for modes that
 * compute the new chapter content here), or `null` for `discard`.
 */
async function finalizeStreamMode(args: {
  writeMode: WriteMode;
  target: ChapterTarget;
  aiContent: string;
  fullContent: string;
  usage: TokenUsageRecord | null;
  endpoint: string;
  storyCtx: StoryContext;
  hookDispatcher: HookDispatcher;
  reqFileLog: Logger;
  encoder: TextEncoder;
}): Promise<string | null> {
  const {
    writeMode,
    target,
    aiContent,
    fullContent,
    usage,
    endpoint,
    storyCtx,
    hookDispatcher,
    reqFileLog,
    encoder,
  } = args;
  const { chapterPath, targetNum } = target;
  const { storyDir, rootDir, series, name, correlationId } = storyCtx;

  // Pre-clone the usage record so the value reachable through the frozen
  // hook payload stays independent of the local mutable record that
  // append-to-`_usage.json` may continue to touch.
  const usageForDispatch: TokenUsageRecord | null = usage === null
    ? null
    : structuredClone(usage);

  function buildPostResponsePayload(
    base: Omit<PostResponsePayload, "usage" | "endpoint">,
  ): Readonly<PostResponsePayload> {
    const payload: PostResponsePayload = {
      ...base,
      endpoint,
      usage: usageForDispatch,
    };
    return deepFreeze(payload);
  }

  if (writeMode.kind === "write-new-chapter" && chapterPath !== null && targetNum !== null) {
    reqFileLog.info("Chapter file written", {
      op: "write",
      path: chapterPath,
      bytes: encoder.encode(fullContent).length,
    });

    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    const chapterContentAfter = fullContent;

    await hookDispatcher.dispatch(
      "post-response",
      buildPostResponsePayload({
        correlationId,
        content: fullContent,
        storyDir,
        series,
        name,
        rootDir,
        chapterNumber: targetNum,
        chapterPath,
        source: "chat",
      }) as unknown as Record<string, unknown>,
    );

    return chapterContentAfter;
  }

  if (writeMode.kind === "append-to-existing-chapter" && chapterPath !== null && targetNum !== null) {
    const { appendTag, pluginName } = writeMode;
    const normalised = normaliseAppendContent(aiContent, appendTag);
    const wrapped = `\n<${appendTag}>\n${normalised}\n</${appendTag}>\n`;

    const existingChapter = await Deno.readTextFile(chapterPath);
    const newChapterContent = existingChapter + wrapped;
    const padded = String(targetNum).padStart(3, "0");
    await atomicWriteChapter(storyDir, `${padded}.md`, newChapterContent);
    const chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file appended (plugin-action)", {
      op: "append",
      path: chapterPath,
      appendedTag: appendTag,
      pluginName,
    });

    // Parity with the other three success branches: append the usage
    // record BEFORE dispatching `post-response` so subscribers that
    // re-read `_usage.json` (legacy path) and subscribers that read
    // `ctx.usage` (new path) observe a consistent ledger state.
    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    await hookDispatcher.dispatch(
      "post-response",
      buildPostResponsePayload({
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
      }) as unknown as Record<string, unknown>,
    );

    return chapterContentAfter;
  }

  if (writeMode.kind === "continue-last-chapter" && chapterPath !== null && targetNum !== null) {
    if (usage !== null) {
      await appendUsage(storyDir, usage);
    }

    // Re-read the chapter file from disk to obtain the FULL updated content
    // (original pre-continue bytes + everything appended during this stream).
    const chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file appended (continue)", {
      op: "append",
      path: chapterPath,
      bytes: encoder.encode(aiContent).length,
    });

    await hookDispatcher.dispatch(
      "post-response",
      buildPostResponsePayload({
        correlationId,
        content: chapterContentAfter,
        storyDir,
        series,
        name,
        rootDir,
        chapterNumber: targetNum,
        chapterPath,
        source: "continue",
      }) as unknown as Record<string, unknown>,
    );

    return chapterContentAfter;
  }

  if (writeMode.kind === "replace-last-chapter" && chapterPath !== null && targetNum !== null) {
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

    const chapterContentAfter = await Deno.readTextFile(chapterPath);

    reqFileLog.info("Chapter file replaced (plugin-action)", {
      op: "replace",
      path: chapterPath,
      pluginName,
      bytes: encoder.encode(newContent).length,
    });

    await hookDispatcher.dispatch(
      "post-response",
      buildPostResponsePayload({
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
      }) as unknown as Record<string, unknown>,
    );

    return chapterContentAfter;
  }

  // discard: no chapter mutation, no hook dispatch
  return null;
}

/**
 * Final state produced by `consumeLlmStream`. Surfaces back to the caller
 * for the abort / no-content / latency-log / usage-assembly phase that
 * follows.
 */
type StreamConsumeResult = {
  readonly aiContent: string;
  readonly sawModelContent: boolean;
  readonly aborted: boolean;
  readonly reasoningLength: number;
  readonly tokenUsage: {
    readonly prompt: number | null;
    readonly completion: number | null;
    readonly total: number | null;
    readonly cost: number | null;
  };
};

/**
 * Consume the upstream SSE stream, persist content deltas according to
 * `writeMode`, and surface reasoning frames as `<think>` blocks for
 * chapter-writing modes only.
 *
 * **Ownership:** this helper takes ownership of the optional `file`
 * handle — it closes it in `finally` (and emits the `</think>` close-tag
 * if a partial reasoning block was open). Callers MUST NOT touch `file`
 * after invoking this helper.
 *
 * **Failure modes:**
 * - `aborted === true` in the result when the caller's `signal` aborts
 *   the underlying read. Caller decides how to surface (typically by
 *   throwing `ChatAbortError` post-stream).
 * - Mid-stream provider errors (`error` field on a payload or
 *   `finish_reason: "error"`) bubble up as `ChatError("llm-stream", …, 502)`.
 * - Any other stream-consumption exception is rethrown after emitting
 *   the structured `LLM error` log entry.
 *
 * `aiContent` accumulates ONLY content deltas — reasoning bytes are
 * accounted for via `reasoningLength` and (for chapter modes) written
 * straight to disk inside `<think>` … `</think>` framing.
 */
async function consumeLlmStream(args: {
  apiResponse: Response & { body: ReadableStream<Uint8Array> };
  file: Deno.FsFile | null;
  encoder: TextEncoder;
  writeMode: WriteMode;
  target: ChapterTarget;
  storyCtx: StoryContext;
  signal: AbortSignal | undefined;
  onDelta: ((bytes: string) => void) | undefined;
  hookDispatcher: HookDispatcher;
  reqLog: Logger;
  llmLog: Logger;
  llmStartTime: number;
}): Promise<StreamConsumeResult> {
  const file = args.file;
  try {
    const {
      apiResponse,
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
    } = args;
    const { chapterPath, targetNum } = target;
    const { storyDir, series, name, correlationId } = storyCtx;

    let aiContent = "";
    let sawModelContent = false;
    let aborted = false;
    let inThinkBlock = false;
    let reasoningLength = 0;
    let tokenUsage: StreamConsumeResult["tokenUsage"] = {
      prompt: null,
      completion: null,
      total: null,
      cost: null,
    };

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

    const handlePayload = async (payload: string): Promise<void> => {
      if (payload === "[DONE]") return;
      let raw: unknown;
      try {
        raw = JSON.parse(payload);
      } catch (_err: unknown) {
        log.debug(`[chat:stream] Malformed JSON chunk (${payload.length} bytes): ${payload.slice(0, 200)}`);
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
        const costRaw = (parsed.usage as Record<string, unknown>).cost;
        const cost = typeof costRaw === "number" && isFinite(costRaw) && costRaw >= 0
          ? costRaw
          : null;
        tokenUsage = {
          prompt: parsed.usage.prompt_tokens ?? null,
          completion: parsed.usage.completion_tokens ?? null,
          total: parsed.usage.total_tokens ?? null,
          cost,
        };
      }
    };

    try {
      const reader = apiResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

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
      const errMsg = errorMessage(err);
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
        reqLog.warn("close-think-block failed during streaming finally", {
          error: errorMessage(cleanupErr),
        });
      }
    }

    return { aiContent, sawModelContent, aborted, reasoningLength, tokenUsage };
  } finally {
    if (file) file.close();
  }
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
