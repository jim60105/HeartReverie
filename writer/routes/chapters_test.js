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

import { assertEquals } from "@std/assert";
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

Deno.test({ name: "chapter routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "chapters-test-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  // Create test story with chapters
  const storyDir = join(tmpDir, "series1", "story1");
  await Deno.mkdir(storyDir, { recursive: true });
  await Deno.writeTextFile(join(storyDir, "001.md"), "Chapter 1 content");
  await Deno.writeTextFile(join(storyDir, "002.md"), "Chapter 2 content");

  const safePath = createSafePath(tmpDir);
  const app = createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: "/nonexistent-root",
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
    buildPromptFromStory: async () => ({}),
    verifyPassphrase,
  });

  try {
    await t.step("GET /api/stories/:series/:name/chapters lists chapters", async () => {
      const res = await makeRequest(
        app,
        "GET",
        "/api/stories/series1/story1/chapters",
      );
      assertEquals(res.status, 200);
      assertEquals(res.body, [1, 2]);
    });

    await t.step("GET /api/stories/:series/:name/chapters/:number reads a chapter", async () => {
      const res = await makeRequest(
        app,
        "GET",
        "/api/stories/series1/story1/chapters/1",
      );
      assertEquals(res.status, 200);
      assertEquals(res.body.number, 1);
      assertEquals(res.body.content, "Chapter 1 content");
    });

    await t.step("GET /api/stories/:series/:name/chapters/:number returns 404 for nonexistent", async () => {
      const res = await makeRequest(
        app,
        "GET",
        "/api/stories/series1/story1/chapters/99",
      );
      assertEquals(res.status, 404);
    });

    await t.step("DELETE /api/stories/:series/:name/chapters/last deletes last chapter", async () => {
      const res = await makeRequest(
        app,
        "DELETE",
        "/api/stories/series1/story1/chapters/last",
      );
      assertEquals(res.status, 200);
      assertEquals(res.body.deleted, 2);

      // Verify chapter 2 was actually deleted
      const listRes = await makeRequest(
        app,
        "GET",
        "/api/stories/series1/story1/chapters",
      );
      assertEquals(listRes.body, [1]);
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
} });
