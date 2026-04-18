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

import { assertEquals, assert as assertTrue } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";

Deno.test("PluginManager", async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "pm-test-" });
  // Suppress console output during plugin loading
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("getStripTagPatterns", async (t) => {
      await t.step("returns null when no plugins have strip tags", async () => {
        const pluginDir = join(tmpDir, "no-tags");
        const pDir = join(pluginDir, "test-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({ name: "test-plugin", version: "1.0.0" }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getStripTagPatterns(), null);
      });

      await t.step("generates regex for plain tags", async () => {
        const pluginDir = join(tmpDir, "plain-tags");
        const pDir = join(pluginDir, "strip-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "strip-plugin",
            version: "1.0.0",
            promptStripTags: ["user_message"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        const regex = pm.getStripTagPatterns();
        assertTrue(regex instanceof RegExp);
        assertTrue(regex.test("<user_message>some content</user_message>"));
        assertTrue(!regex.test("plain text without tags"));
      });

      await t.step("treats entries starting with / as regex patterns", async () => {
        const pluginDir = join(tmpDir, "regex-tags");
        const pDir = join(pluginDir, "regex-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "regex-plugin",
            version: "1.0.0",
            promptStripTags: ["/\\[hidden\\]/"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        const regex = pm.getStripTagPatterns();
        assertTrue(regex instanceof RegExp);
        assertTrue(regex.test("[hidden]"));
      });

      await t.step("skips empty regex // with warning", async () => {
        const pluginDir = join(tmpDir, "empty-regex");
        const pDir = join(pluginDir, "empty-regex-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "empty-regex-plugin",
            version: "1.0.0",
            promptStripTags: ["//"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getStripTagPatterns(), null);
      });

      await t.step("skips invalid regex with warning", async () => {
        const pluginDir = join(tmpDir, "invalid-regex");
        const pDir = join(pluginDir, "bad-regex-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "bad-regex-plugin",
            version: "1.0.0",
            promptStripTags: ["/[invalid/"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getStripTagPatterns(), null);
      });
    });

    await t.step("init with invalid plugin names", async (t) => {
      await t.step("skips plugins with path traversal in name", async () => {
        const pluginDir = join(tmpDir, "bad-names");
        // The directory name itself can't have / on Linux, but we can test
        // that a valid-named directory with mismatched manifest.name is skipped
        const pDir = join(pluginDir, "good-name");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({ name: "wrong-name", version: "1.0.0" }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPlugins().length, 0);
      });
    });

    await t.step("getPlugins and getParameters", async (t) => {
      await t.step("returns loaded plugins and core parameters", async () => {
        const pluginDir = join(tmpDir, "list-test");
        const pDir = join(pluginDir, "list-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "list-plugin",
            version: "2.0.0",
            description: "A test plugin",
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        const plugins = pm.getPlugins();
        assertEquals(plugins.length, 1);
        assertEquals(plugins[0]!.name, "list-plugin");

        const params = pm.getParameters();
        assertTrue(params.length > 0);
        assertTrue(params.some((p) => p.name === "series_name"));
      });
    });
    await t.step("external plugin directory", async (t) => {
      await t.step("non-absolute externalDir logs warning and skips", async () => {
        const pluginDir = join(tmpDir, "ext-nonabs-builtin");
        await Deno.mkdir(pluginDir, { recursive: true });

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, "relative/path", hd);
        await pm.init();

        assertTrue(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("PLUGIN_DIR must be an absolute path")
          ),
        );
      });

      await t.step("absolute externalDir loads plugins", async () => {
        const builtinDir = join(tmpDir, "ext-abs-builtin");
        const externalDir = join(tmpDir, "ext-abs-external");
        await Deno.mkdir(builtinDir, { recursive: true });
        const pDir = join(externalDir, "ext-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({ name: "ext-plugin", version: "1.0.0" }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(builtinDir, externalDir, hd);
        await pm.init();

        const plugins = pm.getPlugins();
        assertEquals(plugins.length, 1);
        assertEquals(plugins[0]!.name, "ext-plugin");
      });

      await t.step("external plugin overrides built-in with same name", async () => {
        const builtinDir = join(tmpDir, "override-builtin");
        const externalDir = join(tmpDir, "override-external");
        const bPlugin = join(builtinDir, "shared-plugin");
        const ePlugin = join(externalDir, "shared-plugin");
        await Deno.mkdir(bPlugin, { recursive: true });
        await Deno.mkdir(ePlugin, { recursive: true });
        await Deno.writeTextFile(
          join(bPlugin, "plugin.json"),
          JSON.stringify({ name: "shared-plugin", version: "1.0.0", description: "builtin" }),
        );
        await Deno.writeTextFile(
          join(ePlugin, "plugin.json"),
          JSON.stringify({ name: "shared-plugin", version: "2.0.0", description: "external" }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(builtinDir, externalDir, hd);
        await pm.init();

        const plugins = pm.getPlugins();
        assertEquals(plugins.length, 1);
        assertEquals(plugins[0]!.version, "2.0.0");
        assertEquals(plugins[0]!.description, "external");
      });
    });

    await t.step("invalid plugin manifests", async (t) => {
      await t.step("skips plugin with invalid JSON", async () => {
        const pluginDir = join(tmpDir, "bad-json");
        const pDir = join(pluginDir, "broken-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "plugin.json"), "NOT VALID JSON{{{");

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPlugins().length, 0);
        assertTrue(
          warnStub.calls.some((c) => String(c.args[0]).includes("Invalid JSON")),
        );
      });

      await t.step("skips plugin missing name field", async () => {
        const pluginDir = join(tmpDir, "no-name");
        const pDir = join(pluginDir, "nameless-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "plugin.json"), JSON.stringify({}));

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPlugins().length, 0);
        assertTrue(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("missing required 'name' field")
          ),
        );
      });
    });

    await t.step("backend module loading", async (t) => {
      await t.step("calls register() from backend module", async () => {
        const pluginDir = join(tmpDir, "backend-ok");
        const pDir = join(pluginDir, "backend-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "backend.js"),
          `export function register({ hooks }) {
             hooks.register("post-response", async (ctx) => { ctx.called = true; });
           }`,
        );
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({ name: "backend-plugin", version: "1.0.0", backendModule: "backend.js" }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPlugins().length, 1);
        // Verify register was called — hook should be registered
        const ctx: Record<string, unknown> = {};
        await hd.dispatch("post-response", ctx);
        assertEquals(ctx.called, true);
      });

      await t.step("skips backend module that escapes plugin directory", async () => {
        const pluginDir = join(tmpDir, "backend-escape");
        const pDir = join(pluginDir, "escape-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "escape-plugin",
            version: "1.0.0",
            backendModule: "../../escape.js",
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertTrue(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("escapes plugin directory")
          ),
        );
      });

      await t.step("warns when backend module has no register export", async () => {
        const pluginDir = join(tmpDir, "backend-noreg");
        const pDir = join(pluginDir, "noreg-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "noregister.js"),
          `export const something = 42;`,
        );
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "noreg-plugin",
            version: "1.0.0",
            backendModule: "noregister.js",
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertTrue(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("no register() or default export")
          ),
        );
      });

      await t.step("logs error when backend module import fails", async () => {
        const pluginDir = join(tmpDir, "backend-fail");
        const pDir = join(pluginDir, "failmod-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "failmod-plugin",
            version: "1.0.0",
            backendModule: "nonexistent.js",
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertTrue(
          errorStub.calls.some((c) =>
            String(c.args[0]).includes("Failed to load backend module")
          ),
        );
      });
    });

    await t.step("getPromptVariables", async (t) => {
      await t.step("returns named variables and unnamed fragments", async () => {
        const pluginDir = join(tmpDir, "pv-basic");
        const pDir = join(pluginDir, "frag-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "named.md"), "named content");
        await Deno.writeTextFile(join(pDir, "unnamed.md"), "unnamed content");
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "frag-plugin",
            version: "1.0.0",
            promptFragments: [
              { file: "named.md", variable: "myVar" },
              { file: "unnamed.md" },
            ],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        const pv = await pm.getPromptVariables();
        assertEquals(pv.variables["myVar"], "named content");
        assertEquals(pv.fragments.length, 1);
        assertEquals(pv.fragments[0], "unnamed content");
      });

      await t.step("skips fragment that escapes plugin directory", async () => {
        const pluginDir = join(tmpDir, "pv-escape");
        const pDir = join(pluginDir, "esc-frag-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "esc-frag-plugin",
            version: "1.0.0",
            promptFragments: [{ file: "../../etc/passwd" }],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        const pv = await pm.getPromptVariables();
        assertEquals(pv.fragments.length, 0);
        assertTrue(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("escapes plugin directory")
          ),
        );
      });

      await t.step("warns on missing fragment file", async () => {
        const pluginDir = join(tmpDir, "pv-missing");
        const pDir = join(pluginDir, "miss-frag-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "miss-frag-plugin",
            version: "1.0.0",
            promptFragments: [{ file: "does-not-exist.md" }],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        const pv = await pm.getPromptVariables();
        assertEquals(pv.fragments.length, 0);
        assertTrue(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("Failed to read prompt fragment")
          ),
        );
      });

      await t.step("sorts unnamed fragments by priority", async () => {
        const pluginDir = join(tmpDir, "pv-priority");
        const pDir = join(pluginDir, "prio-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "low.md"), "low priority");
        await Deno.writeTextFile(join(pDir, "high.md"), "high priority");
        await Deno.writeTextFile(join(pDir, "mid.md"), "mid priority");
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "prio-plugin",
            version: "1.0.0",
            promptFragments: [
              { file: "low.md", priority: 200 },
              { file: "high.md", priority: 10 },
              { file: "mid.md" }, // default priority 100
            ],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        const pv = await pm.getPromptVariables();
        assertEquals(pv.fragments.length, 3);
        assertEquals(pv.fragments[0], "high priority");
        assertEquals(pv.fragments[1], "mid priority");
        assertEquals(pv.fragments[2], "low priority");
      });
    });

    await t.step("getParameters with plugin parameters", async () => {
      const pluginDir = join(tmpDir, "params-test");
      const pDir = join(pluginDir, "param-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "param-plugin",
          version: "1.0.0",
          parameters: [
            { name: "x", type: "number", description: "A number" },
          ],
          promptFragments: [
            { file: "frag.md", variable: "fragVar" },
          ],
        }),
      );
      await Deno.writeTextFile(join(pDir, "frag.md"), "frag content");

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd);
      await pm.init();

      const params = pm.getParameters();
      const pluginParam = params.find((p) => p.name === "x");
      assertTrue(pluginParam !== undefined);
      assertEquals(pluginParam.type, "number");
      assertEquals(pluginParam.description, "A number");
      assertEquals(pluginParam.source, "param-plugin");

      const fragParam = params.find((p) => p.name === "fragVar");
      assertTrue(fragParam !== undefined);
      assertEquals(fragParam.type, "string");
      assertEquals(fragParam.source, "param-plugin");
    });

    await t.step("getPluginDir", async (t) => {
      await t.step("returns correct path for loaded plugin", async () => {
        const pluginDir = join(tmpDir, "dir-test");
        const pDir = join(pluginDir, "dir-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({ name: "dir-plugin", version: "1.0.0" }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginDir("dir-plugin"), pDir);
      });

      await t.step("returns null for unknown plugin", async () => {
        const pluginDir = join(tmpDir, "dir-null-test");
        await Deno.mkdir(pluginDir, { recursive: true });

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginDir("nonexistent"), null);
      });
    });

    await t.step("non-existent builtin directory does not throw", async () => {
      const pluginDir = join(tmpDir, "does-not-exist-at-all");

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd);
      await pm.init();

      assertEquals(pm.getPlugins().length, 0);
    });

    await t.step("duplicate plugin name in same dir — second overrides with log", async () => {
      // Manifest name must match directory name, so we cannot have two directories
      // with the same manifest name in a single scan. But we can use builtin + external
      // with the same name to trigger the override warning.
      const builtinDir = join(tmpDir, "dup-builtin");
      const externalDir = join(tmpDir, "dup-external");
      const bPlugin = join(builtinDir, "dup-plugin");
      const ePlugin = join(externalDir, "dup-plugin");
      await Deno.mkdir(bPlugin, { recursive: true });
      await Deno.mkdir(ePlugin, { recursive: true });
      await Deno.writeTextFile(
        join(bPlugin, "plugin.json"),
        JSON.stringify({ name: "dup-plugin", version: "1.0.0", description: "first" }),
      );
      await Deno.writeTextFile(
        join(ePlugin, "plugin.json"),
        JSON.stringify({ name: "dup-plugin", version: "2.0.0", description: "second" }),
      );

      // Reset warnStub calls to isolate this test
      warnStub.calls.length = 0;

      const hd = new HookDispatcher();
      const pm = new PluginManager(builtinDir, externalDir, hd);
      await pm.init();

      // Only one plugin loaded
      assertEquals(pm.getPlugins().length, 1);
      assertEquals(pm.getPlugins()[0]!.description, "second");

      // Warning was logged about the override
      assertTrue(
        warnStub.calls.some((c) =>
          String(c.args[0]).includes("Plugin override")
        ),
      );
    });

    await t.step("plugin without backendModule or frontendModule still loads", async () => {
      const pluginDir = join(tmpDir, "data-only");
      const pDir = join(pluginDir, "data-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({ name: "data-plugin", version: "1.0.0", description: "data only" }),
      );

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd);
      await pm.init();

      const plugins = pm.getPlugins();
      assertEquals(plugins.length, 1);
      assertEquals(plugins[0]!.name, "data-plugin");
      assertEquals(plugins[0]!.description, "data only");
    });

    await t.step("frontendStyles", async (t) => {
      await t.step("valid array of CSS paths is parsed and exposed via getPluginStyles", async () => {
        const pluginDir = join(tmpDir, "styles-valid");
        const pDir = join(pluginDir, "style-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "a.css"), "/* a */");
        await Deno.writeTextFile(join(pDir, "b.css"), "/* b */");
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "style-plugin",
            version: "1.0.0",
            frontendStyles: ["a.css", "b.css"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginStyles("style-plugin"), ["a.css", "b.css"]);
      });

      await t.step("missing CSS file is skipped with a warning", async () => {
        const pluginDir = join(tmpDir, "styles-missing");
        const pDir = join(pluginDir, "miss-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "exists.css"), "/* x */");
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "miss-plugin",
            version: "1.0.0",
            frontendStyles: ["exists.css", "missing.css"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginStyles("miss-plugin"), ["exists.css"]);
        assertTrue(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("missing.css") &&
            String(c.args[0]).includes("not found")
          ),
        );
      });

      await t.step("path traversal entry is rejected", async () => {
        const pluginDir = join(tmpDir, "styles-traversal");
        const pDir = join(pluginDir, "trav-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "plugin.json"),
          JSON.stringify({
            name: "trav-plugin",
            version: "1.0.0",
            frontendStyles: ["../escape.css"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginStyles("trav-plugin"), []);
      });

      await t.step("non-array frontendStyles is ignored with warning", async () => {
        const pluginDir = join(tmpDir, "styles-nonarray");
        const pDir = join(pluginDir, "na-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "plugin.json"),
          JSON.stringify({
            name: "na-plugin",
            version: "1.0.0",
            frontendStyles: "not-an-array.css",
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginStyles("na-plugin"), []);
      });

      await t.step("non-.css extension is rejected", async () => {
        const pluginDir = join(tmpDir, "styles-badext");
        const pDir = join(pluginDir, "ext-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "style.js"), "/* not css */");
        await Deno.writeTextFile(join(pDir, "plugin.json"),
          JSON.stringify({
            name: "ext-plugin",
            version: "1.0.0",
            frontendStyles: ["style.js"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginStyles("ext-plugin"), []);
      });

      await t.step("leading ./ prefix is normalized", async () => {
        const pluginDir = join(tmpDir, "styles-prefix");
        const pDir = join(pluginDir, "pref-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "main.css"), "/* m */");
        await Deno.writeTextFile(join(pDir, "plugin.json"),
          JSON.stringify({
            name: "pref-plugin",
            version: "1.0.0",
            frontendStyles: ["./main.css"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginStyles("pref-plugin"), ["main.css"]);
      });

      await t.step("duplicate entries are deduplicated", async () => {
        const pluginDir = join(tmpDir, "styles-dup");
        const pDir = join(pluginDir, "dup-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "s.css"), "/* s */");
        await Deno.writeTextFile(join(pDir, "plugin.json"),
          JSON.stringify({
            name: "dup-plugin",
            version: "1.0.0",
            frontendStyles: ["s.css", "./s.css", "s.css"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginStyles("dup-plugin"), ["s.css"]);
      });

      await t.step("absolute path is rejected", async () => {
        const pluginDir = join(tmpDir, "styles-abs");
        const pDir = join(pluginDir, "abs-plugin");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "plugin.json"),
          JSON.stringify({
            name: "abs-plugin",
            version: "1.0.0",
            frontendStyles: ["/etc/passwd.css"],
          }),
        );

        const hd = new HookDispatcher();
        const pm = new PluginManager(pluginDir, undefined, hd);
        await pm.init();

        assertEquals(pm.getPluginStyles("abs-plugin"), []);
      });
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});
