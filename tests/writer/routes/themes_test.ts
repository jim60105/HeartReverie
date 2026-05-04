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
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { loadThemes } from "../../../writer/lib/themes.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type { Hono } from "@hono/hono";
import type { AppConfig, AppDeps, BuildPromptResult } from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

async function createTestApp(): Promise<Hono> {
  const tmpDir = await Deno.makeTempDir();
  const defaultToml = `
id = "default"
label = "Default Theme"
colorScheme = "dark"
backgroundImage = "/assets/heart.webp"

[palette]
panel-bg = "#123"
text-main = "rgba(0,0,0,1)"
`;
  const lightToml = `
id = "light"
label = "Light Theme"
colorScheme = "light"

[palette]
panel-bg = "#fff"
text-main = "#333"
`;
  await Deno.writeTextFile(`${tmpDir}/default.toml`, defaultToml);
  await Deno.writeTextFile(`${tmpDir}/light.toml`, lightToml);
  await loadThemes(tmpDir);

  return createApp({
    config: {
      THEME_DIR: tmpDir,
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
    buildContinuePromptFromStory: (async () => ({ messages: [], ventoError: null, targetChapterNumber: 0, existingContent: "", userMessageText: "", assistantPrefill: "" })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
    verifyPassphrase,
  } as AppDeps);
}

Deno.test({
  name: "themes route: GET /api/themes returns list without auth",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const app = await createTestApp();
    const res = await app.fetch(new Request("http://localhost/api/themes"));
    assertEquals(res.status, 200);
    const body = await res.json();
    assert(Array.isArray(body));
    assertEquals(body.length, 2);
    assertEquals(body[0].id, "default");
    assertEquals(body[1].id, "light");
  },
});

Deno.test({
  name: "themes route: GET /api/themes/:id returns full payload with -- prefixed keys",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const app = await createTestApp();
    const res = await app.fetch(new Request("http://localhost/api/themes/default"));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.id, "default");
    assertEquals(body.label, "Default Theme");
    assertEquals(body.colorScheme, "dark");
    assertEquals(body.backgroundImage, "/assets/heart.webp");
    assertEquals(body.palette["--panel-bg"], "#123");
    assertEquals(body.palette["--text-main"], "rgba(0,0,0,1)");
  },
});

Deno.test({
  name: "themes route: GET /api/themes/:id returns 404 for unknown id",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const app = await createTestApp();
    const res = await app.fetch(new Request("http://localhost/api/themes/no-such-theme"));
    assertEquals(res.status, 404);
    const body = await res.json();
    assertEquals(body.status, 404);
    assertEquals(body.title, "Not Found");
  },
});

Deno.test({
  name: "themes route: GET /api/themes is accessible without X-Passphrase",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const app = await createTestApp();
    // No X-Passphrase header
    const res = await app.fetch(new Request("http://localhost/api/themes"));
    assertEquals(res.status, 200);
  },
});

Deno.test({
  name: "themes route: GET /api/themes/:id is accessible without X-Passphrase",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const app = await createTestApp();
    const res = await app.fetch(new Request("http://localhost/api/themes/light"));
    assertEquals(res.status, 200);
  },
});
