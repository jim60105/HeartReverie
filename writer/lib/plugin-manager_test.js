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

import { assertEquals, assert as assertTrue } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { PluginManager } from "./plugin-manager.js";
import { HookDispatcher } from "./hooks.js";

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
            stripTags: ["user_message"],
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
            stripTags: ["/\\[hidden\\]/"],
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
            stripTags: ["//"],
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
            stripTags: ["/[invalid/"],
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
        assertEquals(plugins[0].name, "list-plugin");

        const params = pm.getParameters();
        assertTrue(params.length > 0);
        assertTrue(params.some((p) => p.name === "scenario"));
      });
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});
