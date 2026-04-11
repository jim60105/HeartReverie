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

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../app.ts";
import { createSafePath, verifyPassphrase } from "../lib/middleware.ts";
import { HookDispatcher } from "../lib/hooks.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps, AppConfig, BuildPromptResult } from "../types.ts";
import type { PluginManager } from "../lib/plugin-manager.ts";

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
  await Deno.mkdir(join(tmpDir, ".hidden"), { recursive: true });

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
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
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
    });

    await t.step("GET /api/stories/:series lists subdirectories", async () => {
      const res = await makeRequest(app, "GET", "/api/stories/scifi");
      assertEquals(res.status, 200);
      assert(Array.isArray(res.body));
      assert(res.body.includes("story1"));
    });

    await t.step("GET /api/stories/:series returns 404 for nonexistent series", async () => {
      const res = await makeRequest(app, "GET", "/api/stories/nonexistent");
      assertEquals(res.status, 404);
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
} });
