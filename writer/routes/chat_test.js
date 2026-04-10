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
