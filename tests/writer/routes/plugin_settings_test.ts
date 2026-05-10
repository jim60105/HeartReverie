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
import { Hono } from "@hono/hono";
import { registerPluginSettingsRoutes } from "../../../writer/routes/plugin-settings.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

interface PluginManagerStubOptions {
  hasSettingsSchema?: (name: string) => boolean;
  getPluginSettings?: (name: string) => Promise<Record<string, unknown>>;
  getPluginSettingsSchema?: (name: string) => Record<string, unknown> | null;
  savePluginSettings?: (name: string, settings: Record<string, unknown>) => Promise<void>;
}

function createApp(opts: PluginManagerStubOptions = {}): Hono {
  const stub = {
    hasSettingsSchema: opts.hasSettingsSchema ?? (() => false),
    getPluginSettings: opts.getPluginSettings ?? (async () => ({})),
    getPluginSettingsSchema: opts.getPluginSettingsSchema ?? (() => null),
    savePluginSettings: opts.savePluginSettings ?? (async () => {}),
  } as unknown as PluginManager;
  const app = new Hono();
  registerPluginSettingsRoutes(app, { pluginManager: stub });
  return app;
}

Deno.test("plugin-settings: GET /api/plugins/:name/settings returns 404 when no schema", async () => {
  const app = createApp({ hasSettingsSchema: () => false });
  const res = await app.fetch(new Request("http://localhost/api/plugins/foo/settings"));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.title, "Not Found");
  assertEquals(body.detail, "Plugin has no settings");
});

Deno.test("plugin-settings: GET /api/plugins/:name/settings returns settings JSON", async () => {
  const app = createApp({
    hasSettingsSchema: (n) => n === "foo",
    getPluginSettings: async (n) => ({ enabled: true, name: n }),
  });
  const res = await app.fetch(new Request("http://localhost/api/plugins/foo/settings"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { enabled: true, name: "foo" });
});

Deno.test("plugin-settings: GET /api/plugins/:name/settings-schema returns 404 when missing", async () => {
  const app = createApp({ getPluginSettingsSchema: () => null });
  const res = await app.fetch(new Request("http://localhost/api/plugins/foo/settings-schema"));
  assertEquals(res.status, 404);
  const body = await res.json();
  assertEquals(body.title, "Not Found");
  assertEquals(body.detail, "Plugin has no settings schema");
});

Deno.test("plugin-settings: GET /api/plugins/:name/settings-schema returns schema JSON", async () => {
  const schema = { fields: [{ key: "enabled", type: "boolean" }] };
  const app = createApp({ getPluginSettingsSchema: () => schema });
  const res = await app.fetch(new Request("http://localhost/api/plugins/foo/settings-schema"));
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, schema);
});

Deno.test("plugin-settings: PUT /api/plugins/:name/settings returns 404 when no schema", async () => {
  const app = createApp({ hasSettingsSchema: () => false });
  const res = await app.fetch(
    new Request("http://localhost/api/plugins/foo/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }),
  );
  assertEquals(res.status, 404);
});

Deno.test("plugin-settings: PUT /api/plugins/:name/settings persists and returns ok", async () => {
  const saved: Array<{ name: string; settings: Record<string, unknown> }> = [];
  const app = createApp({
    hasSettingsSchema: () => true,
    savePluginSettings: async (name, settings) => {
      saved.push({ name, settings });
    },
  });
  const res = await app.fetch(
    new Request("http://localhost/api/plugins/foo/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true, count: 5 }),
    }),
  );
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body, { ok: true });
  assertEquals(saved.length, 1);
  assertEquals(saved[0]?.name, "foo");
  assertEquals(saved[0]?.settings, { enabled: true, count: 5 });
});

Deno.test("plugin-settings: PUT returns 400 when error message includes 'validation' (substring contract)", async () => {
  const app = createApp({
    hasSettingsSchema: () => true,
    savePluginSettings: async () => {
      throw new Error("Settings validation failed: enabled must be boolean");
    },
  });
  const res = await app.fetch(
    new Request("http://localhost/api/plugins/foo/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: "yes" }),
    }),
  );
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.title, "Bad Request");
  assert(body.detail.includes("validation"));
});

Deno.test("plugin-settings: PUT re-throws errors whose message lacks the 'validation' substring (becomes 500)", async () => {
  const app = createApp({
    hasSettingsSchema: () => true,
    savePluginSettings: async () => {
      throw new Error("disk full");
    },
  });
  // Hono will surface throws as 500 by default
  const res = await app.fetch(
    new Request("http://localhost/api/plugins/foo/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assertEquals(res.status, 500);
});

Deno.test("plugin-settings: PUT re-throws even when error.name is 'ValidationError' if message lacks substring", async () => {
  // Locks in the current contract: classification is by message substring,
  // NOT by error.name. If the route is ever changed to use `instanceof` or
  // `err.name === "ValidationError"`, this test will fail and force a
  // deliberate decision about which contract is intended.
  const app = createApp({
    hasSettingsSchema: () => true,
    savePluginSettings: async () => {
      const err = new Error("invalid input");
      err.name = "ValidationError";
      throw err;
    },
  });
  const res = await app.fetch(
    new Request("http://localhost/api/plugins/foo/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }),
  );
  assertEquals(res.status, 500);
});
