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
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { Hono } from "@hono/hono";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { registerPluginSettingsRoutes } from "../../../writer/routes/plugin-settings.ts";

async function setupApp(
  name: string,
  schema: Record<string, unknown>,
  initialConfig?: Record<string, unknown>,
): Promise<{
  app: Hono;
  pm: PluginManager;
  configPath: string;
  pluginsDir: string;
  playgroundDir: string;
}> {
  const root = await Deno.makeTempDir({ prefix: `ps-routes-${name}-` });
  const pluginsDir = join(root, "plugins");
  const playgroundDir = join(root, "playground");
  await Deno.mkdir(join(pluginsDir, name), { recursive: true });
  await Deno.mkdir(playgroundDir, { recursive: true });
  await Deno.writeTextFile(
    join(pluginsDir, name, "plugin.json"),
    JSON.stringify({
      name,
      displayName: name,
      version: "1.0.0",
      settingsSchema: { "x-schema-version": 1, ...schema },
    }),
  );
  const configDir = join(playgroundDir, "_plugins", name);
  await Deno.mkdir(configDir, { recursive: true });
  const configPath = join(configDir, "config.json");
  if (initialConfig) {
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(initialConfig, null, 2) + "\n",
    );
  }
  const pm = new PluginManager(
    pluginsDir,
    undefined,
    new HookDispatcher(),
    playgroundDir,
  );
  await pm.init();
  const app = new Hono();
  registerPluginSettingsRoutes(app, { pluginManager: pm });
  return { app, pm, configPath, pluginsDir, playgroundDir };
}

Deno.test("plugin-settings routes integration", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("5.1 POST /validate never writes config.json (2 consecutive calls)", async () => {
      const { app, configPath } = await setupApp(
        "no-write",
        { type: "object", properties: { a: { type: "string" } } },
        { a: "before" },
      );
      const initial = await Deno.readTextFile(configPath);
      for (let i = 0; i < 2; i++) {
        const res = await app.fetch(
          new Request("http://localhost/api/plugins/no-write/settings/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ a: "candidate-" + i }),
          }),
        );
        assertEquals(res.status, 200);
        const body = await res.json();
        assertEquals(body.errors, []);
        assert(Array.isArray(body.warnings));
      }
      const after = await Deno.readTextFile(configPath);
      assertEquals(after, initial);
    });

    await t.step("5.2 GET /schema-meta returns the documented order", async () => {
      const { app } = await setupApp(
        "meta",
        { type: "object", properties: { a: { type: "string" } } },
      );
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/meta/settings/schema-meta"),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.schemaVersion, 1);
      assertEquals(body.pathRoots, [
        "playground/lore/",
        "playground/chapters/",
        "playground/_plugins/meta/",
      ]);
      assertEquals(body.formats, ["path", "color", "url", "email", "uuid"]);
    });

    await t.step("4.1 envelope shape: blocking 400 + envelope", async () => {
      const { app } = await setupApp(
        "blocking",
        {
          type: "object",
          properties: { a: { type: "integer", minimum: 5 } },
        },
        { a: 10 },
      );
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/blocking/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: 1 }),
        }),
      );
      assertEquals(res.status, 400);
      const body = await res.json();
      assert(Array.isArray(body.errors) && body.errors.length === 1);
      assert(Array.isArray(body.warnings));
      assertEquals(body.errors[0].keyword, "minimum");
    });

    await t.step("4.1 envelope shape: warnings only 200, file written", async () => {
      const { app, configPath } = await setupApp(
        "warnings",
        {
          type: "object",
          properties: {
            a: { type: "integer", minimum: 5 },
            b: { type: "string" },
          },
        },
        { a: 1, b: "x" }, // a violates schema but is unchanged → warning
      );
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/warnings/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: 1, b: "y", _changedPaths: ["b"] }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.errors, []);
      assert(body.warnings.some((w: { path: string }) => w.path === "a"));
      const onDisk = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(onDisk.b, "y");
    });

    await t.step("4.5 PUT 409 on schema-version mismatch", async () => {
      const { app } = await setupApp(
        "version-mismatch",
        {
          type: "object",
          "x-schema-version": 99,
          properties: { a: { type: "string", default: "d" } },
        },
        { a: "x" },
      );
      const putRes = await app.fetch(
        new Request("http://localhost/api/plugins/version-mismatch/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: "y" }),
        }),
      );
      assertEquals(putRes.status, 409);
      const body = await putRes.json();
      assertEquals(body.errors[0].messageKey, "schema_version_mismatch");

      // GET returns defaults.
      const getRes = await app.fetch(
        new Request("http://localhost/api/plugins/version-mismatch/settings"),
      );
      assertEquals(getRes.status, 200);
      const getBody = await getRes.json();
      assertEquals(getBody, { a: "d" });
    });

    await t.step("5.3 reader-only mode blocks all 4 routes (404)", async () => {
      const prev = Deno.env.get("HEARTREVERIE_READER_ONLY");
      Deno.env.set("HEARTREVERIE_READER_ONLY", "1");
      try {
        const { app } = await setupApp(
          "ro",
          { type: "object", properties: { a: { type: "string" } } },
        );
        for (
          const [m, p] of [
            ["GET", "/api/plugins/ro/settings"],
            ["PUT", "/api/plugins/ro/settings"],
            ["POST", "/api/plugins/ro/settings/validate"],
            ["GET", "/api/plugins/ro/settings/schema-meta"],
          ] as const
        ) {
          const init: RequestInit = { method: m };
          if (m !== "GET") {
            init.headers = { "Content-Type": "application/json" };
            init.body = "{}";
          }
          const res = await app.fetch(
            new Request(`http://localhost${p}`, init),
          );
          assertEquals(res.status, 404, `${m} ${p} should 404 in reader-only`);
        }
      } finally {
        if (prev === undefined) Deno.env.delete("HEARTREVERIE_READER_ONLY");
        else Deno.env.set("HEARTREVERIE_READER_ONLY", prev);
      }
    });

    await t.step("5.3 writer mode (env unset): all 4 routes serve", async () => {
      const prev = Deno.env.get("HEARTREVERIE_READER_ONLY");
      Deno.env.delete("HEARTREVERIE_READER_ONLY");
      try {
        const { app } = await setupApp(
          "wr",
          { type: "object", properties: { a: { type: "string" } } },
        );
        const r1 = await app.fetch(
          new Request("http://localhost/api/plugins/wr/settings"),
        );
        assertEquals(r1.status, 200);
        const r2 = await app.fetch(
          new Request("http://localhost/api/plugins/wr/settings/schema-meta"),
        );
        assertEquals(r2.status, 200);
      } finally {
        if (prev !== undefined) Deno.env.set("HEARTREVERIE_READER_ONLY", prev);
      }
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});
