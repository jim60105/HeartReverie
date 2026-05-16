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

import { assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { buildIntrospectionDump } from "../../../writer/lib/introspection-dump.ts";

Deno.test({
  name: "QUALITY-8: observer subscriptions surface via introspection",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const logStub = stub(console, "log", () => {});
    const warnStub = stub(console, "warn", () => {});
    const errorStub = stub(console, "error", () => {});
    const tmpDir = await Deno.makeTempDir({ prefix: "pm-observer-" });
    try {
      const pluginDir = join(tmpDir, "plugins");
      const pDir = join(pluginDir, "watcher");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(
        join(pDir, "plugin.json"),
        JSON.stringify({
          name: "watcher",
          version: "1.0.0",
          backendModule: "./backend.ts",
        }),
      );
      // Plugin's register() subscribes to both kinds.
      await Deno.writeTextFile(
        join(pDir, "backend.ts"),
        `export function register({ hooks }) {
          hooks.onHandlerStart?.(() => {});
          hooks.onHandlerEnd?.(() => {});
        }`,
      );

      const hd = new HookDispatcher();
      const pm = new PluginManager(pluginDir, undefined, hd, await Deno.makeTempDir());
      await pm.init();

      const subs = hd.getHandlerEventSubscribers();
      assertEquals(subs.watcher!.sort(), ["handler-end", "handler-start"]);

      // Introspection dump also exposes the field.
      const dump = buildIntrospectionDump(pm, hd);
      assertEquals(dump.observerSubscribers.watcher!.sort(), ["handler-end", "handler-start"]);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
      logStub.restore();
      warnStub.restore();
      errorStub.restore();
    }
  },
});
