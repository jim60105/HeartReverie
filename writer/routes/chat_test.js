// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { assertEquals, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../app.js";
import { createSafePath, verifyPassphrase } from "../lib/middleware.js";
import { HookDispatcher } from "../lib/hooks.js";

async function makeRequest(app, method, urlPath, body, headers) {
  const init = {
    method,
    headers: { "x-passphrase": "test-pass", ...headers },
  };
  if (body) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${urlPath}`, init));
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed, headers: Object.fromEntries(res.headers) };
}

Deno.test({ name: "chat routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "chat-test-" });
  Deno.env.set("PASSPHRASE", "test-pass");
  Deno.env.set("OPENROUTER_API_KEY", "test-key-for-validation");

  const safePath = createSafePath(tmpDir);
  const app = createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: "/nonexistent-root",
      OPENROUTER_API_URL: "https://openrouter.ai/api/v1/chat/completions",
      OPENROUTER_MODEL: "test-model",
    },
    safePath,
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [],
      getPluginDir: () => null,
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    },
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({
      prompt: "test prompt",
      ventoError: null,
      chapterFiles: [],
      chapters: [],
    }),
    verifyPassphrase,
  });

  try {
    await t.step("returns 400 for empty message", async () => {
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/s1/n1/chat",
        { message: "" },
      );
      assertEquals(res.status, 400);
      assertMatch(res.body.detail, /non-empty string/);
    });

    await t.step("returns 400 for missing message", async () => {
      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/s1/n1/chat",
        {},
      );
      assertEquals(res.status, 400);
    });

    await t.step("returns 500 when OPENROUTER_API_KEY not set", async () => {
      const origKey = Deno.env.get("OPENROUTER_API_KEY");
      Deno.env.delete("OPENROUTER_API_KEY");

      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/s1/n1/chat",
        { message: "Hello" },
      );
      assertEquals(res.status, 500);
      assertMatch(res.body.detail, /OPENROUTER_API_KEY/);

      Deno.env.set("OPENROUTER_API_KEY", origKey);
    });
  } finally {
    Deno.env.delete("OPENROUTER_API_KEY");
    await Deno.remove(tmpDir, { recursive: true });
  }
} });

Deno.test({ name: "chat routes – extended coverage", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const originalFetch = globalThis.fetch;

  function makeDeps(overrides = {}) {
    const tmpDir = overrides._tmpDir;
    return {
      config: {
        READER_DIR: "/nonexistent-reader",
        PLAYGROUND_DIR: tmpDir,
        ROOT_DIR: "/nonexistent-root",
        OPENROUTER_API_URL: "https://openrouter.ai/api/v1/chat/completions",
        OPENROUTER_MODEL: "test-model",
      },
      safePath: createSafePath(tmpDir),
      pluginManager: {
        getPlugins: () => [],
        getParameters: () => [],
        getPluginDir: () => null,
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
      },
      hookDispatcher: overrides.hookDispatcher ?? new HookDispatcher(),
      buildPromptFromStory: overrides.buildPromptFromStory ?? (async () => ({
        prompt: "test prompt",
        ventoError: null,
        chapterFiles: [],
        chapters: [],
      })),
      verifyPassphrase,
      ...overrides,
    };
  }

  function mockOpenRouterFetch(sseChunks, statusCode = 200) {
    globalThis.fetch = async (url, opts) => {
      if (typeof url === "string" && url.includes("openrouter")) {
        return new Response(
          new ReadableStream({
            start(controller) {
              const encoder = new TextEncoder();
              for (const chunk of sseChunks) {
                controller.enqueue(encoder.encode(chunk));
              }
              controller.close();
            },
          }),
          { status: statusCode },
        );
      }
      return originalFetch(url, opts);
    };
  }

  function mockOpenRouterFetchError(statusCode, body = "API error") {
    globalThis.fetch = async (url, _opts) => {
      if (typeof url === "string" && url.includes("openrouter")) {
        return new Response(body, { status: statusCode });
      }
      return originalFetch(url, _opts);
    };
  }

  await t.step("returns 400 when message exceeds max length", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-maxlen-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      const longMessage = "a".repeat(100_001);
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: longMessage });
      assertEquals(res.status, 400);
      assertMatch(res.body.detail, /exceeds maximum length/);
    } finally {
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("returns 422 when buildPromptFromStory returns ventoError", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-vento-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    try {
      const app = createApp(makeDeps({
        _tmpDir: tmpDir,
        buildPromptFromStory: async () => ({
          prompt: "",
          ventoError: { stage: "prompt-assembly", message: "bad template" },
          chapterFiles: [],
          chapters: [],
        }),
      }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hello" });
      assertEquals(res.status, 422);
      assertEquals(res.body.type, "vento-error");
      assertEquals(res.body.message, "bad template");
    } finally {
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("returns 500 when buildPromptFromStory throws", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-throw-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    try {
      const app = createApp(makeDeps({
        _tmpDir: tmpDir,
        buildPromptFromStory: async () => { throw new Error("prompt build failed"); },
      }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hello" });
      assertEquals(res.status, 500);
      assertMatch(res.body.detail, /Failed to process/);
    } finally {
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("returns error status when OpenRouter API returns non-200", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-apierr-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    mockOpenRouterFetchError(429, "rate limited");
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hello" });
      assertEquals(res.status, 429);
      assertMatch(res.body.detail, /AI service request failed/);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("returns 502 when AI response has no content (only [DONE])", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-empty-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    mockOpenRouterFetch(["data: [DONE]\n\n"]);
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hello" });
      assertEquals(res.status, 502);
      assertMatch(res.body.detail, /No content/);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("successful SSE streaming writes file and returns chapter + content", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-sse-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    mockOpenRouterFetch([
      'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hi" });
      assertEquals(res.status, 200);
      assertEquals(res.body.chapter, 1);
      assertMatch(res.body.content, /Hello world/);
      assertMatch(res.body.content, /<user_message>/);

      // Verify file was written
      const written = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
      assertMatch(written, /<user_message>\nHi\n<\/user_message>/);
      assertMatch(written, /Hello world/);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("reuses last empty chapter file instead of creating next", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-reuse-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    mockOpenRouterFetch([
      'data: {"choices":[{"delta":{"content":"Response"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    try {
      const app = createApp(makeDeps({
        _tmpDir: tmpDir,
        buildPromptFromStory: async () => ({
          prompt: "test prompt",
          ventoError: null,
          chapterFiles: ["001", "002"],
          chapters: [
            { content: "some content" },
            { content: "" },
          ],
        }),
      }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Continue" });
      assertEquals(res.status, 200);
      // Should reuse chapter 2 (the last empty one), not create chapter 3
      assertEquals(res.body.chapter, 2);

      // File should be 002.md
      const written = await Deno.readTextFile(join(tmpDir, "s1", "n1", "002.md"));
      assertMatch(written, /Response/);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("creates next chapter when last chapter has content", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-next-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    mockOpenRouterFetch([
      'data: {"choices":[{"delta":{"content":"New chapter"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    try {
      const app = createApp(makeDeps({
        _tmpDir: tmpDir,
        buildPromptFromStory: async () => ({
          prompt: "test prompt",
          ventoError: null,
          chapterFiles: ["001", "002"],
          chapters: [
            { content: "chapter 1 content" },
            { content: "chapter 2 content" },
          ],
        }),
      }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "More" });
      assertEquals(res.status, 200);
      assertEquals(res.body.chapter, 3);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("post-response hook is dispatched after successful chat", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-hook-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    mockOpenRouterFetch([
      'data: {"choices":[{"delta":{"content":"hook test"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    let hookCalled = false;
    let hookContext = null;
    const hookDispatcher = new HookDispatcher();
    hookDispatcher.register("post-response", async (ctx) => {
      hookCalled = true;
      hookContext = ctx;
    });
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir, hookDispatcher }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Test hook" });
      assertEquals(res.status, 200);
      assertEquals(hookCalled, true);
      assertMatch(hookContext.content, /hook test/);
      assertEquals(hookContext.series, "s1");
      assertEquals(hookContext.name, "n1");
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("handles malformed JSON in SSE stream gracefully", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-malform-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("OPENROUTER_API_KEY", "test-key");
    mockOpenRouterFetch([
      "data: {bad json}\n\n",
      'data: {"choices":[{"delta":{"content":"OK"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Malformed test" });
      assertEquals(res.status, 200);
      assertMatch(res.body.content, /OK/);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OPENROUTER_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
} });
