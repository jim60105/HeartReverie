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

import { assert, assertEquals, assertExists } from "@std/assert";
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
  const root = await Deno.makeTempDir({ prefix: `ps-cov-${name}-` });
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

/** Setup an app with NO plugin registered (for unknown-plugin tests). */
async function setupEmptyApp(): Promise<Hono> {
  const root = await Deno.makeTempDir({ prefix: "ps-cov-empty-" });
  const pluginsDir = join(root, "plugins");
  const playgroundDir = join(root, "playground");
  await Deno.mkdir(pluginsDir, { recursive: true });
  await Deno.mkdir(playgroundDir, { recursive: true });
  const pm = new PluginManager(
    pluginsDir,
    undefined,
    new HookDispatcher(),
    playgroundDir,
  );
  await pm.init();
  const app = new Hono();
  registerPluginSettingsRoutes(app, { pluginManager: pm });
  return app;
}

Deno.test("plugin-settings coverage – unknown plugin 404s", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    const app = await setupEmptyApp();

    await t.step("GET /settings returns 404 for unknown plugin", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/ghost/settings"),
      );
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.status, 404);
      assert(body.detail.includes("no settings"));
    });

    await t.step("GET /settings-schema returns 404 for unknown plugin", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/ghost/settings-schema"),
      );
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.status, 404);
      assert(body.detail.includes("no settings schema"));
    });

    await t.step("PUT /settings returns 404 for unknown plugin", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/ghost/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: 1 }),
        }),
      );
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.status, 404);
    });

    await t.step("POST /validate returns 404 for unknown plugin", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/ghost/settings/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ a: 1 }),
        }),
      );
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.status, 404);
    });

    await t.step("GET /schema-meta returns 404 for unknown plugin", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/ghost/settings/schema-meta"),
      );
      assertEquals(res.status, 404);
      const body = await res.json();
      assertEquals(body.status, 404);
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});

Deno.test("plugin-settings coverage – malformed JSON body → 400", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    const { app } = await setupApp(
      "json-test",
      { type: "object", properties: { a: { type: "string" } } },
    );

    await t.step("PUT with unparseable JSON returns 400", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/json-test/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "NOT JSON {{{",
        }),
      );
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.errors[0].keyword, "type");
      assertEquals(body.errors[0].params.expected, "object");
      assertEquals(body.warnings, []);
    });

    await t.step("PUT with null body returns 400", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/json-test/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "null",
        }),
      );
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.errors[0].keyword, "type");
    });

    await t.step("PUT with array body returns 400", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/json-test/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "[1,2,3]",
        }),
      );
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.errors[0].keyword, "type");
    });

    await t.step("PUT with string body returns 400", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/json-test/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: '"just a string"',
        }),
      );
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.errors[0].keyword, "type");
    });

    await t.step("POST /validate with unparseable JSON returns 200 with errors", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/json-test/settings/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "NOT JSON",
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.errors[0].keyword, "type");
      assertEquals(body.errors[0].params.expected, "object");
    });

    await t.step("POST /validate with null body returns 200 with errors", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/json-test/settings/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "null",
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.errors[0].keyword, "type");
    });

    await t.step("POST /validate with array body returns 200 with errors", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/json-test/settings/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "[1,2]",
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.errors[0].keyword, "type");
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});

Deno.test("plugin-settings coverage – GET /settings-schema happy path", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    const schema = {
      type: "object",
      properties: {
        host: { type: "string", default: "localhost" },
        port: { type: "integer", default: 8080 },
      },
    };
    const { app } = await setupApp("schema-ok", schema);

    await t.step("returns full schema with x-schema-version", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/schema-ok/settings-schema"),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body["x-schema-version"], 1);
      assertEquals(body.type, "object");
      assertExists(body.properties.host);
      assertExists(body.properties.port);
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});

