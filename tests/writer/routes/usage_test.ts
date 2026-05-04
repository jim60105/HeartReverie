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
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { appendUsage, buildRecord } from "../../../writer/lib/usage.ts";
import type { Hono } from "@hono/hono";
import type { AppConfig, AppDeps, BuildPromptResult } from "../../../writer/types.ts";
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

Deno.test({
  name: "usage routes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmpDir = await Deno.makeTempDir({ prefix: "usage-routes-" });
    Deno.env.set("PASSPHRASE", "test-pass");

    const storyDir = join(tmpDir, "series1", "story1");
    await Deno.mkdir(storyDir, { recursive: true });

    const app = createTestApp(tmpDir);

    try {
      await t.step("GET without passphrase → 401", async () => {
        const res = await makeRequest(app, "GET", "/api/stories/series1/story1/usage", { "x-passphrase": "" });
        assertEquals(res.status, 401);
      });

      await t.step("GET with reserved series (_lore) → 400", async () => {
        const res = await makeRequest(app, "GET", "/api/stories/_lore/story1/usage");
        assertEquals(res.status, 400);
      });

      await t.step("GET on empty story → 200 with zero totals", async () => {
        const res = await makeRequest(app, "GET", "/api/stories/series1/story1/usage");
        assertEquals(res.status, 200);
        assertEquals(res.body, {
          records: [],
          totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 },
        });
      });

      await t.step("GET on populated story → 200 with computed totals", async () => {
        await appendUsage(storyDir, buildRecord({
          chapter: 1,
          promptTokens: 100,
          completionTokens: 50,
          totalTokens: 150,
          model: "m",
        }));
        await appendUsage(storyDir, buildRecord({
          chapter: 2,
          promptTokens: 200,
          completionTokens: 80,
          totalTokens: 280,
          model: "m",
        }));

        const res = await makeRequest(app, "GET", "/api/stories/series1/story1/usage");
        assertEquals(res.status, 200);
        const body = res.body as { records: unknown[]; totals: Record<string, number> };
        assertEquals(body.records.length, 2);
        assertEquals(body.totals, {
          promptTokens: 300,
          completionTokens: 130,
          totalTokens: 430,
          count: 2,
        });
      });
    } finally {
      Deno.env.delete("PASSPHRASE");
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});
