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
import type { AppConfig, BuildPromptResult } from "../../../writer/types.ts";

function buildConfig(tmpDir: string): AppConfig {
  return {
    ROOT_DIR: "/x",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/x",
    PLUGINS_DIR: "/x",
    PORT: 0,
    CERT_FILE: undefined,
    KEY_FILE: undefined,
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
    llmDefaults: {
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
    },
    BACKGROUND_IMAGE: "/bg",
    PROMPT_FILE: "x",
  } as unknown as AppConfig;
}

function captureUpstreamFetch(): {
  restore: () => void;
  captured: { body: Record<string, unknown> | null };
} {
  const original = globalThis.fetch;
  const captured: { body: Record<string, unknown> | null } = { body: null };
  globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      if (opts?.body) captured.body = JSON.parse(String(opts.body));
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

Deno.test({
  name: "chat-shared: per-story _config.json overrides reach upstream fetch body",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("LLM_API_KEY", "k");

    await t.step("temperature override is applied; other fields fall back to defaults", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-pso-" });
      try {
        const storyDir = join(tmpDir, "s1", "n1");
        await Deno.mkdir(storyDir, { recursive: true });
        await Deno.writeTextFile(
          join(storyDir, "_config.json"),
          JSON.stringify({ temperature: 0.9, model: "story-specific" }),
        );

        const cap = captureUpstreamFetch();
        try {
          await executeChat({
            series: "s1",
            name: "n1",
            message: "Hi",
            config: buildConfig(tmpDir),
            safePath: createSafePath(tmpDir),
            hookDispatcher: new HookDispatcher(),
            buildPromptFromStory: () =>
              Promise.resolve({
                prompt: "p",
                previousContext: [],
                isFirstRound: true,
                ventoError: null,
                chapterFiles: [],
                chapters: [],
              } as BuildPromptResult),
          });
        } finally {
          cap.restore();
        }

        assertEquals(cap.captured.body !== null, true);
        const body = cap.captured.body!;
        assertEquals(body.temperature, 0.9);
        assertEquals(body.model, "story-specific");
        // Unset fields fall back to defaults
        assertEquals(body.top_k, 10);
        assertEquals(body.frequency_penalty, 0.13);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("absent _config.json → defaults are used verbatim", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-pso-def-" });
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
            buildPromptFromStory: () =>
              Promise.resolve({
                prompt: "p",
                previousContext: [],
                isFirstRound: true,
                ventoError: null,
                chapterFiles: [],
                chapters: [],
              } as BuildPromptResult),
          });
        } finally {
          cap.restore();
        }
        const body = cap.captured.body!;
        assertEquals(body.model, "default-model");
        assertEquals(body.temperature, 0.1);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    Deno.env.delete("LLM_API_KEY");
  },
});
