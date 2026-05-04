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

import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { ContinuePromptError } from "../../../writer/lib/story.ts";
import type { Hono } from "@hono/hono";
import type {
  AppConfig,
  AppDeps,
  BuildContinuePromptFn,
  ContinuePromptResult,
} from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

async function makeRequest(
  app: Hono,
  method: string,
  urlPath: string,
  body?: Record<string, unknown> | null,
  headers?: Record<string, string>,
) {
  const init: RequestInit = {
    method,
    headers: { "x-passphrase": "test-pass", ...headers },
  };
  if (body !== undefined && body !== null) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${urlPath}`, init));
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed as Record<string, unknown> | null };
}

function makeDeps(
  tmpDir: string,
  buildContinuePromptFromStory: BuildContinuePromptFn,
): AppDeps {
  return {
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: "/nonexistent-root",
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
    } as unknown as AppConfig,
    safePath: createSafePath(tmpDir),
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [],
      getPluginDir: () => null,
      getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: () => Promise.resolve({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: (() =>
      Promise.resolve({
        messages: [],
        ventoError: null,
        chapterFiles: [],
        chapters: [],
      })) as unknown as AppDeps["buildPromptFromStory"],
    buildContinuePromptFromStory,
    verifyPassphrase,
  } as AppDeps;
}

function mockLLMSuccess(chunks: string[]): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      return Promise.resolve(new Response(
        new ReadableStream({
          start(c) {
            const enc = new TextEncoder();
            for (const chunk of chunks) c.enqueue(enc.encode(chunk));
            c.close();
          },
        }),
        { status: 200 },
      ));
    }
    return orig(url as string, opts);
  }) as typeof fetch;
  return () => { globalThis.fetch = orig; };
}

function makePromptResult(
  existing: string,
  prefill: string,
  userText: string,
  targetNum = 1,
): ContinuePromptResult {
  const messages: ContinuePromptResult["messages"] = [
    { role: "system", content: "sys" },
    { role: "user", content: userText },
  ];
  if (prefill.trim().length > 0) {
    messages.push({ role: "assistant", content: prefill });
  }
  return {
    messages,
    ventoError: null,
    targetChapterNumber: targetNum,
    existingContent: existing,
    userMessageText: userText,
    assistantPrefill: prefill,
  };
}

Deno.test({
  name: "POST /api/stories/:series/:name/chat/continue",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("PASSPHRASE", "test-pass");
    const previousKey = Deno.env.get("LLM_API_KEY");
    Deno.env.set("LLM_API_KEY", "test-key");

    try {
      // ──────────────────────────────────────────────────────────
      await t.step("happy path: 200 with full chapter content", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_route_continue_ok_" });
        try {
          const original = "<user_message>q</user_message>\n\nseed";
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          await Deno.writeTextFile(join(tmpDir, "s1", "n1", "001.md"), original);

          const app = createApp(
            makeDeps(tmpDir, () => Promise.resolve(makePromptResult(original, "seed", "q"))),
          );
          const restore = mockLLMSuccess([
            'data: {"choices":[{"delta":{"content":" added"}}]}\n\n',
            "data: [DONE]\n\n",
          ]);
          try {
            const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat/continue", {});
            assertEquals(res.status, 200);
            assertEquals(res.body!.chapter, 1);
            assertEquals(res.body!.content, original + " added");
          } finally {
            restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ──────────────────────────────────────────────────────────
      await t.step("409 conflict when on-disk chapter no longer matches snapshot", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_route_continue_conflict_" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          await Deno.writeTextFile(join(tmpDir, "s1", "n1", "001.md"), "actual disk bytes");

          const app = createApp(
            makeDeps(tmpDir, () => Promise.resolve(makePromptResult("STALE bytes", "p", "q"))),
          );
          const restore = mockLLMSuccess(["data: [DONE]\n\n"]);
          try {
            const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat/continue", {});
            assertEquals(res.status, 409);
            assertEquals(res.body!.title, "Conflict");
            assertMatch(String(res.body!.detail), /chapter changed|retry/i);
          } finally {
            restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ──────────────────────────────────────────────────────────
      await t.step("400 no-chapter when build throws ContinuePromptError(no-chapter)", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_route_continue_nc_" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const app = createApp(makeDeps(tmpDir, () => {
            throw new ContinuePromptError("no-chapter", "Cannot continue: no existing chapter file", 400);
          }));
          const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat/continue", {});
          assertEquals(res.status, 400);
          assertEquals(res.body!.title, "Bad Request");
          assertMatch(String(res.body!.detail), /no existing chapter/i);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ──────────────────────────────────────────────────────────
      await t.step("400 no-content when build throws ContinuePromptError(no-content)", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_route_continue_no_" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const app = createApp(makeDeps(tmpDir, () => {
            throw new ContinuePromptError("no-content", "Latest chapter has no content to continue", 400);
          }));
          const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat/continue", {});
          assertEquals(res.status, 400);
          assertMatch(String(res.body!.detail), /no content/i);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ──────────────────────────────────────────────────────────
      await t.step("422 vento when build returns ventoError", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_route_continue_vento_" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          await Deno.writeTextFile(join(tmpDir, "s1", "n1", "001.md"), "x");

          const app = createApp(makeDeps(tmpDir, () =>
            Promise.resolve({
              messages: [],
              ventoError: {
                message: "syntax error",
                file: "prompt.vto",
                line: 3,
                column: 5,
                snippet: "{{ broken }}",
              },
              targetChapterNumber: 1,
              existingContent: "x",
              userMessageText: "",
              assistantPrefill: "",
            } as unknown as ContinuePromptResult)
          ));
          const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat/continue", {});
          assertEquals(res.status, 422);
          assertEquals((res.body as Record<string, unknown>).type, "vento-error");
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ──────────────────────────────────────────────────────────
      await t.step("400 bad path when series contains traversal", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_route_continue_badpath_" });
        try {
          const app = createApp(makeDeps(tmpDir, () =>
            Promise.reject(new Error("should not be called"))
          ));
          // `..` segments are blocked by validateParams middleware; URL-encode
          // the slash so Hono receives the literal segment.
          const res = await makeRequest(app, "POST", "/api/stories/..%2Fevil/n1/chat/continue", {});
          assertEquals(res.status, 400);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ──────────────────────────────────────────────────────────
      await t.step("500 when LLM_API_KEY is missing", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_route_continue_nokey_" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          await Deno.writeTextFile(join(tmpDir, "s1", "n1", "001.md"), "x");

          Deno.env.delete("LLM_API_KEY");
          try {
            const app = createApp(makeDeps(tmpDir, () =>
              Promise.resolve(makePromptResult("x", "x", "x"))
            ));
            const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat/continue", {});
            assertEquals(res.status, 500);
            assertMatch(String(res.body!.detail), /LLM_API_KEY/);
          } finally {
            Deno.env.set("LLM_API_KEY", "test-key");
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });
    } finally {
      if (previousKey === undefined) Deno.env.delete("LLM_API_KEY");
      else Deno.env.set("LLM_API_KEY", previousKey);
    }
  },
});
