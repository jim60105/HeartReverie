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
import { verifyPassphrase } from "../../../writer/lib/middleware.ts";
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
    } as unknown as AppConfig,
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
      getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
        getPluginStyles: () => [],
        getPluginActionButtons: () => [],
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

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

Deno.test({ name: "plugin frontend module routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  Deno.env.set("PASSPHRASE", "test-pass");

  const tmpDir = await Deno.makeTempDir();
  const pluginDir = join(tmpDir, "my-plugin");
  await Deno.mkdir(pluginDir, { recursive: true });
  await Deno.writeTextFile(join(pluginDir, "ui.js"), "console.log('hello');");

  await t.step("hasFrontendModule is true when frontendModule is set", async () => {
    const app = createApp({
      config: {
        READER_DIR: "/nonexistent-reader",
        PLAYGROUND_DIR: "/nonexistent-playground",
        ROOT_DIR: "/nonexistent-root",
      } as unknown as AppConfig,
      safePath: () => null,
      pluginManager: {
        getPlugins: () => [
          {
            name: "my-plugin",
            version: "1.0.0",
            description: "Plugin with frontend",
            type: "utility",
            frontendModule: "ui.js",
          },
        ],
        getPluginDir: (name: string) => name === "my-plugin" ? pluginDir : null,
        getBuiltinDir: () => "/nonexistent-plugins",
        getParameters: () => [],
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
        getPluginStyles: () => [],
        getPluginActionButtons: () => [],
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      verifyPassphrase,
    } as AppDeps);

    const res = await makeRequest(app, "GET", "/api/plugins");
    assertEquals(res.status, 200);
    assertEquals(res.body[0].hasFrontendModule, true);
  });

  await t.step("GET /plugins/:name/:path serves frontend module", async () => {
    const app = createApp({
      config: {
        READER_DIR: "/nonexistent-reader",
        PLAYGROUND_DIR: "/nonexistent-playground",
        ROOT_DIR: "/nonexistent-root",
      } as unknown as AppConfig,
      safePath: () => null,
      pluginManager: {
        getPlugins: () => [
          {
            name: "my-plugin",
            version: "1.0.0",
            description: "Plugin with frontend",
            type: "utility",
            frontendModule: "ui.js",
          },
        ],
        getPluginDir: (name: string) => name === "my-plugin" ? pluginDir : null,
        getBuiltinDir: () => "/nonexistent-plugins",
        getParameters: () => [],
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
        getPluginStyles: () => [],
        getPluginActionButtons: () => [],
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      verifyPassphrase,
    } as AppDeps);

    const res = await app.fetch(
      new Request("http://localhost/plugins/my-plugin/ui.js", {
        headers: { "x-passphrase": "test-pass" },
      })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/javascript");
    const text = await res.text();
    assertEquals(text, "console.log('hello');");
  });

  await t.step("GET /plugins/:name/:path returns 404 when file missing", async () => {
    const missingDir = join(tmpDir, "missing-plugin");
    await Deno.mkdir(missingDir, { recursive: true });

    const app = createApp({
      config: {
        READER_DIR: "/nonexistent-reader",
        PLAYGROUND_DIR: "/nonexistent-playground",
        ROOT_DIR: "/nonexistent-root",
      } as unknown as AppConfig,
      safePath: () => null,
      pluginManager: {
        getPlugins: () => [
          {
            name: "missing-plugin",
            version: "1.0.0",
            description: "Plugin with missing file",
            type: "utility",
            frontendModule: "nonexistent.js",
          },
        ],
        getPluginDir: (name: string) => name === "missing-plugin" ? missingDir : null,
        getBuiltinDir: () => "/nonexistent-plugins",
        getParameters: () => [],
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
        getPluginStyles: () => [],
        getPluginActionButtons: () => [],
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      verifyPassphrase,
    } as AppDeps);

    const res = await makeRequest(app, "GET", "/plugins/missing-plugin/nonexistent.js");
    assertEquals(res.status, 404);
  });

  await t.step("frontendModule path escape is skipped", async () => {
    const escapedDir = join(tmpDir, "escape-plugin");
    await Deno.mkdir(escapedDir, { recursive: true });

    const app = createApp({
      config: {
        READER_DIR: "/nonexistent-reader",
        PLAYGROUND_DIR: "/nonexistent-playground",
        ROOT_DIR: "/nonexistent-root",
      } as unknown as AppConfig,
      safePath: () => null,
      pluginManager: {
        getPlugins: () => [
          {
            name: "escape-plugin",
            version: "1.0.0",
            description: "Plugin with path escape",
            type: "utility",
            frontendModule: "../../escape.js",
          },
        ],
        getPluginDir: (name: string) => name === "escape-plugin" ? escapedDir : null,
        getBuiltinDir: () => "/nonexistent-plugins",
        getParameters: () => [],
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
        getPluginStyles: () => [],
        getPluginActionButtons: () => [],
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      verifyPassphrase,
    } as AppDeps);

    // The route should not be registered at all, so any request to it returns 404
    const res = await makeRequest(app, "GET", "/plugins/escape-plugin/escape.js");
    assertEquals(res.status, 404);
  });

  // Cleanup
  await Deno.remove(tmpDir, { recursive: true });
} });

Deno.test({ name: "shared plugin utils routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  Deno.env.set("PASSPHRASE", "test-pass");

  const tmpDir = await Deno.makeTempDir();
  const sharedDir = join(tmpDir, "_shared");
  await Deno.mkdir(sharedDir, { recursive: true });
  await Deno.writeTextFile(join(sharedDir, "utils.js"), "export function escapeHtml(s) { return s; }");
  await Deno.writeTextFile(join(sharedDir, "secret.env"), "SECRET=bad");

  function makeApp() {
    return createApp({
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
        getBuiltinDir: () => tmpDir,
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
        getPluginStyles: () => [],
        getPluginActionButtons: () => [],
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      verifyPassphrase,
    } as AppDeps);
  }

  await t.step("GET /plugins/_shared/utils.js serves JS file with correct content-type", async () => {
    const app = makeApp();
    const res = await app.fetch(
      new Request("http://localhost/plugins/_shared/utils.js", {
        headers: { "x-passphrase": "test-pass" },
      })
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "application/javascript");
    const text = await res.text();
    assertEquals(text, "export function escapeHtml(s) { return s; }");
  });

  await t.step("GET /plugins/_shared/secret.env returns 404 (non-JS rejected)", async () => {
    const app = makeApp();
    const res = await makeRequest(app, "GET", "/plugins/_shared/secret.env");
    assertEquals(res.status, 404);
  });

  await t.step("GET /plugins/_shared/../../.env is rejected (path traversal)", async () => {
    const app = makeApp();
    const res = await makeRequest(app, "GET", "/plugins/_shared/../../.env");
    // Hono normalizes the URL before routing, so traversal paths hit auth middleware (403) or 404
    assert(res.status === 403 || res.status === 404, `Expected 403 or 404, got ${res.status}`);
  });

  await t.step("GET /plugins/_shared/.secret.js returns 404 (dotfile rejected)", async () => {
    await Deno.writeTextFile(join(sharedDir, ".secret.js"), "// hidden");
    const app = makeApp();
    const res = await makeRequest(app, "GET", "/plugins/_shared/.secret.js");
    assertEquals(res.status, 404);
    await Deno.remove(join(sharedDir, ".secret.js"));
  });

  // Cleanup
  await Deno.remove(tmpDir, { recursive: true });
} });

Deno.test({ name: "parameters endpoint with lore discovery", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  Deno.env.set("PASSPHRASE", "test-pass");

  const tmpDir = await Deno.makeTempDir();
  const loreDir = join(tmpDir, "_lore");
  await Deno.mkdir(loreDir, { recursive: true });
  await Deno.writeTextFile(
    join(loreDir, "setting.md"),
    "---\ntags: [setting]\npriority: 10\nenabled: true\n---\nWorld setting content",
  );

  const app = createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: "/nonexistent-root",
    } as unknown as AppConfig,
    safePath: () => null,
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [
        { name: "previous_context", type: "array", description: "Previous chapters", source: "core" },
      ],
      getPluginDir: () => null,
      getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
        getPluginStyles: () => [],
        getPluginActionButtons: () => [],
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

  await t.step("without series param returns base params only", async () => {
    const res = await makeRequest(app, "GET", "/api/plugins/parameters");
    assertEquals(res.status, 200);
    assert(Array.isArray(res.body));
    assert(!res.body.some((p: Record<string, unknown>) => p.source === "lore"));
  });

  await t.step("with series param returns base + lore params", async () => {
    const res = await makeRequest(app, "GET", "/api/plugins/parameters?series=test");
    assertEquals(res.status, 200);
    assert(Array.isArray(res.body));
    assert(res.body.some((p: Record<string, unknown>) => p.name === "lore_all" && p.source === "lore"));
    assert(res.body.some((p: Record<string, unknown>) => p.name === "lore_tags" && p.source === "lore"));
    assert(res.body.some((p: Record<string, unknown>) => p.name === "lore_setting" && p.source === "lore"));
  });

  await t.step("lore_all and lore_tags present even with no passages", async () => {
    const res = await makeRequest(app, "GET", "/api/plugins/parameters?series=nonexistent");
    assertEquals(res.status, 200);
    assert(res.body.some((p: Record<string, unknown>) => p.name === "lore_all"));
    assert(res.body.some((p: Record<string, unknown>) => p.name === "lore_tags"));
  });

  // Cleanup
  await Deno.remove(tmpDir, { recursive: true });
} });

Deno.test({ name: "plugin frontendStyles routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  Deno.env.set("PASSPHRASE", "test-pass");

  const tmpDir = await Deno.makeTempDir();
  const pluginDir = join(tmpDir, "styled-plugin");
  await Deno.mkdir(pluginDir, { recursive: true });
  await Deno.writeTextFile(join(pluginDir, "style.css"), ".foo { color: red; }");
  await Deno.writeTextFile(join(pluginDir, "secret.css"), ".secret { color: black; }");

  function makeApp(frontendStyles: string[], validatedStyles: string[] = frontendStyles) {
    return createApp({
      config: {
        READER_DIR: "/nonexistent-reader",
        PLAYGROUND_DIR: "/nonexistent-playground",
        ROOT_DIR: "/nonexistent-root",
      } as unknown as AppConfig,
      safePath: () => null,
      pluginManager: {
        getPlugins: () => [
          {
            name: "styled-plugin",
            version: "1.0.0",
            description: "Plugin with styles",
            type: "utility",
            frontendStyles,
          },
        ],
        getPluginDir: (name: string) => name === "styled-plugin" ? pluginDir : null,
        getBuiltinDir: () => "/nonexistent-plugins",
        getParameters: () => [],
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
        getPluginStyles: (name: string) => name === "styled-plugin" ? [...validatedStyles] : [],
        getPluginActionButtons: () => [],
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      verifyPassphrase,
    } as AppDeps);
  }

  await t.step("GET /api/plugins includes frontendStyles URL paths", async () => {
    const app = makeApp(["style.css"]);
    const res = await makeRequest(app, "GET", "/api/plugins");
    assertEquals(res.status, 200);
    assertEquals(res.body[0].frontendStyles, ["/plugins/styled-plugin/style.css"]);
  });

  await t.step("declared CSS file is served with text/css content type", async () => {
    const app = makeApp(["style.css"]);
    const res = await app.fetch(
      new Request("http://localhost/plugins/styled-plugin/style.css", {
        headers: { "x-passphrase": "test-pass" },
      }),
    );
    assertEquals(res.status, 200);
    assertEquals(res.headers.get("content-type"), "text/css; charset=utf-8");
    const text = await res.text();
    assertEquals(text, ".foo { color: red; }");
  });

  await t.step("undeclared CSS file returns 404 even if it exists on disk", async () => {
    const app = makeApp(["style.css"], ["style.css"]);
    const res = await makeRequest(app, "GET", "/plugins/styled-plugin/secret.css");
    assertEquals(res.status, 404);
  });

  await t.step("path traversal attempt returns 404", async () => {
    const app = makeApp(["style.css"]);
    const res = await makeRequest(app, "GET", "/plugins/styled-plugin/../../etc/passwd");
    assert(res.status === 403 || res.status === 404, `Expected 403 or 404, got ${res.status}`);
  });

  await t.step("plugin with no frontendStyles yields empty array in /api/plugins", async () => {
    const app = makeApp([], []);
    const res = await makeRequest(app, "GET", "/api/plugins");
    assertEquals(res.status, 200);
    assertEquals(res.body[0].frontendStyles, []);
  });

  // Cleanup
  await Deno.remove(tmpDir, { recursive: true });
} });
