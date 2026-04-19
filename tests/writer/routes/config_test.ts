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
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type { Hono } from "@hono/hono";
import type { AppConfig, AppDeps, BuildPromptResult } from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

function createTestApp(backgroundImage: string): Hono {
  return createApp({
    config: {
      BACKGROUND_IMAGE: backgroundImage,
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: "/nonexistent-playground",
      ROOT_DIR: "/nonexistent-root",
    } as unknown as AppConfig,
    safePath: createSafePath("/nonexistent-playground"),
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
}

Deno.test({
  name: "config route scenario: WHEN requesting public config THEN background image is returned without auth",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const app = createTestApp("/assets/test-bg.webp");
    const res = await app.fetch(new Request("http://localhost/api/config"));
    const body = await res.json();

    assertEquals(res.status, 200);
    assertEquals(body, { backgroundImage: "/assets/test-bg.webp" });
  },
});

Deno.test({
  name: "config route scenario: WHEN auth header is present or absent THEN response remains identical",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const app = createTestApp("/assets/another.webp");
    const withoutAuth = await app.fetch(new Request("http://localhost/api/config"));
    const withAuth = await app.fetch(
      new Request("http://localhost/api/config", { headers: { "x-passphrase": "unused" } }),
    );

    assertEquals(withoutAuth.status, 200);
    assertEquals(withAuth.status, 200);
    assertEquals(await withoutAuth.json(), await withAuth.json());
  },
});
