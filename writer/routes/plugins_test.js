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
import { createApp } from "../app.js";
import { verifyPassphrase } from "../lib/middleware.js";
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

Deno.test({ name: "plugin routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  Deno.env.set("PASSPHRASE", "test-pass");

  const testPlugins = [
    {
      name: "test-plugin",
      version: "1.0.0",
      description: "A test plugin",
      type: "utility",
      tags: ["test"],
    },
  ];

  const app = createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: "/nonexistent-playground",
      ROOT_DIR: "/nonexistent-root",
    },
    safePath: () => null,
    pluginManager: {
      getPlugins: () => testPlugins,
      getParameters: () => [
        {
          name: "scenario",
          type: "string",
          description: "Scenario content",
          source: "core",
        },
      ],
      getPluginDir: () => null,
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    },
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}),
    verifyPassphrase,
  });

  await t.step("GET /api/plugins returns plugin list", async () => {
    const res = await makeRequest(app, "GET", "/api/plugins");
    assertEquals(res.status, 200);
    assert(Array.isArray(res.body));
    assertEquals(res.body.length, 1);
    assertEquals(res.body[0].name, "test-plugin");
    assertEquals(res.body[0].hasFrontendModule, false);
  });

  await t.step("GET /api/plugins/parameters returns parameters", async () => {
    const res = await makeRequest(app, "GET", "/api/plugins/parameters");
    assertEquals(res.status, 200);
    assert(Array.isArray(res.body));
    assert(res.body.some((p) => p.name === "scenario"));
  });
} });
