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

  const app = createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: tmpDir,
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
      prompt: "rendered system prompt",
      previousContext: [{ content: "ch1" }],
      statusContent: "status: ok",
      isFirstRound: false,
      ventoError: null,
    }) as unknown as BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

  try {
    await t.step("GET /api/template returns template content", async () => {
      const res = await makeRequest(app, "GET", "/api/template");
      assertEquals(res.status, 200);
      assertEquals(res.body.content, "You are a storyteller.");
    });

    await t.step("GET /api/template returns 500 when template missing", async () => {
      const appNoTemplate = createApp({
        config: {
          READER_DIR: "/nonexistent-reader",
          PLAYGROUND_DIR: tmpDir,
          ROOT_DIR: "/nonexistent-root",
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

    await t.step("POST preview-prompt returns rendered prompt", async () => {
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const res = await makeRequest(
        app,
        "POST",
        "/api/stories/s1/n1/preview-prompt",
        { message: "Hello world" },
      );
      assertEquals(res.status, 200);
      assertEquals(res.body.prompt, "rendered system prompt");
      assert(Array.isArray(res.body.fragments));
      assert(res.body.fragments.includes("testVar"));
      assertEquals(res.body.variables.isFirstRound, false);
      assertEquals(res.body.variables.previous_context, "1 chapters");
      assertEquals(res.body.errors.length, 0);
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
          prompt: null,
          previousContext: [],
          statusContent: null,
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
