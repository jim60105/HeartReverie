// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";

Deno.test("PluginManager.getStripTagDeclarations", async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "pm-strip-decl-" });
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("reports plugin → tags mapping with prompt+display scope", async () => {
      const pluginDir = join(tmpDir, "both");
      const pDir = join(pluginDir, "both-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "both-plugin",
          version: "1.0.0",
          promptStripTags: ["foo"],
          displayStripTags: ["bar"],
        }),
      );
      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      const decls = pm.getStripTagDeclarations();
      const entry = decls.find((d) => d.plugin === "both-plugin");
      assertEquals(entry?.scope, "prompt+display");
      assertEquals(entry?.tags.sort(), ["bar", "foo"]);
    });

    await t.step("reports prompt-only scope correctly", async () => {
      const pluginDir = join(tmpDir, "prompt-only");
      const pDir = join(pluginDir, "p-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "p-plugin",
          version: "1.0.0",
          promptStripTags: ["hidden"],
        }),
      );
      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      const entry = pm.getStripTagDeclarations().find((d) => d.plugin === "p-plugin");
      assertEquals(entry?.scope, "prompt");
      assertEquals(entry?.tags, ["hidden"]);
    });

    await t.step("omits plugins with no strip tags", async () => {
      const pluginDir = join(tmpDir, "none");
      const pDir = join(pluginDir, "n-plugin");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({ name: "n-plugin", version: "1.0.0" }),
      );
      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, Deno.makeTempDirSync());
      await pm.init();
      assertEquals(pm.getStripTagDeclarations().length, 0);
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});
