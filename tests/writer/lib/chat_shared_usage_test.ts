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
import { executeChat, ChatAbortError } from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import { readUsage, USAGE_FILENAME } from "../../../writer/lib/usage.ts";
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

type FetchFn = typeof fetch;

function stubFetch(chunks: string[]): { restore: () => void } {
  const original: FetchFn = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, _opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              const enc = new TextEncoder();
              for (const chunk of chunks) c.enqueue(enc.encode(chunk));
              c.close();
            },
          }),
          { status: 200 },
        ),
      );
    }
    return original(url as string, _opts);
  }) as FetchFn;
  return { restore: () => { globalThis.fetch = original; } };
}

function buildPromptStub() {
  return (): Promise<BuildPromptResult> =>
    Promise.resolve({
      messages: [{ role: "user" as const, content: "p" }],
      previousContext: [],
      isFirstRound: true,
      ventoError: null,
      chapterFiles: [],
      chapters: [],
    } as BuildPromptResult);
}

Deno.test({
  name: "chat-shared usage persistence",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("LLM_API_KEY", "k");

    await t.step("success with usage → append to _usage.json and return record", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-usage-ok-" });
      try {
        await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
        const stub = stubFetch([
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          'data: {"choices":[],"usage":{"prompt_tokens":11,"completion_tokens":22,"total_tokens":33}}\n\n',
          "data: [DONE]\n\n",
        ]);
        try {
          const result = await executeChat({
            series: "s1",
            name: "n1",
            message: "Hi",
            config: buildConfig(tmpDir),
            safePath: createSafePath(tmpDir),
            hookDispatcher: new HookDispatcher(),
            buildPromptFromStory: buildPromptStub(),
          });
          assertEquals(result.usage?.promptTokens, 11);
          assertEquals(result.usage?.completionTokens, 22);
          assertEquals(result.usage?.totalTokens, 33);
          assertEquals(result.usage?.model, "default-model");
          assertEquals(result.usage?.chapter, 1);
        } finally {
          stub.restore();
        }
        const records = await readUsage(join(tmpDir, "s1", "n1"));
        assertEquals(records.length, 1);
        assertEquals(records[0]!.totalTokens, 33);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("success without usage → ChatResult.usage is null and no file written", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-usage-none-" });
      try {
        await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
        const stub = stubFetch([
          'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
          "data: [DONE]\n\n",
        ]);
        try {
          const result = await executeChat({
            series: "s1",
            name: "n1",
            message: "Hi",
            config: buildConfig(tmpDir),
            safePath: createSafePath(tmpDir),
            hookDispatcher: new HookDispatcher(),
            buildPromptFromStory: buildPromptStub(),
          });
          assertEquals(result.usage, null);
        } finally {
          stub.restore();
        }
        try {
          await Deno.stat(join(tmpDir, "s1", "n1", USAGE_FILENAME));
          throw new Error("_usage.json should not exist");
        } catch (err) {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        }
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("abort path → no usage written", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-usage-abort-" });
      try {
        await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
        const controller = new AbortController();
        // Abort before fetch completes via a fetch that rejects with AbortError.
        const original = globalThis.fetch;
        globalThis.fetch = ((_url: string | URL | Request, _opts?: RequestInit) =>
          Promise.reject(new DOMException("aborted", "AbortError"))) as FetchFn;
        try {
          controller.abort();
          let threw = false;
          try {
            await executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub(),
              signal: controller.signal,
            });
          } catch (err) {
            threw = err instanceof ChatAbortError;
          }
          assertEquals(threw, true);
        } finally {
          globalThis.fetch = original;
        }
        try {
          await Deno.stat(join(tmpDir, "s1", "n1", USAGE_FILENAME));
          throw new Error("_usage.json should not exist");
        } catch (err) {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        }
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    Deno.env.delete("LLM_API_KEY");
  },
});
