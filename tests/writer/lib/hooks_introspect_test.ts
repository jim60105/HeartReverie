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
import { HookDispatcher } from "../../../writer/lib/hooks.ts";

Deno.test("HookDispatcher.introspect", async (t) => {
  await t.step("returns empty record when nothing registered", () => {
    const hd = new HookDispatcher();
    assertEquals(Object.keys(hd.introspect()).length, 0);
  });

  await t.step("returns plugin + priority + errorCount=0 per entry, sorted ascending", () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async () => {}, 100, "plugin-a");
    hd.register("prompt-assembly", async () => {}, 50, "plugin-b");
    const dump = hd.introspect();
    const entries = dump["prompt-assembly"] ?? [];
    assertEquals(entries.length, 2);
    const first = entries[0]!;
    const second = entries[1]!;
    assertEquals(first.priority, 50);
    assertEquals(first.plugin, "plugin-b");
    assertEquals(first.errorCount, 0);
    assertEquals(second.priority, 100);
    assertEquals(second.plugin, "plugin-a");
  });

  await t.step("snapshot is detached — mutation does not affect dispatcher", () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async () => {}, 100, "plugin-a");
    const dump = hd.introspect();
    (dump["prompt-assembly"] ?? []).pop();
    const dump2 = hd.introspect();
    assertEquals((dump2["prompt-assembly"] ?? []).length, 1);
  });
});

Deno.test("HookDispatcher — errorCount increments on caught handler error", async () => {
  const hd = new HookDispatcher();
  hd.register("prompt-assembly", async () => {
    throw new Error("boom");
  }, 100, "plugin-a");
  await hd.dispatch("prompt-assembly", { correlationId: "c1" });
  await hd.dispatch("prompt-assembly", { correlationId: "c2" });
  const entries = hd.introspect()["prompt-assembly"] ?? [];
  const entry = entries[0]!;
  assertEquals(entry.errorCount, 2);
});

Deno.test("HookDispatcher — successful handler keeps errorCount at 0", async () => {
  const hd = new HookDispatcher();
  hd.register("prompt-assembly", async () => {}, 100, "plugin-a");
  await hd.dispatch("prompt-assembly", {});
  const entries = hd.introspect()["prompt-assembly"] ?? [];
  const entry = entries[0]!;
  assertEquals(entry.errorCount, 0);
  assertTrue(entry.plugin === "plugin-a");
});
