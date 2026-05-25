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

interface Fixture {
  pm: PluginManager;
  pluginName: string;
  playgroundDir: string;
  configPath: string;
}

async function setupPlugin(
  name: string,
  schema: Record<string, unknown>,
  initialConfig?: Record<string, unknown>,
): Promise<Fixture> {
  const root = await Deno.makeTempDir({ prefix: `pm-io-${name}-` });
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
  return { pm, pluginName: name, playgroundDir, configPath };
}

Deno.test("settings IO", async (t) => {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("3.1 x-previous-names rename on GET (in-memory only)", async () => {
      const { pm, pluginName, configPath } = await setupPlugin(
        "rename",
        {
          type: "object",
          properties: {
            newName: { type: "string", "x-previous-names": ["oldName"] },
          },
        },
        { oldName: "value" },
      );
      const { settings } = await pm.getPluginSettingsForResponse(pluginName);
      assertEquals(settings.newName, "value");
      assert(!("oldName" in settings));
      // Disk unchanged
      const onDisk = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(onDisk, { oldName: "value" });
    });

    await t.step("3.2 x-legacy orphan relocation on PUT, never echoed", async () => {
      const { pm, pluginName, configPath } = await setupPlugin(
        "legacy",
        {
          type: "object",
          "x-legacy": true,
          properties: { a: { type: "string" } },
        },
        { a: "x", deprecatedAux: "v" },
      );
      const r = await pm.validateAndPreparePluginSettings(pluginName, { a: "y" });
      assertEquals(r.errors.length, 0);
      await pm.commitPluginSettings(pluginName, r.finalSettings);
      const onDisk = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(onDisk["x-legacy"], { deprecatedAux: "v" });
      assertEquals(onDisk.a, "y");
      assert(!("deprecatedAux" in onDisk));

      // GET never echoes x-legacy
      const { settings } = await pm.getPluginSettingsForResponse(pluginName);
      assert(!("x-legacy" in settings));
      assert(!("deprecatedAux" in settings));
    });

    await t.step("3.3 writeOnly masking on GET; rename BEFORE mask", async () => {
      const { pm, pluginName } = await setupPlugin(
        "wo-rename",
        {
          type: "object",
          properties: {
            newApiKey: {
              type: "string",
              writeOnly: true,
              "x-previous-names": ["oldApiKey"],
            },
          },
        },
        { oldApiKey: "sk-secret" },
      );
      const { settings } = await pm.getPluginSettingsForResponse(pluginName);
      assertEquals(settings.newApiKey, null);
      assert(!("oldApiKey" in settings));
    });

    await t.step("3.4 PUT null on renamed writeOnly keeps the legacy value", async () => {
      const { pm, pluginName, configPath } = await setupPlugin(
        "wo-keep",
        {
          type: "object",
          properties: {
            newApiKey: {
              type: "string",
              writeOnly: true,
              "x-previous-names": ["oldApiKey"],
            },
          },
        },
        { oldApiKey: "sk-secret" },
      );
      const r = await pm.validateAndPreparePluginSettings(pluginName, {
        newApiKey: null,
      });
      assertEquals(r.errors.length, 0);
      await pm.commitPluginSettings(pluginName, r.finalSettings);
      const onDisk = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(onDisk.newApiKey, "sk-secret");
      assert(!("oldApiKey" in onDisk));
    });

    await t.step("3.4 writeOnly empty-string clears; other value sets+validates", async () => {
      const { pm, pluginName, configPath } = await setupPlugin(
        "wo-clear",
        {
          type: "object",
          properties: {
            apiKey: { type: "string", writeOnly: true, minLength: 3 },
          },
        },
        { apiKey: "old" },
      );
      // Clear.
      let r = await pm.validateAndPreparePluginSettings(pluginName, {
        apiKey: "",
      });
      assertEquals(r.errors.length, 0);
      await pm.commitPluginSettings(pluginName, r.finalSettings);
      let onDisk = JSON.parse(await Deno.readTextFile(configPath));
      assert(!("apiKey" in onDisk));

      // Set + validate fails on minLength.
      r = await pm.validateAndPreparePluginSettings(pluginName, {
        apiKey: "x",
      });
      assertEquals(r.errors.length, 1);
      assertEquals(r.errors[0]?.keyword, "minLength");

      // Set + validate passes.
      r = await pm.validateAndPreparePluginSettings(pluginName, {
        apiKey: "abcd",
      });
      assertEquals(r.errors.length, 0);
      await pm.commitPluginSettings(pluginName, r.finalSettings);
      onDisk = JSON.parse(await Deno.readTextFile(configPath));
      assertEquals(onDisk.apiKey, "abcd");
    });

    await t.step("3.5 x-legacy-warnings populated for pre-existing invalid value", async () => {
      const { pm, pluginName } = await setupPlugin(
        "warn",
        {
          type: "object",
          properties: {
            n: { type: "integer", minimum: 5 },
          },
        },
        { n: 1 },
      );
      const { legacyWarnings } = await pm.getPluginSettingsForResponse(pluginName);
      assert(legacyWarnings.length >= 1);
      assert(legacyWarnings.some((w) => w.path === "n" && w.keyword === "minimum"));
    });

    await t.step("3.5 x-legacy-warnings empty when disk is clean", async () => {
      const { pm, pluginName } = await setupPlugin(
        "clean",
        {
          type: "object",
          properties: { n: { type: "integer", minimum: 5 } },
        },
        { n: 10 },
      );
      const { legacyWarnings } = await pm.getPluginSettingsForResponse(pluginName);
      assertEquals(legacyWarnings, []);
    });

    await t.step("4.3 errors outside changedPaths scope demote to warnings", async () => {
      const { pm, pluginName, configPath } = await setupPlugin(
        "two-phase",
        {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", pattern: "^[a-z]+$" },
                },
              },
            },
          },
        },
        { items: [{ name: "alice" }, { name: "bob" }, { name: "BAD" }, { name: "CAPS" }] },
      );
      // Change only items[0] (a no-op rewrite); item[3].name still invalid → warning.
      const body = {
        items: [{ name: "alice" }, { name: "bob" }, { name: "BAD" }, { name: "CAPS" }],
        _changedPaths: ["items[0]"],
      };
      const r = await pm.validateAndPreparePluginSettings(pluginName, body);
      assertEquals(r.errors.length, 0);
      assert(r.warnings.some((w) => w.path === "items[3].name"));
      assert(r.warnings.some((w) => w.path === "items[2].name"));
      await pm.commitPluginSettings(pluginName, r.finalSettings);
      const onDisk = JSON.parse(await Deno.readTextFile(configPath));
      assert(!("_changedPaths" in onDisk));
    });

    await t.step("4.3 errors inside changedPaths scope block save", async () => {
      const { pm, pluginName } = await setupPlugin(
        "two-phase-block",
        {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string", pattern: "^[a-z]+$" },
                },
              },
            },
          },
        },
        { items: [{ name: "alice" }, { name: "BAD" }] },
      );
      const r = await pm.validateAndPreparePluginSettings(pluginName, {
        items: [{ name: "alice" }, { name: "BAD" }],
        _changedPaths: ["items[1]"],
      });
      assert(r.errors.some((e) => e.path === "items[1].name" && e.keyword === "pattern"));
    });

    await t.step("4.3 under-stated _changedPaths cannot mask a real diff", async () => {
      const { pm, pluginName } = await setupPlugin(
        "two-phase-diff",
        {
          type: "object",
          properties: {
            items: {
              type: "array",
              items: {
                type: "object",
                properties: { name: { type: "string", pattern: "^[a-z]+$" } },
              },
            },
            unrelated: { type: "string" },
          },
        },
        { items: [{ name: "alice" }], unrelated: "x" },
      );
      const r = await pm.validateAndPreparePluginSettings(pluginName, {
        items: [{ name: "BAD" }],
        unrelated: "x",
        _changedPaths: ["unrelated"],
      });
      assert(r.errors.some((e) => e.path === "items[0].name"));
    });

    await t.step("4.3 missing _changedPaths: fallback to actual-diff", async () => {
      const { pm, pluginName } = await setupPlugin(
        "two-phase-nodec",
        {
          type: "object",
          properties: {
            a: { type: "integer", minimum: 0 },
            b: { type: "integer", minimum: 0 },
          },
        },
        { a: 5, b: -1 },
      );
      // Change `a` only; b still invalid on disk → should be warning.
      const r = await pm.validateAndPreparePluginSettings(pluginName, {
        a: 6,
        b: -1,
      });
      assertEquals(r.errors.length, 0);
      assert(r.warnings.some((w) => w.path === "b" && w.keyword === "minimum"));
    });

    await t.step("4.2 malformed _changedPaths returns single type error", async () => {
      const { pm, pluginName } = await setupPlugin(
        "two-phase-malformed",
        { type: "object", properties: { a: { type: "string" } } },
      );
      const r = await pm.validateAndPreparePluginSettings(pluginName, {
        a: "x",
        _changedPaths: "not-an-array",
      } as unknown as Record<string, unknown>);
      assertEquals(r.errors.length, 1);
      assertEquals(r.errors[0]?.path, "_changedPaths");
      assertEquals(r.errors[0]?.keyword, "type");
      assert(r.malformedChangedPaths);
    });

    await t.step("4.5 schema-version mismatch: GET defaults, PUT 409", async () => {
      const { pm, pluginName } = await setupPlugin(
        "mismatch",
        {
          type: "object",
          "x-schema-version": 2,
          properties: { a: { type: "string", default: "d" } },
        },
        { a: "x" },
      );
      const { settings, schemaVersionMismatch } = await pm
        .getPluginSettingsForResponse(pluginName);
      assertEquals(schemaVersionMismatch, true);
      assertEquals(settings, { a: "d" });

      const r = await pm.validateAndPreparePluginSettings(pluginName, { a: "y" });
      assertEquals(r.schemaVersionMismatch, true);
      assertEquals(r.errors[0]?.messageKey, "schema_version_mismatch");
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
});