Deno.test("plugin-settings coverage – GET /settings with legacy warnings", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("x-legacy-warnings included when validation errors exist in stored config", async () => {
      const { app } = await setupApp(
        "legacy-warn",
        {
          type: "object",
          properties: {
            count: { type: "integer", minimum: 10 },
          },
        },
        { count: 3 }, // violates minimum → will produce legacy warning
      );
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/legacy-warn/settings"),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assert(
        Array.isArray(body["x-legacy-warnings"]),
        "x-legacy-warnings should be present",
      );
      assert(body["x-legacy-warnings"].length > 0);
    });

    await t.step("no x-legacy-warnings when stored config is valid", async () => {
      const { app } = await setupApp(
        "no-legacy",
        {
          type: "object",
          properties: {
            count: { type: "integer", minimum: 1 },
          },
        },
        { count: 5 },
      );
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/no-legacy/settings"),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body["x-legacy-warnings"], undefined);
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});

Deno.test("plugin-settings coverage – PUT /settings success writes to disk", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("PUT valid settings returns 200 and persists", async () => {
      const { app, configPath } = await setupApp(
        "put-ok",
        {
          type: "object",
          properties: {
            name: { type: "string" },
            count: { type: "integer" },
          },
        },
        { name: "old", count: 1 },
      );
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/put-ok/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "new", count: 42, _changedPaths: ["name", "count"] }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.errors, []);
      assert(Array.isArray(body.warnings));

      const onDisk = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(onDisk.name, "new");
      assertEquals(onDisk.count, 42);
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});

Deno.test("plugin-settings coverage – POST /validate returns 200 for valid + invalid", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    const { app } = await setupApp(
      "validate-mixed",
      {
        type: "object",
        properties: {
          age: { type: "integer", minimum: 0 },
        },
      },
    );

    await t.step("POST /validate with valid data returns empty errors", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/validate-mixed/settings/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ age: 25 }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.errors, []);
    });

    await t.step("POST /validate with invalid data returns errors (still 200)", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/validate-mixed/settings/validate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ age: -5 }),
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assert(body.errors.length > 0);
      assert(Array.isArray(body.warnings));
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});

Deno.test("plugin-settings coverage – reader-only guard on settings-schema", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("GET /settings-schema returns 404 in reader-only mode", async () => {
      const prev = Deno.env.get("HEARTREVERIE_READER_ONLY");
      Deno.env.set("HEARTREVERIE_READER_ONLY", "1");
      try {
        const { app } = await setupApp(
          "ro-schema",
          { type: "object", properties: { a: { type: "string" } } },
        );
        const res = await app.fetch(
          new Request("http://localhost/api/plugins/ro-schema/settings-schema"),
        );
        assertEquals(res.status, 404);
        const body = await res.json();
        assert(body.detail.includes("reader mode"));
      } finally {
        if (prev === undefined) Deno.env.delete("HEARTREVERIE_READER_ONLY");
        else Deno.env.set("HEARTREVERIE_READER_ONLY", prev);
      }
    });

    await t.step("GET /settings-schema accessible in writer mode", async () => {
      const prev = Deno.env.get("HEARTREVERIE_READER_ONLY");
      Deno.env.delete("HEARTREVERIE_READER_ONLY");
      try {
        const { app } = await setupApp(
          "wr-schema",
          { type: "object", properties: { a: { type: "string" } } },
        );
        const res = await app.fetch(
          new Request("http://localhost/api/plugins/wr-schema/settings-schema"),
        );
        assertEquals(res.status, 200);
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

Deno.test("plugin-settings coverage – schema-meta version mismatch returns null", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("schemaVersion is null when version mismatch detected", async () => {
      const { app } = await setupApp(
        "ver-null",
        {
          type: "object",
          "x-schema-version": 99,
          properties: { a: { type: "string", default: "x" } },
        },
        { a: "old" },
      );
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/ver-null/settings/schema-meta"),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      assertEquals(body.schemaVersion, null);
      assert(Array.isArray(body.pathRoots));
      assert(Array.isArray(body.formats));
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});

Deno.test("plugin-settings coverage – PUT with empty body (no Content-Type)", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("PUT with empty body triggers JSON parse error → 400", async () => {
      const { app } = await setupApp(
        "empty-body",
        { type: "object", properties: { a: { type: "string" } } },
      );
      const res = await app.fetch(
        new Request("http://localhost/api/plugins/empty-body/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "",
        }),
      );
      assertEquals(res.status, 400);
      const body = await res.json();
      assertEquals(body.errors[0].keyword, "type");
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});
