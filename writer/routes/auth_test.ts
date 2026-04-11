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
import { createApp } from "../app.ts";
import { verifyPassphrase } from "../lib/middleware.ts";
import { HookDispatcher } from "../lib/hooks.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps, AppConfig } from "../types.ts";
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

Deno.test({ name: "GET /api/auth/verify", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  Deno.env.set("PASSPHRASE", "test-pass");

  const app = createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: "/nonexistent-playground",
      ROOT_DIR: "/nonexistent-root",
    } as unknown as AppConfig,
    safePath: () => null,
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [],
      getPluginDir: () => null,
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}) as unknown as import("../types.ts").BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

  await t.step("returns { ok: true }", async () => {
    const res = await makeRequest(app, "GET", "/api/auth/verify");
    assertEquals(res.status, 200);
    assertEquals(res.body, { ok: true });
  });
} });
