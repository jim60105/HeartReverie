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
  headers?: Record<string, string>,
) {
  const init: RequestInit = {
    method,
    headers: { "x-passphrase": "test-pass", ...headers },
  };
  const res = await app.fetch(new Request(`http://localhost${urlPath}`, init));
  return { status: res.status, headers: Object.fromEntries(res.headers), res };
}

Deno.test({ name: "SPA fallback", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "spa-test-" });
  const readerDir = join(tmpDir, "reader");
  const playgroundDir = join(tmpDir, "playground");

  Deno.env.set("PASSPHRASE", "test-pass");

  await Deno.mkdir(readerDir, { recursive: true });
  await Deno.mkdir(playgroundDir, { recursive: true });
  await Deno.writeTextFile(join(readerDir, "index.html"), "<!doctype html><html><body>SPA</body></html>");

  const safePath = createSafePath(playgroundDir);
  const app = createApp({
    config: {
      READER_DIR: readerDir,
      PLAYGROUND_DIR: playgroundDir,
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
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

  try {
    await t.step("GET /unknown/path returns index.html (SPA fallback)", async () => {
      const { status, res } = await makeRequest(app, "GET", "/my-series/my-story/chapter/3");
      assertEquals(status, 200);
      const text = await res.text();
      assert(text.includes("SPA"), "Response should contain index.html content");
    });

    await t.step("GET /api/stories is NOT affected by SPA fallback", async () => {
      const { status } = await makeRequest(app, "GET", "/api/stories");
      // Should return actual API response, not index.html
      assertEquals(status, 200);
    });

    await t.step("GET / serves index.html from static files", async () => {
      const { status, res } = await makeRequest(app, "GET", "/index.html");
      assertEquals(status, 200);
      const text = await res.text();
      assert(text.includes("SPA"));
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
} });
