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

import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type { HookHandler, HookStage } from "../../../writer/types.ts";

Deno.test("HookDispatcher", async (t) => {
  await t.step("registers a handler for a valid stage", () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async () => {});
  });

  await t.step("throws for invalid stage", () => {
    const hd = new HookDispatcher();
    assertThrows(
      () => hd.register("invalid-stage" as HookStage, (async () => {}) as unknown as HookHandler),
      Error,
      "Invalid hook stage",
    );
  });

  await t.step("throws for non-function handler", () => {
    const hd = new HookDispatcher();
    assertThrows(
      () => hd.register("prompt-assembly", "not a function" as unknown as HookHandler),
      Error,
      "Hook handler must be a function",
    );
  });

  await t.step("dispatches handlers in priority order (lower first)", async () => {
    const hd = new HookDispatcher();
    const order: string[] = [];
    hd.register(
      "prompt-assembly",
      async () => {
        order.push("second");
      },
      200,
    );
    hd.register(
      "prompt-assembly",
      async () => {
        order.push("first");
      },
      50,
    );

    await hd.dispatch("prompt-assembly", {});
    assertEquals(order, ["first", "second"]);
  });

  await t.step("isolates errors: one handler throws, others still run", async () => {
    const hd = new HookDispatcher();
    const results: string[] = [];
    hd.register(
      "response-stream",
      async () => {
        results.push("a");
      },
      10,
    );
    hd.register(
      "response-stream",
      async () => {
        throw new Error("boom");
      },
      20,
    );
    hd.register(
      "response-stream",
      async () => {
        results.push("c");
      },
      30,
    );

    await hd.dispatch("response-stream", {});
    assertEquals(results, ["a", "c"]);
  });

  await t.step("returns mutated context from dispatch", async () => {
    const hd = new HookDispatcher();
    hd.register("post-response", async (ctx) => {
      ctx.modified = true;
    });

    const ctx = { modified: false };
    const result = await hd.dispatch("post-response", ctx);
    assertEquals(result.modified, true);
    assertStrictEquals(result, ctx);
  });

  await t.step("returns context unchanged when no handlers", async () => {
    const hd = new HookDispatcher();
    const ctx = { value: 42 };
    const result = await hd.dispatch("strip-tags", ctx);
    assertEquals(result, { value: 42 });
  });

  await t.step("default priority (100) runs after priority-50 handler", async () => {
    const hd = new HookDispatcher();
    const order: string[] = [];
    // Register with default priority (100) first
    hd.register("prompt-assembly", async () => { order.push("default"); });
    // Register with explicit priority 50 second
    hd.register("prompt-assembly", async () => { order.push("fifty"); }, 50);

    await hd.dispatch("prompt-assembly", {});
    assertEquals(order, ["fifty", "default"]);
  });

  await t.step("same priority maintains registration order", async () => {
    const hd = new HookDispatcher();
    const order: string[] = [];
    hd.register("post-response", async () => { order.push("first"); }, 100);
    hd.register("post-response", async () => { order.push("second"); }, 100);
    hd.register("post-response", async () => { order.push("third"); }, 100);

    await hd.dispatch("post-response", {});
    assertEquals(order, ["first", "second", "third"]);
  });

  await t.step("async handler is awaited before next handler runs", async () => {
    const hd = new HookDispatcher();
    let asyncFlag = false;
    hd.register("strip-tags", async () => {
      await new Promise((r) => setTimeout(r, 50));
      asyncFlag = true;
    }, 10);
    hd.register("strip-tags", async (ctx) => {
      ctx.sawFlag = asyncFlag;
    }, 20);

    const ctx: Record<string, unknown> = {};
    await hd.dispatch("strip-tags", ctx);
    assertEquals(asyncFlag, true);
    assertEquals(ctx.sawFlag, true);
  });
});
