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

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";

/**
 * Integration fixture test: pre-write equivalence (task 6.5).
 *
 * Validates the critical invariant that serial handlers on `pre-write`
 * mutate the shared base context AND that the two-bucket dispatch path
 * (with a parallel bucket present on another stage) does not break
 * serial mutation semantics.
 */

/** Suppress console output during tests. */
async function withSilencedConsole<T>(fn: () => Promise<T>): Promise<T> {
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});
  try {
    return await fn();
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
}

Deno.test("6.5 Pre-write equivalence integration fixture", async (t) => {
  await t.step("serial-mutator-fixture writes context.preContent on pre-write", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();

      // Register the serial-mutator-fixture's handler (pre-write stage)
      // This mimics what the fixture plugin's handler.ts does
      hd.register("pre-write", async (context) => {
        context.preContent = "<user_message>fixture-test-content</user_message>";
      });

      const ctx: Record<string, unknown> = { preContent: "", message: "hello" };
      const result = await hd.dispatch("pre-write", ctx);

      // The context object should be mutated in place
      assertStrictEquals(result, ctx, "dispatch should return the same context reference");
      assertEquals(
        result.preContent,
        "<user_message>fixture-test-content</user_message>",
        "preContent should be written by the serial handler",
      );
    });
  });

  await t.step(
    "serial pre-write mutation survives when parallel handlers exist on another stage",
    async () => {
      await withSilencedConsole(async () => {
        const hd = new HookDispatcher();

        // Register a serial pre-write handler (mimics serial-mutator-fixture)
        hd.register("pre-write", async (context) => {
          context.preContent = "<user_message>fixture-test-content</user_message>";
        });

        // Register a parallel post-response handler (mimics parallel-bench)
        // This ensures the two-bucket dispatch path is active on another stage
        hd.register(
          "post-response",
          async (context) => {
            await new Promise((r) => setTimeout(r, 5));
            (context.logger as { debug?: (...args: unknown[]) => void })?.debug?.(
              "parallel-bench: post-response completed",
            );
          },
          { parallel: true, readOnly: true },
          "parallel-bench",
        );

        // Dispatch pre-write — serial mutation should work
        const ctx: Record<string, unknown> = { preContent: "", message: "hello" };
        const result = await hd.dispatch("pre-write", ctx);

        assertStrictEquals(result, ctx);
        assertEquals(
          result.preContent,
          "<user_message>fixture-test-content</user_message>",
        );

        // Now dispatch post-response on the same dispatcher to exercise
        // the parallel path — this should not interfere with pre-write results
        await hd.dispatch("post-response", { correlationId: "test-123" });

        // preContent on the original ctx should be unchanged
        assertEquals(
          ctx.preContent,
          "<user_message>fixture-test-content</user_message>",
          "parallel post-response dispatch must not affect pre-write context",
        );
      });
    },
  );

  await t.step("multiple serial handlers on pre-write compose in priority order", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();

      // First handler (priority 50): sets base content
      hd.register("pre-write", async (context) => {
        context.preContent = "<user_message>fixture-test-content</user_message>";
      }, 50);

      // Second handler (priority 100): appends metadata
      hd.register("pre-write", async (context) => {
        context.preContent = (context.preContent as string) + "\n<metadata>extra</metadata>";
      }, 100);

      // Parallel handler on another stage
      hd.register(
        "post-response",
        async () => {
          await new Promise((r) => setTimeout(r, 5));
        },
        { parallel: true, readOnly: true },
        "metrics-plugin",
      );

      const ctx: Record<string, unknown> = { preContent: "" };
      const result = await hd.dispatch("pre-write", ctx);

      assertStrictEquals(result, ctx);
      assertEquals(
        result.preContent,
        "<user_message>fixture-test-content</user_message>\n<metadata>extra</metadata>",
      );
    });
  });

  await t.step(
    "pre-write with empty parallel bucket is byte-identical to legacy path",
    async () => {
      await withSilencedConsole(async () => {
        const hd = new HookDispatcher();

        // Only serial handlers, no parallel at all — should behave like legacy
        hd.register("pre-write", async (context) => {
          context.preContent = "<user_message>legacy-path</user_message>";
        });

        const ctx: Record<string, unknown> = { preContent: "" };
        const result = await hd.dispatch("pre-write", ctx);

        assertStrictEquals(result, ctx);
        assertEquals(result.preContent, "<user_message>legacy-path</user_message>");

        // Check metrics: should report serial-only dispatch
        const metrics = hd.getMetricsBuffer();
        assert(metrics.length >= 1);
        const lastMetric = metrics[metrics.length - 1]!;
        assertEquals(lastMetric.stage, "pre-write");
        assertEquals(lastMetric.dispatchPhase, "serial");
        assertEquals(lastMetric.serialCount, 1);
        assertEquals(lastMetric.parallelCount, 0);
      });
    },
  );
});
