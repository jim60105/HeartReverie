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
import type { LLMStreamChunk } from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import { ChatError, type WriteMode } from "./chat-types.ts";
import type { ChapterTarget, StoryContext } from "./chat-chapter-io.ts";

const log = createLogger("llm");

/**
 * Final state produced by `consumeLlmStream`. Surfaces back to the caller
 * for the abort / no-content / latency-log / usage-assembly phase that
 * follows.
 */
export type StreamConsumeResult = {
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
export async function consumeLlmStream(args: {
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
    const notifyDelta = (bytes: string): void => {
      onDelta?.(bytes);
    };

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
        log.debug(
          `[chat:stream] Malformed JSON chunk (${payload.length} bytes): ${payload.slice(0, 200)}`,
        );
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
      const isChapterWritingMode = writeMode.kind === "write-new-chapter" ||
        writeMode.kind === "continue-last-chapter";
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
