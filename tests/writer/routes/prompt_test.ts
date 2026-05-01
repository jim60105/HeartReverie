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

import { assertEquals, assert } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
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

Deno.test({ name: "prompt routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "prompt-test-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  const safePath = createSafePath(tmpDir);

  // Write a system.md template for GET /api/template
  await Deno.writeTextFile(join(tmpDir, "system.md"), "You are a storyteller.");

  const promptFile = join(tmpDir, "_prompts", "custom.md");

  const app = createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: tmpDir,
      PROMPT_FILE: promptFile,
    } as unknown as AppConfig,
    safePath,
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [],
      getPluginDir: () => null,
        getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: async () => ({ variables: { testVar: "val" }, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async (_series, _name, _dir, _msg, _tpl) => ({
      messages: [
        { role: "system" as const, content: "rendered system prompt" },
        { role: "user" as const, content: "Hello world" },
      ],
      previousContext: [{ content: "ch1" }],
      isFirstRound: false,
      ventoError: null,
    }) as unknown as BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

  try {
    await t.step("GET /api/template falls back to system.md with source default", async () => {
      const res = await makeRequest(app, "GET", "/api/template");
      assertEquals(res.status, 200);
      assertEquals(res.body.content, "You are a storyteller.");
      assertEquals(res.body.source, "default");
    });

    await t.step("GET /api/template returns custom file with source custom", async () => {
      await Deno.mkdir(join(tmpDir, "_prompts"), { recursive: true });
      await Deno.writeTextFile(promptFile, "Custom template content");
      try {
        const res = await makeRequest(app, "GET", "/api/template");
        assertEquals(res.status, 200);
        assertEquals(res.body.content, "Custom template content");
        assertEquals(res.body.source, "custom");
      } finally {
        await Deno.remove(promptFile);
      }
    });

    await t.step("GET /api/template returns 500 when template missing", async () => {
      const appNoTemplate = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: "/nonexistent-root",
          PROMPT_FILE: "/nonexistent-prompt",
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
        buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
        verifyPassphrase,
      } as AppDeps);
      const res = await makeRequest(appNoTemplate, "GET", "/api/template");
      assertEquals(res.status, 500);
      assertEquals(res.body.detail, "Failed to read template");
    });

    await t.step("PUT /api/template writes file and returns ok", async () => {
      const putFile = join(tmpDir, "put-test", "system.md");
      const appPut = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: tmpDir,
          PROMPT_FILE: putFile,
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
        buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
        verifyPassphrase,
      } as AppDeps);

      const res = await makeRequest(appPut, "PUT", "/api/template", { content: "Hello {{ user_input }}" });
      assertEquals(res.status, 200);
      assertEquals(res.body.ok, true);
      const written = await Deno.readTextFile(putFile);
      assertEquals(written, "Hello {{ user_input }}");
    });

    await t.step("PUT /api/template rejects unsafe template with 422", async () => {
      const res = await makeRequest(app, "PUT", "/api/template", { content: "{{ process.env.SECRET }}" });
      assertEquals(res.status, 422);
      assert(Array.isArray(res.body.expressions));
      assert(res.body.expressions.length > 0);
    });

    await t.step("PUT /api/template rejects empty content with 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/template", { content: "" });
      assertEquals(res.status, 400);
    });

    await t.step("PUT /api/template rejects oversized content with 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/template", { content: "x".repeat(500_001) });
      assertEquals(res.status, 400);
      assertEquals(res.body.detail, "Template exceeds maximum length");
    });

    await t.step("PUT /api/template creates parent directories", async () => {
      const nestedFile = join(tmpDir, "deep", "nested", "dir", "system.md");
      const appNested = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: tmpDir,
          PROMPT_FILE: nestedFile,
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
        buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
        verifyPassphrase,
      } as AppDeps);

      const res = await makeRequest(appNested, "PUT", "/api/template", { content: "nested template" });
      assertEquals(res.status, 200);
      assertEquals(res.body.ok, true);
      const written = await Deno.readTextFile(nestedFile);
      assertEquals(written, "nested template");
    });

    await t.step("DELETE /api/template removes file and returns ok", async () => {
      const delFile = join(tmpDir, "del-test", "system.md");
      await Deno.mkdir(join(tmpDir, "del-test"), { recursive: true });
      await Deno.writeTextFile(delFile, "to be deleted");
      const appDel = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: tmpDir,
          PROMPT_FILE: delFile,
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
        buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
        verifyPassphrase,
      } as AppDeps);

      const res = await makeRequest(appDel, "DELETE", "/api/template");
      assertEquals(res.status, 200);
      assertEquals(res.body.ok, true);
      let exists = true;
      try { await Deno.stat(delFile); } catch { exists = false; }
      assertEquals(exists, false);
    });

    await t.step("DELETE /api/template is idempotent when file missing", async () => {
      const missingFile = join(tmpDir, "no-such-file.md");
      const appMissing = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: tmpDir,
          PROMPT_FILE: missingFile,
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
        buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
        verifyPassphrase,
      } as AppDeps);

      const res = await makeRequest(appMissing, "DELETE", "/api/template");
      assertEquals(res.status, 200);
      assertEquals(res.body.ok, true);
    });

    await t.step("DELETE /api/template returns 500 on non-NotFound errors", async () => {
      const removeStub = stub(Deno, "remove", () => {
        throw new Error("permission denied");
      });
      try {
        const res = await makeRequest(app, "DELETE", "/api/template");
        assertEquals(res.status, 500);
        assertEquals(res.body.detail, "Failed to delete template");
      } finally {
        removeStub.restore();
      }
    });

    await t.step("POST preview-prompt returns rendered prompt", async () => {
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/s1/n1/preview-prompt",
        { message: "Hello world" },
      );
      assertEquals(res.status, 200);
      assertEquals(res.body.messages, [
        { role: "system", content: "rendered system prompt" },
        { role: "user", content: "Hello world" },
      ]);
      assert(Array.isArray(res.body.fragments));
      assert(res.body.fragments.includes("testVar"));
      assertEquals(res.body.variables.isFirstRound, false);
      assertEquals(res.body.variables.previous_context, "1 chapters");
      assertEquals(res.body.errors.length, 0);
    });

    await t.step("POST preview-prompt prefers request template override", async () => {
      let capturedTemplate: string | undefined;
      const appCapture = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: tmpDir,
          PROMPT_FILE: promptFile,
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
        buildPromptFromStory: async (_series, _name, _storyDir, _message, templateOverride) => {
          capturedTemplate = templateOverride;
          return {
            messages: [{ role: "user" as const, content: "rendered" }],
            previousContext: [],
            isFirstRound: true,
            ventoError: null,
          } as unknown as BuildPromptResult;
        },
        verifyPassphrase,
      } as AppDeps);

      await Deno.mkdir(join(tmpDir, "s2", "n2"), { recursive: true });
      const res = await makeRequest(
        appCapture,
        "POST",
        "/api/stories/s2/n2/preview-prompt",
        { message: "test", template: "custom override" },
      );
      assertEquals(res.status, 200);
      assertEquals(capturedTemplate, "custom override");
    });

    await t.step("POST preview-prompt returns 400 for empty message", async () => {
      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/s1/n1/preview-prompt",
        { message: "" },
      );
      assertEquals(res.status, 400);
      assertEquals(res.body.detail, "Message required");
    });

    await t.step("POST preview-prompt returns 400 for missing message", async () => {
      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/s1/n1/preview-prompt",
        {},
      );
      assertEquals(res.status, 400);
    });

    await t.step("POST preview-prompt returns 422 on vento error", async () => {
      const appVento = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: tmpDir,
          PROMPT_FILE: promptFile,
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
          messages: [],
          previousContext: [],
          isFirstRound: true,
          ventoError: { stage: "prompt-assembly", message: "undefined var" },
        }) as unknown as BuildPromptResult,
        verifyPassphrase,
      } as AppDeps);
      const res = await makeRequest(
        appVento,
        "POST",
        "/api/stories/s1/n1/preview-prompt",
        { message: "test" },
      );
      assertEquals(res.status, 422);
      assertEquals(res.body.type, "vento-error");
    });

    await t.step("POST preview-prompt returns 500 when buildPromptFromStory throws", async () => {
      const appThrow = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: tmpDir,
          PROMPT_FILE: promptFile,
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
        buildPromptFromStory: async () => {
          throw new Error("boom");
        },
        verifyPassphrase,
      } as AppDeps);

      const res = await makeRequest(
        appThrow,
        "POST",
        "/api/stories/s1/n1/preview-prompt",
        { message: "test" },
      );
      assertEquals(res.status, 500);
      assertEquals(res.body.detail, "Failed to preview prompt");
    });

    await t.step("POST preview-prompt returns 400 for path traversal", async () => {
      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/te..st/n1/preview-prompt",
        { message: "test" },
      );
      assertEquals(res.status, 400);
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
} });
