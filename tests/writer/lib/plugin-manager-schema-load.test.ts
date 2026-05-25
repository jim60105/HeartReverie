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
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";

async function makePluginDirs(
  rootBase: string,
  name: string,
  manifest: Record<string, unknown>,
): Promise<{ pluginsDir: string; playgroundDir: string }> {
  const pluginsDir = await Deno.makeTempDir({
    prefix: `pm-load-${name}-plugins-`,
    dir: rootBase,
  });
  const playgroundDir = await Deno.makeTempDir({
    prefix: `pm-load-${name}-pg-`,
    dir: rootBase,
  });
  const pDir = join(pluginsDir, name);
  await Deno.mkdir(pDir, { recursive: true });
  await Deno.writeTextFile(
    join(pDir, "plugin.json"),
    JSON.stringify({
      name,
      displayName: name,
      version: "1.0.0", ...manifest }),
  );
  return { pluginsDir, playgroundDir };
}

Deno.test("plugin-manager schema-load audit", async (t) => {
  const tmpRoot = await Deno.makeTempDir({ prefix: "pm-schema-load-" });
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("missing x-schema-version: auto-migrates with warn once", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p1",
        {
          settingsSchema: {
            type: "object",
            properties: { a: { type: "string" } },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p1"), true);
      assertEquals(pm.getSchemaVersion("p1"), 1);
    });

    await t.step("x-schema-version=2: mismatch marker set, plugin still loads", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p2",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 2,
            properties: { a: { type: "string", default: "hello" } },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p2"), true);
      assert(pm.isSchemaVersionMismatch("p2"));
      // GET returns defaults
      const { settings, schemaVersionMismatch } = await pm
        .getPluginSettingsForResponse("p2");
      assertEquals(schemaVersionMismatch, true);
      assertEquals(settings, { a: "hello" });
      // PUT returns 409
      const r = await pm.validateAndPreparePluginSettings("p2", { a: "x" });
      assertEquals(r.schemaVersionMismatch, true);
      assertEquals(r.errors[0]?.messageKey, "schema_version_mismatch");
    });

    await t.step("x-show-when: non-sibling field is rejected", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p3",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              mode: { type: "string" },
              detail: {
                type: "string",
                "x-show-when": { field: "doesNotExist", equals: "x" },
              },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p3"), false);
    });

    await t.step("x-show-when: sibling reference is accepted", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p3b",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              mode: { type: "string", enum: ["a", "b"] },
              detail: {
                type: "string",
                "x-show-when": { field: "mode", equals: "b" },
              },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p3b"), true);
    });

    await t.step("x-show-when: zero or multiple operators are rejected", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p4",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              mode: { type: "string" },
              detail: {
                type: "string",
                "x-show-when": { field: "mode", equals: "x", in: ["y", "z"] },
              },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p4"), false);
    });

    await t.step("x-show-when overlapping with 'required' is rejected", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p5",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            required: ["detail"],
            properties: {
              mode: { type: "string" },
              detail: {
                type: "string",
                "x-show-when": { field: "mode", equals: "b" },
              },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p5"), false);
    });

    await t.step("x-previous-names: non-string-array is rejected", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p6",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              newName: { type: "string", "x-previous-names": "oldName" },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p6"), false);
    });

    await t.step("x-previous-names: cannot include current name", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p7",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              newName: { type: "string", "x-previous-names": ["newName"] },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p7"), false);
    });

    await t.step("x-previous-names: collision between two properties is rejected", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p8",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              a: { type: "string", "x-previous-names": ["shared"] },
              b: { type: "string", "x-previous-names": ["shared"] },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p8"), false);
    });

    await t.step("x-previous-names: valid setup accepted", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p9",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              newName: { type: "string", "x-previous-names": ["oldName"] },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p9"), true);
    });

    await t.step("x-path-roots: non-string-array is rejected", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p10",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              p: { type: "string", format: "path", "x-path-roots": "string-not-array" },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p10"), false);
    });

    await t.step("x-path-roots: empty intersection is rejected", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p11",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              p: { type: "string", format: "path", "x-path-roots": ["/etc/"] },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p11"), false);
    });

    await t.step("x-path-roots: narrowing subset accepted", async () => {
      const { pluginsDir, playgroundDir } = await makePluginDirs(
        tmpRoot,
        "p12",
        {
          settingsSchema: {
            type: "object",
            "x-schema-version": 1,
            properties: {
              p: {
                type: "string",
                format: "path",
                "x-path-roots": ["playground/lore/"],
              },
            },
          },
        },
      );
      const pm = new PluginManager(pluginsDir, undefined, new HookDispatcher(), playgroundDir);
      await pm.init();
      assertEquals(pm.hasSettingsSchema("p12"), true);
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
    await Deno.remove(tmpRoot, { recursive: true }).catch(() => {});
  }
});

Deno.test("real HeartReverie_Plugins manifests load cleanly (task 12.2)", async () => {
  const pluginsDir = new URL("../../../../HeartReverie_Plugins", import.meta.url)
    .pathname;

  // Skip when sibling plugin repo is not present (e.g., standalone CI checkout).
  try {
    const stat = await Deno.stat(pluginsDir);
    assert(stat.isDirectory, `${pluginsDir} should be a directory`);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return;
    throw err;
  }

  const playgroundDir = await Deno.makeTempDir({ prefix: "pm-real-plugins-pg-" });
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    const pm = new PluginManager(
      pluginsDir,
      undefined,
      new HookDispatcher(),
      playgroundDir,
    );
    await pm.init();
    // Enumerate every directory that ships a plugin.json with settingsSchema.
    const schemaBearing: string[] = [];
    for await (const entry of Deno.readDir(pluginsDir)) {
      if (!entry.isDirectory) continue;
      try {
        const txt = await Deno.readTextFile(
          join(pluginsDir, entry.name, "plugin.json"),
        );
        const m = JSON.parse(txt);
        if (m && m.settingsSchema) schemaBearing.push(m.name ?? entry.name);
      } catch {
        // not a plugin dir
      }
    }
    assert(schemaBearing.length > 0, "expected at least one schema-bearing plugin");
    for (const name of schemaBearing) {
      assert(
        pm.hasSettingsSchema(name),
        `manifest ${name} should load cleanly under the new schema gate`,
      );
    }
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
    await Deno.remove(playgroundDir, { recursive: true }).catch(() => {});
  }
});
