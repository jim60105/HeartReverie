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

Deno.test("PluginManager — transactional registration", async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "pm-tx-test-" });
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("manifest hooks matches registrations — plugin loads", async () => {
      const pluginDir = join(tmpDir, "match");
      const pDir = join(pluginDir, "ok-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "backend.js"),
        `export function register({ hooks }) {
           hooks.register("post-response", async (ctx) => { ctx.x = 1; });
         }`,
      );
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "ok-plugin",
          displayName: "ok-plugin",
          version: "1.0.0",
          backendModule: "backend.js",
          hooks: [{ stage: "post-response" }],
        }),
      );

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      assertEquals(pm.getPlugins().length, 1);
      const decls = pm.getPluginHookDeclarations();
      const okEntry = decls.find((d) => d.plugin === "ok-plugin");
      assertEquals(okEntry?.hooks.length, 1);
    });

    await t.step("declaredOnly mismatch — plugin is rejected, no hook left registered", async () => {
      const pluginDir = join(tmpDir, "declared-only");
      const pDir = join(pluginDir, "decl-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "backend.js"),
        `export function register({ hooks }) {
           // declares post-response in manifest but never registers it
         }`,
      );
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "decl-plugin",
          displayName: "decl-plugin",
          version: "1.0.0",
          backendModule: "backend.js",
          hooks: [{ stage: "post-response" }],
        }),
      );

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      assertEquals(pm.getPlugins().length, 0);
      // dispatcher must have no handlers for the stage
      assertEquals(Object.keys(hd.introspect()).length, 0);
      assertTrue(
        errorStub.calls.some((c) =>
          String(c.args[0]).includes("Failed to load backend module") ||
          String(c.args[0]).includes("manifest") ||
          String(c.args[0]).includes("declaredOnly")
        ),
      );
    });

    await t.step("registeredOnly mismatch — plugin is rejected and rolled back", async () => {
      const pluginDir = join(tmpDir, "reg-only");
      const pDir = join(pluginDir, "reg-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "backend.js"),
        `export function register({ hooks }) {
           hooks.register("post-response", async () => {});
           hooks.register("prompt-assembly", async () => {});
         }`,
      );
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "reg-plugin",
          displayName: "reg-plugin",
          version: "1.0.0",
          backendModule: "backend.js",
          hooks: [{ stage: "post-response" }],
        }),
      );

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      assertEquals(pm.getPlugins().length, 0);
      // Rollback: neither stage has handlers
      const dump = hd.introspect();
      assertEquals(dump["post-response"]?.length ?? 0, 0);
      assertEquals(dump["prompt-assembly"]?.length ?? 0, 0);
    });

    await t.step("manifest declares strip-tags — rejected with redirect hint", async () => {
      const pluginDir = join(tmpDir, "strip");
      const pDir = join(pluginDir, "strip-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "strip-plugin",
          displayName: "strip-plugin",
          version: "1.0.0",
          hooks: [{ stage: "strip-tags" }],
        }),
      );

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      assertEquals(pm.getPlugins().length, 0);
      assertTrue(
        warnStub.calls.concat(errorStub.calls).some((c) =>
          String(c.args[0]).toLowerCase().includes("strip-tags") ||
          String(c.args[0]).toLowerCase().includes("promptstriptags") ||
          String(c.args[0]).toLowerCase().includes("displaystriptags")
        ),
      );
    });

    await t.step("manifest hooks duplicate stage — plugin rejected", async () => {
      const pluginDir = join(tmpDir, "dup");
      const pDir = join(pluginDir, "dup-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "dup-plugin",
          displayName: "dup-plugin",
          version: "1.0.0",
          hooks: [
            { stage: "post-response" },
            { stage: "post-response" },
          ],
        }),
      );

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      assertEquals(pm.getPlugins().length, 0);
    });

    await t.step("absent hooks field — legacy mode, no strict check", async () => {
      const pluginDir = join(tmpDir, "legacy");
      const pDir = join(pluginDir, "legacy-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "backend.js"),
        `export function register({ hooks }) {
           hooks.register("post-response", async () => {});
         }`,
      );
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "legacy-plugin",
          displayName: "legacy-plugin",
          version: "1.0.0",
          backendModule: "backend.js",
        }),
      );

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      assertEquals(pm.getPlugins().length, 1);
    });

    await t.step("getPluginHookDeclarations omits plugins that failed to load", async () => {
      const pluginDir = join(tmpDir, "unknown");
      await Deno.mkdir(pluginDir, { recursive: true });
      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      assertEquals(pm.getPluginHookDeclarations().length, 0);
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});
