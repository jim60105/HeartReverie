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
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type { Hono } from "@hono/hono";
import type { AppConfig, AppDeps, BuildPromptResult } from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

async function makeRequest(
  app: Hono,
  method: string,
  urlPath: string,
  body?: unknown,
  headers?: Record<string, string>,
) {
  const init: RequestInit = {
    method,
    headers: { "x-passphrase": "test-pass", ...headers },
  };
  if (body !== undefined) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${urlPath}`, init));
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed };
}

function createTestApp(tmpDir: string): Hono {
  const safePath = createSafePath(tmpDir);
  return createApp({
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
    buildContinuePromptFromStory: (async () => ({ messages: [], ventoError: null, targetChapterNumber: 0, existingContent: "", userMessageText: "", assistantPrefill: "" })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
    verifyPassphrase,
  } as AppDeps);
}

Deno.test({ name: "story-config routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "story-config-routes-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  const storyDir = join(tmpDir, "series1", "story1");
  await Deno.mkdir(storyDir, { recursive: true });

  const app = createTestApp(tmpDir);

  try {
    await t.step("GET without auth → 401", async () => {
      const res = await makeRequest(app, "GET", "/api/series1/story1/config", undefined, { "x-passphrase": "" });
      assertEquals(res.status, 401);
    });

    await t.step("GET returns {} when no _config.json", async () => {
      const res = await makeRequest(app, "GET", "/api/series1/story1/config");
      assertEquals(res.status, 200);
      assertEquals(res.body, {});
    });

    await t.step("PUT persists valid overrides → 200", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {
        temperature: 0.9,
        topK: 5,
      });
      assertEquals(res.status, 200);
      assertEquals(res.body, { temperature: 0.9, topK: 5 });

      const get = await makeRequest(app, "GET", "/api/series1/story1/config");
      assertEquals(get.body, { temperature: 0.9, topK: 5 });
    });

    await t.step("PUT with empty object clears overrides → 200", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {});
      assertEquals(res.status, 200);
      assertEquals(res.body, {});
    });

    await t.step("PUT strips unknown keys and nulls", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {
        temperature: 0.5,
        foo: "bar",
        model: null,
      });
      assertEquals(res.status, 200);
      assertEquals(res.body, { temperature: 0.5 });
    });

    await t.step("PUT rejects invalid type → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {
        temperature: "hot",
      });
      assertEquals(res.status, 400);
    });

    await t.step("PUT rejects empty model → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {
        model: "",
      });
      assertEquals(res.status, 400);
    });

    await t.step("PUT returns 404 when story directory missing", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/ghost-story/config", { temperature: 0.5 });
      assertEquals(res.status, 404);
    });

    await t.step("WHEN story path exists as file THEN GET returns 404 story not found", async () => {
      const filePath = join(tmpDir, "series1", "not-a-dir");
      await Deno.writeTextFile(filePath, "x");
      const res = await makeRequest(app, "GET", "/api/series1/not-a-dir/config");
      assertEquals(res.status, 404);
    });

    await t.step("WHEN story path exists as file THEN PUT returns 404 story not found", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/not-a-dir/config", { temperature: 0.3 });
      assertEquals(res.status, 404);
    });

    await t.step("GET returns 404 when story directory missing", async () => {
      const res = await makeRequest(app, "GET", "/api/series1/ghost-story/config");
      assertEquals(res.status, 404);
    });

    await t.step("WHEN PUT body is invalid JSON THEN returns 400 with bad request problem", async () => {
      const res = await makeRequest(
        app,
        "PUT",
        "/api/series1/story1/config",
        "{invalid-json",
        { "Content-Type": "application/json" },
      );
      assertEquals(res.status, 400);
      assertEquals(res.body?.title, "Bad Request");
      assertEquals(res.body?.detail, "Invalid JSON body");
    });

    await t.step("PUT rejects path traversal → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/..%2fescape/name/config", { temperature: 0.5 });
      // validateParams rejects `..` in the decoded param
      assertEquals(res.status === 400 || res.status === 404, true);
    });

    await t.step("underscore-prefixed series is rejected by validateParams → 400", async () => {
      const res = await makeRequest(app, "GET", "/api/_lore/story/config");
      assertEquals(res.status, 400);
    });

    // ── Error-path coverage ──

    await t.step("WHEN _config.json contains malformed JSON THEN GET returns 422 validation error", async () => {
      await Deno.writeTextFile(join(storyDir, "_config.json"), "{ not-valid-json");
      try {
        const res = await makeRequest(app, "GET", "/api/series1/story1/config");
        assertEquals(res.status, 422);
        assertEquals(res.body?.title, "Unprocessable Entity");
      } finally {
        await Deno.remove(join(storyDir, "_config.json"));
      }
    });

    await t.step("WHEN Deno.stat throws non-NotFound on GET THEN returns 500 internal error", async () => {
      const statStub = stub(Deno, "stat", () => {
        throw new Error("stat failed unexpectedly");
      });
      try {
        const res = await makeRequest(app, "GET", "/api/series1/story1/config");
        assertEquals(res.status, 500);
        assertEquals(res.body?.detail, "Failed to stat story directory");
      } finally {
        statStub.restore();
      }
    });

    await t.step("WHEN Deno.stat throws non-NotFound on PUT THEN returns 500 internal error", async () => {
      const statStub = stub(Deno, "stat", () => {
        throw new Error("stat failed unexpectedly");
      });
      try {
        const res = await makeRequest(app, "PUT", "/api/series1/story1/config", { temperature: 0.5 });
        assertEquals(res.status, 500);
        assertEquals(res.body?.detail, "Failed to stat story directory");
      } finally {
        statStub.restore();
      }
    });

    await t.step("WHEN writeStoryLlmConfig throws generic error THEN PUT returns 500 internal error", async () => {
      const writeStub = stub(Deno, "writeTextFile", () => {
        throw new Error("write failed");
      });
      try {
        const res = await makeRequest(app, "PUT", "/api/series1/story1/config", { temperature: 0.7 });
        assertEquals(res.status, 500);
        assertEquals(res.body?.detail, "Failed to write story config");
      } finally {
        writeStub.restore();
      }
    });

    await t.step("WHEN readStoryLlmConfig throws generic error THEN GET returns 500 internal error", async () => {
      await Deno.writeTextFile(join(storyDir, "_config.json"), "{}");
      const readStub = stub(Deno, "readTextFile", () => {
        throw new Error("read failed");
      });
      try {
        const res = await makeRequest(app, "GET", "/api/series1/story1/config");
        assertEquals(res.status, 500);
        assertEquals(res.body?.detail, "Failed to read story config");
      } finally {
        readStub.restore();
        await Deno.remove(join(storyDir, "_config.json")).catch(() => {});
      }
    });
    await t.step("PUT persists reasoning overrides → 200", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {
        reasoningEnabled: false,
        reasoningEffort: "low",
      });
      assertEquals(res.status, 200);
      assertEquals(res.body, { reasoningEnabled: false, reasoningEffort: "low" });

      const get = await makeRequest(app, "GET", "/api/series1/story1/config");
      assertEquals(get.body, { reasoningEnabled: false, reasoningEffort: "low" });
      // Real boolean preserved (not stringified)
      assertEquals(typeof get.body.reasoningEnabled, "boolean");
    });

    await t.step("PUT rejects non-boolean reasoningEnabled → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {
        reasoningEnabled: "yes",
      });
      assertEquals(res.status, 400);
      assertEquals(typeof res.body?.detail === "string" &&
        res.body.detail.includes("reasoningEnabled"), true);
    });

    await t.step("PUT rejects unknown reasoningEffort → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {
        reasoningEffort: "extreme",
      });
      assertEquals(res.status, 400);
      assertEquals(typeof res.body?.detail === "string" &&
        res.body.detail.includes("reasoningEffort"), true);
    });

    await t.step("PUT rejects mixed-case reasoningEffort → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {
        reasoningEffort: "HIGH",
      });
      assertEquals(res.status, 400);
    });

    await t.step("PUT clears reasoning overrides via empty body", async () => {
      const res = await makeRequest(app, "PUT", "/api/series1/story1/config", {});
      assertEquals(res.status, 200);
      assertEquals(res.body, {});
    });

  } finally {
    Deno.env.delete("PASSPHRASE");
    await Deno.remove(tmpDir, { recursive: true });
  }
} });
