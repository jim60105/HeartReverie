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
import { createLogger } from "../../../writer/lib/logger.ts";
import { register as registerUserMessage } from "../../../plugins/user-message/handler.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps, AppConfig, BuildPromptResult } from "../../../writer/types.ts";
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
  if (body) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
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
  Deno.env.set("LLM_API_KEY", "test-key-for-validation");

  const safePath = createSafePath(tmpDir);
  const app = createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: "/nonexistent-root",
      LLM_API_URL: "https://openrouter.ai/api/v1/chat/completions",
      LLM_MODEL: "test-model",
    } as unknown as AppConfig,
    safePath,
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [],
      getPluginDir: () => null,
        getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({
      prompt: "test prompt",
      ventoError: null,
      chapterFiles: [],
      chapters: [],
    }) as unknown as BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

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

    await t.step("returns 500 when LLM_API_KEY not set", async () => {
      const origKey = Deno.env.get("LLM_API_KEY");
      Deno.env.delete("LLM_API_KEY");

      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/s1/n1/chat",
        { message: "Hello" },
      );
      assertEquals(res.status, 500);
      assertMatch(res.body.detail, /LLM_API_KEY/);

      Deno.env.set("LLM_API_KEY", origKey!);
    });
  } finally {
    Deno.env.delete("LLM_API_KEY");
    await Deno.remove(tmpDir, { recursive: true });
  }
} });

Deno.test({ name: "chat routes – extended coverage", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const originalFetch = globalThis.fetch;

  function makeDeps(overrides: Record<string, unknown> = {}): AppDeps {
    const tmpDir = overrides._tmpDir as string;
    // Create hookDispatcher with user-message plugin registered (pre-write hook)
    const hd = (overrides.hookDispatcher as HookDispatcher | undefined) ?? new HookDispatcher();
    registerUserMessage({ hooks: hd, logger: createLogger("plugin", { baseData: { plugin: "user-message" } }) });
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
        },
      } as unknown as AppConfig,
      safePath: createSafePath(tmpDir),
      pluginManager: {
        getPlugins: () => [],
        getParameters: () => [],
        getPluginDir: () => null,
        getBuiltinDir: () => "/nonexistent-plugins",
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
      } as unknown as PluginManager,
      hookDispatcher: hd,
      buildPromptFromStory: (overrides.buildPromptFromStory ?? (async () => ({
        prompt: "test prompt",
        ventoError: null,
        chapterFiles: [],
        chapters: [],
      }))) as AppDeps["buildPromptFromStory"],
      verifyPassphrase,
      ...overrides,
    } as AppDeps;
  }

  function mockLLMFetch(sseChunks: string[], statusCode = 200) {
    globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("chat/completions")) {
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

  function mockLLMFetchError(statusCode: number, body = "API error") {
    globalThis.fetch = async (url: string | URL | Request, _opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("chat/completions")) {
        return new Response(body, { status: statusCode });
      }
      return originalFetch(url, _opts);
    };
  }

  await t.step("returns 400 when message exceeds max length", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-maxlen-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      const longMessage = "a".repeat(100_001);
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: longMessage });
      assertEquals(res.status, 400);
      assertMatch(res.body.detail, /exceeds maximum length/);
    } finally {
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("returns 422 when buildPromptFromStory returns ventoError", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-vento-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
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
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("returns 500 when buildPromptFromStory throws", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-throw-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
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
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("returns error status when LLM API returns non-200", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-apierr-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetchError(429, "rate limited");
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hello" });
      assertEquals(res.status, 429);
      assertMatch(res.body.detail, /AI service request failed/);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("returns 502 when AI response has no content (only [DONE])", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-empty-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetch(["data: [DONE]\n\n"]);
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hello" });
      assertEquals(res.status, 502);
      assertMatch(res.body.detail, /No content/);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("successful SSE streaming writes file and returns chapter + content", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-sse-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetch([
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
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("reuses last empty chapter file instead of creating next", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-reuse-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetch([
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
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("creates next chapter when last chapter has content", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-next-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetch([
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
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("post-response hook is dispatched after successful chat", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-hook-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetch([
      'data: {"choices":[{"delta":{"content":"hook test"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    let hookCalled = false;
    let hookContext: Record<string, unknown> | null = null;
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
      assertMatch(hookContext!.content as string, /hook test/);
      assertEquals(hookContext!.series, "s1");
      assertEquals(hookContext!.name, "n1");
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("handles malformed JSON in SSE stream gracefully", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-malform-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetch([
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
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("stream error mid-generation keeps partial file on disk", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-stream-err-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");

    // Mock fetch to return a stream that errors partway through
    globalThis.fetch = async (url: string | URL | Request, _opts?: RequestInit) => {
      if (typeof url === "string" && url.includes("chat/completions")) {
        let chunkSent = false;
        return new Response(
          new ReadableStream({
            pull(controller) {
              const encoder = new TextEncoder();
              if (!chunkSent) {
                chunkSent = true;
                controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"partial data"}}]}\n\n'));
              } else {
                controller.error(new Error("network failure"));
              }
            },
          }),
          { status: 200 },
        );
      }
      return originalFetch(url, _opts);
    };

    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Stream error" });
      // The partial file should exist on disk with at least user_message block
      const written = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
      assertMatch(written, /<user_message>/);
      // If partial data was flushed before error, it's there too
      // Either way the file exists and was not cleaned up
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("error response surfaces upstream body — 502 includes upstream detail", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-sanitize-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetchError(502, "<html>Internal gateway error with secrets</html>");
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hello" });
      assertEquals(res.status, 502);
      // Spec: the upstream response body SHALL be included (truncated) in
      // the RFC 9457 `detail` so a strict provider rejection is diagnosable.
      assertEquals(
        typeof res.body.detail === "string" &&
          res.body.detail.startsWith("AI service request failed: ") &&
          res.body.detail.includes("Internal gateway error with secrets"),
        true,
      );
      assertEquals(res.body.title, "AI Service Error");
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("post-response hook receives userBlock and aiContent in content", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-hook-content-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    mockLLMFetch([
      'data: {"choices":[{"delta":{"content":"AI reply"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    let hookContent: string | null = null;
    const hookDispatcher = new HookDispatcher();
    hookDispatcher.register("post-response", async (ctx) => {
      hookContent = ctx.content as string;
    });
    try {
      const app = createApp(makeDeps({ _tmpDir: tmpDir, hookDispatcher }));
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "User msg" });
      // Content should contain both user block and AI content
      assertMatch(hookContent!, /<user_message>\nUser msg\n<\/user_message>/);
      assertMatch(hookContent!, /AI reply/);
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("no chapter file created on ventoError", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-nofile-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");
    try {
      const storyDir = join(tmpDir, "s1", "n1");
      await Deno.mkdir(storyDir, { recursive: true });
      const app = createApp(makeDeps({
        _tmpDir: tmpDir,
        buildPromptFromStory: async () => ({
          prompt: "",
          ventoError: { stage: "prompt-assembly", message: "template error" },
          chapterFiles: [],
          chapters: [],
        }),
      }));
      const res = await makeRequest(app, "POST", "/api/stories/s1/n1/chat", { message: "Hello" });
      assertEquals(res.status, 422);

      // Verify no .md files were created
      const entries = [];
      for await (const entry of Deno.readDir(storyDir)) {
        entries.push(entry.name);
      }
      const mdFiles = entries.filter((f) => /^\d+\.md$/.test(f));
      assertEquals(mdFiles.length, 0);
    } finally {
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
} });
