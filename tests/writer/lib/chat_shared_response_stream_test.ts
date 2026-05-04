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

import { assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { executeChat } from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import type { AppConfig, BuildPromptResult } from "../../../writer/types.ts";

function buildConfig(tmpDir: string): AppConfig {
  return {
    ROOT_DIR: "/nonexistent-root",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/nonexistent-reader",
    PLUGINS_DIR: "/nonexistent-plugins",
    PORT: 0,
    LLM_API_URL: "https://openrouter.ai/api/v1/chat/completions",
    LLM_MODEL: "test-model",
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
      model: "test-model",
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
    THEME_DIR: "./themes/",
    PROMPT_FILE: "nonexistent",
  };
}

function mockFetchFromChunks(chunks: string[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      return Promise.resolve(new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            for (const c of chunks) controller.enqueue(encoder.encode(c));
            controller.close();
          },
        }),
        { status: 200 },
      ));
    }
    return original(url as string, opts);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

interface RunOptions {
  chunks: string[];
  hookDispatcher: HookDispatcher;
  onDelta?: (s: string) => void;
  series?: string;
  name?: string;
}

async function runChat(tmpDir: string, opts: RunOptions) {
  const series = opts.series ?? "s1";
  const name = opts.name ?? "n1";
  await Deno.mkdir(join(tmpDir, series, name), { recursive: true });
  const restore = mockFetchFromChunks(opts.chunks);
  try {
    return await executeChat({
      series,
      name,
      message: "Hi",
      config: buildConfig(tmpDir),
      safePath: createSafePath(tmpDir),
      hookDispatcher: opts.hookDispatcher,
      buildPromptFromStory: (() => Promise.resolve({
        messages: [{ role: "user" as const, content: "test prompt" }],
        previousContext: [],
        isFirstRound: true,
        ventoError: null,
        chapterFiles: [],
        chapters: [],
      } as BuildPromptResult)),
      onDelta: opts.onDelta,
    });
  } finally {
    restore();
  }
}

Deno.test({
  name: "response-stream hook – chat-shared",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("LLM_API_KEY", "test-key");

    await t.step("3.2 dispatch occurs per delta with original chunk values", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-per-delta-" });
      try {
        const seen: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          seen.push(ctx.chunk as string);
          return Promise.resolve();
        });
        await runChat(tmpDir, {
          hookDispatcher: hd,
          chunks: [
            'data: {"choices":[{"delta":{"content":"alpha"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"beta"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"gamma"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(seen, ["alpha", "beta", "gamma"]);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.3 no-handler baseline byte-for-byte identical", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-baseline-" });
      try {
        const deltas: string[] = [];
        const hd = new HookDispatcher();
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(deltas, ["Hello ", "world"]);
        assertEquals(result.content, "Hello world");
        const written = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(written, "Hello world");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.4 handler transforms chunk (uppercase)", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-transform-" });
      try {
        const deltas: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          ctx.chunk = (ctx.chunk as string).toUpperCase();
          return Promise.resolve();
        });
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(deltas, ["HELLO ", "WORLD"]);
        assertEquals(result.content, "HELLO WORLD");
        const written = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(written, "HELLO WORLD");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.5 handler drops specific chunk via empty string", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-drop-" });
      try {
        const deltas: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          if (ctx.chunk === "DROP") ctx.chunk = "";
          return Promise.resolve();
        });
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"content":"keep1"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"DROP"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"keep2"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(deltas, ["keep1", "keep2"]);
        assertEquals(result.content, "keep1keep2");
        const written = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(written, "keep1keep2");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.6 multiple handlers compose by priority", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-compose-" });
      try {
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          ctx.chunk = (ctx.chunk as string).toUpperCase();
          return Promise.resolve();
        }, 10);
        hd.register("response-stream", (ctx) => {
          ctx.chunk = "<" + (ctx.chunk as string) + ">";
          return Promise.resolve();
        }, 20);
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          chunks: [
            'data: {"choices":[{"delta":{"content":"hello"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(result.content, "<HELLO>");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.7 non-string mutation coerces to empty (drop)", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-nonstring-" });
      try {
        const deltas: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          if (ctx.chunk === "bad") {
            (ctx as Record<string, unknown>).chunk = 42;
          }
          return Promise.resolve();
        });
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"content":"good"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"bad"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(deltas, ["good"]);
        assertEquals(result.content, "good");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.8 handler exception isolated; stream continues", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-error-" });
      try {
        const deltas: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (_ctx) => {
          throw new Error("boom");
        }, 10);
        hd.register("response-stream", (ctx) => {
          ctx.chunk = "[" + (ctx.chunk as string) + "]";
          return Promise.resolve();
        }, 20);
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"content":"x"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"y"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        // The thrower failed before mutating, but the later handler still ran
        // with the original chunk and wrapped it.
        assertEquals(deltas, ["[x]", "[y]"]);
        assertEquals(result.content, "[x][y]");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.9 trailing-buffer delta is dispatched", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-trailing-" });
      try {
        const seen: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          seen.push(ctx.chunk as string);
          return Promise.resolve();
        });
        // Last data line has no trailing \n — lands in residual buffer.
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          chunks: [
            'data: {"choices":[{"delta":{"content":"first"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"last"}}]}',
          ],
        });
        assertEquals(seen, ["first", "last"]);
        assertStringIncludes(result.content, "firstlast");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.10 other field mutations ignored for persistence", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-readonly-" });
      try {
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          const c = ctx as unknown as Record<string, unknown>;
          c.chapterPath = "/tmp/elsewhere.md";
          c.chapterNumber = 999;
          return Promise.resolve();
        });
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          chunks: [
            'data: {"choices":[{"delta":{"content":"abc"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(result.chapter, 1);
        const written = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertStringIncludes(written, "abc");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.11 all chunks dropped completes without 502", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-all-dropped-" });
      try {
        const deltas: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          ctx.chunk = "";
          return Promise.resolve();
        });
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"content":"alpha"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"beta"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"gamma"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        // No deltas surfaced; content is empty; but no error was thrown.
        assertEquals(deltas, []);
        assertEquals(result.content, "");
        const written = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(written, "");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("3.12 delete context.chunk coerces to drop", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "rs-delete-" });
      try {
        const deltas: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          if (ctx.chunk === "DROP") {
            delete (ctx as Record<string, unknown>).chunk;
          }
          return Promise.resolve();
        });
        const result = await runChat(tmpDir, {
          hookDispatcher: hd,
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"content":"keep1"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"DROP"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"keep2"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(deltas, ["keep1", "keep2"]);
        assertEquals(result.content, "keep1keep2");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    Deno.env.delete("LLM_API_KEY");
  },
});
