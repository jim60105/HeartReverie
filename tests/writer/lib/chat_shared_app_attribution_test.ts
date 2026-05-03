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

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { executeChat } from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import type {
  AppConfig,
  BuildPromptResult,
  LlmConfig,
} from "../../../writer/types.ts";

function buildConfig(tmpDir: string): AppConfig {
  const llmDefaults: LlmConfig = {
    model: "default-model",
    temperature: 0.1,
    frequencyPenalty: 0.13,
    presencePenalty: 0.52,
    topK: 10,
    topP: 0,
    repetitionPenalty: 1.2,
    minP: 0,
    topA: 1,
    reasoningEnabled: true,
    reasoningEffort: "high",
    maxCompletionTokens: 4096,
  };
  return {
    ROOT_DIR: "/x",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/x",
    PLUGINS_DIR: "/x",
    PORT: 0,
    LLM_API_URL: "https://example.test/chat/completions",
    LLM_MODEL: "default-model",
    LLM_TEMPERATURE: 0.1,
    LLM_FREQUENCY_PENALTY: 0.13,
    LLM_PRESENCE_PENALTY: 0.52,
    LLM_TOP_K: 10,
    LLM_TOP_P: 0,
    LLM_REPETITION_PENALTY: 1.2,
    LLM_MIN_P: 0,
    LLM_TOP_A: 1,
    LLM_REASONING_ENABLED: true,
    LLM_REASONING_EFFORT: "high",
    LLM_REASONING_OMIT: false,
    LLM_MAX_COMPLETION_TOKENS: 4096,
    llmDefaults,
    BACKGROUND_IMAGE: "/bg",
    PROMPT_FILE: "x",
  } as unknown as AppConfig;
}

function captureUpstreamFetch(): {
  restore: () => void;
  captured: { headers: Headers | null };
} {
  const original = globalThis.fetch;
  const captured: { headers: Headers | null } = { headers: null };
  globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      captured.headers = new Headers(opts?.headers ?? {});
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              const enc = new TextEncoder();
              c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
              c.enqueue(enc.encode("data: [DONE]\n\n"));
              c.close();
            },
          }),
          { status: 200 },
        ),
      );
    }
    return original(url as string, opts);
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, captured };
}

const buildPromptStub = () =>
  Promise.resolve({
    messages: [{ role: "user" as const, content: "p" }],
    previousContext: [],
    isFirstRound: true,
    ventoError: null,
    chapterFiles: [],
    chapters: [],
  } as BuildPromptResult);

Deno.test({
  name: "chat-shared: OpenRouter app-attribution headers attached to upstream fetch",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const previousKey = Deno.env.get("LLM_API_KEY");
    Deno.env.set("LLM_API_KEY", "k");
    try {
      await t.step("default chat request carries the three attribution headers", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-attribution-1-" });
      try {
        await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
        const cap = captureUpstreamFetch();
        try {
          await executeChat({
            series: "s1",
            name: "n1",
            message: "Hi",
            config: buildConfig(tmpDir),
            safePath: createSafePath(tmpDir),
            hookDispatcher: new HookDispatcher(),
            buildPromptFromStory: buildPromptStub,
          });
        } finally {
          cap.restore();
        }
        const headers = cap.captured.headers!;
        assertEquals(
          headers.get("HTTP-Referer"),
          "https://github.com/jim60105/HeartReverie",
        );
        assertEquals(
          headers.get("X-OpenRouter-Title"),
          "HeartReverie",
        );
        assertEquals(
          headers.get("X-OpenRouter-Categories"),
          "roleplay,creative-writing",
        );
        // existing headers still present
        assertEquals(headers.get("Content-Type"), "application/json");
        assertEquals(headers.get("Authorization"), "Bearer k");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("attribution headers attached even when LLM_API_URL is non-OpenRouter", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-attribution-2-" });
      try {
        await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
        const config = buildConfig(tmpDir);
        // Override to a non-OpenRouter URL while keeping the path component the
        // captureUpstreamFetch matcher recognizes.
        const cfgWithCustomUrl = {
          ...config,
          LLM_API_URL: "https://self-hosted.example/v1/chat/completions",
        } as AppConfig;
        const cap = captureUpstreamFetch();
        try {
          await executeChat({
            series: "s1",
            name: "n1",
            message: "Hi",
            config: cfgWithCustomUrl,
            safePath: createSafePath(tmpDir),
            hookDispatcher: new HookDispatcher(),
            buildPromptFromStory: buildPromptStub,
          });
        } finally {
          cap.restore();
        }
        const headers = cap.captured.headers!;
        assertEquals(
          headers.get("HTTP-Referer"),
          "https://github.com/jim60105/HeartReverie",
        );
        assertEquals(
          headers.get("X-OpenRouter-Title"),
          "HeartReverie",
        );
        assertEquals(
          headers.get("X-OpenRouter-Categories"),
          "roleplay,creative-writing",
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
    } finally {
      if (previousKey === undefined) {
        Deno.env.delete("LLM_API_KEY");
      } else {
        Deno.env.set("LLM_API_KEY", previousKey);
      }
    }
  },
});
