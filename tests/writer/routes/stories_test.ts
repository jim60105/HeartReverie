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

import { assert, assertEquals } from "@std/assert";
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

Deno.test({ name: "stories routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "stories-test-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  // Create test directory structure
  await Deno.mkdir(join(tmpDir, "fantasy"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "scifi", "story1"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "scifi", "_lore"), { recursive: true });
  await Deno.mkdir(join(tmpDir, ".hidden"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "_lore"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "_prompts"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "lost+found"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "$RECYCLE.BIN"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "System Volume Information"), { recursive: true });
  await Deno.mkdir(join(tmpDir, ".Spotlight-V100"), { recursive: true });
  await Deno.mkdir(join(tmpDir, ".Trashes"), { recursive: true });
  await Deno.mkdir(join(tmpDir, ".fseventsd"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "scifi", "lost+found"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "scifi", "$RECYCLE.BIN"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "scifi", "System Volume Information"), { recursive: true });
  await Deno.mkdir(join(tmpDir, "scifi", ".Trashes"), { recursive: true });

  const safePath = createSafePath(tmpDir);
  const app = createApp({
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

  try {
    await t.step("GET /api/stories lists directories", async () => {
      const res = await makeRequest(app, "GET", "/api/stories");
      assertEquals(res.status, 200);
      assert(Array.isArray(res.body));
      assert(res.body.includes("fantasy"));
      assert(res.body.includes("scifi"));
      assert(!res.body.includes(".hidden"));
      assert(!res.body.includes("_lore"));
      assert(!res.body.includes("_prompts"));
      assert(!res.body.includes("lost+found"));
      assert(!res.body.includes("$RECYCLE.BIN"));
      assert(!res.body.includes("System Volume Information"));
      assert(!res.body.includes(".Spotlight-V100"));
      assert(!res.body.includes(".Trashes"));
      assert(!res.body.includes(".fseventsd"));
    });

    await t.step("GET /api/stories/:series lists subdirectories excluding underscore-prefixed", async () => {
      const res = await makeRequest(app, "GET", "/api/stories/scifi");
      assertEquals(res.status, 200);
      assert(Array.isArray(res.body));
      assert(res.body.includes("story1"));
      assert(!res.body.includes("_lore"));
      assert(!res.body.includes("lost+found"));
      assert(!res.body.includes("$RECYCLE.BIN"));
      assert(!res.body.includes("System Volume Information"));
      assert(!res.body.includes(".Trashes"));
    });

    await t.step("GET /api/stories/:series returns 404 for nonexistent series", async () => {
      const res = await makeRequest(app, "GET", "/api/stories/nonexistent");
      assertEquals(res.status, 404);
    });

    await t.step("GET /api/stories/:series rejects reserved platform directory names", async () => {
      const res = await makeRequest(app, "GET", "/api/stories/lost%2Bfound");
      assertEquals(res.status, 400);
      assertEquals(res.body?.detail, "Invalid parameter: series");
    });

    await t.step("WHEN readDir throws on GET /api/stories THEN returns 500", async () => {
      const readDirStub = stub(Deno, "readDir", () => {
        throw new Error("disk error");
      });
      try {
        const res = await makeRequest(app, "GET", "/api/stories");
        assertEquals(res.status, 500);
        assertEquals(res.body?.detail, "Failed to list stories");
      } finally {
        readDirStub.restore();
      }
    });

    await t.step("WHEN readDir throws non-NotFound on GET /api/stories/:series THEN returns 500", async () => {
      const readDirStub = stub(Deno, "readDir", () => {
        throw new Error("disk read error");
      });
      try {
        const res = await makeRequest(app, "GET", "/api/stories/scifi");
        assertEquals(res.status, 500);
        assertEquals(res.body?.detail, "Failed to list series");
      } finally {
        readDirStub.restore();
      }
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
} });
