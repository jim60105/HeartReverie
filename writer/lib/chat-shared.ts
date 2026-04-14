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
import type { AppConfig, SafePathFn, BuildPromptFn, LLMStreamChunk, VentoError } from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";

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
    public readonly code: "api-key" | "bad-path" | "vento" | "no-prompt" | "llm-api" | "no-body" | "no-content",
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

  // 1. Validate API key
  if (!Deno.env.get("LLM_API_KEY")) {
    throw new ChatError("api-key", "LLM_API_KEY is not configured", 500);
  }

  // 2. Resolve story directory
  const storyDir = safePath(series, name);
  if (!storyDir) {
    throw new ChatError("bad-path", "Invalid path", 400);
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

  const apiResponse = await fetch(config.LLM_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("LLM_API_KEY")}`,
    },
    body: JSON.stringify({
      model: config.LLM_MODEL,
      messages,
      stream: true,
      temperature: config.LLM_TEMPERATURE,
      frequency_penalty: config.LLM_FREQUENCY_PENALTY,
      presence_penalty: config.LLM_PRESENCE_PENALTY,
      top_k: config.LLM_TOP_K,
      top_p: config.LLM_TOP_P,
      repetition_penalty: config.LLM_REPETITION_PENALTY,
      min_p: config.LLM_MIN_P,
      top_a: config.LLM_TOP_A,
    }),
    signal,
  });

  if (!apiResponse.ok) {
    const errorBody = await apiResponse.text();
    console.error("LLM API error:", apiResponse.status, errorBody);
    throw new ChatError("llm-api", "AI service request failed", apiResponse.status);
  }

  if (!apiResponse.body) {
    throw new ChatError("no-body", "No response body from AI service", 502);
  }

  // 6. Determine target chapter: reuse last empty file or create next
  let targetNum: number;
  const lastFile = chapterFiles[chapterFiles.length - 1];
  if (lastFile && chapters[chapters.length - 1]?.content.trim() === "") {
    targetNum = parseInt(lastFile, 10);
  } else {
    const maxNum = chapterFiles.length > 0
      ? Math.max(...chapterFiles.map((f) => parseInt(f, 10)))
      : 0;
    targetNum = maxNum + 1;
  }
  const padded = String(targetNum).padStart(3, "0");

  await Deno.mkdir(storyDir, { recursive: true });

  const chapterPath = join(storyDir, `${padded}.md`);
  const encoder = new TextEncoder();
  let aiContent = "";

  // Dispatch pre-write hook before file truncation
  const preWriteCtx = await hookDispatcher.dispatch("pre-write", {
    message,
    chapterPath,
    storyDir,
    series,
    name,
    preContent: "",
  });
  const preContent = preWriteCtx.preContent as string;

  const file = await Deno.open(chapterPath, { write: true, create: true, truncate: true });
  if (preContent) {
    await file.write(encoder.encode(preContent));
  }

  let aborted = false;
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
            aiContent += delta;
            await file.write(encoder.encode(delta));
            onDelta?.(delta);
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
              aiContent += delta;
              await file.write(encoder.encode(delta));
              onDelta?.(delta);
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
      throw err;
    }
  } finally {
    file.close();
  }

  // On abort: throw ChatAbortError after file cleanup so callers can handle it
  if (aborted) {
    throw new ChatAbortError("Generation aborted by client");
  }

  if (!aiContent) {
    throw new ChatError("no-content", "No content in AI response", 502);
  }

  const fullContent = preContent + aiContent;

  // 8. Run post-response hooks
  await hookDispatcher.dispatch("post-response", {
    content: fullContent,
    storyDir,
    series,
    name,
    rootDir: config.ROOT_DIR,
  });

  return { chapter: targetNum, content: fullContent };
}
