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

import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { stub } from "@std/testing/mock";
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

  await t.step("pre-write: registers and dispatches handler", async () => {
    const hd = new HookDispatcher();
    hd.register("pre-write", async (ctx) => {
      ctx.preContent = `<user_message>\n${ctx.message}\n</user_message>\n\n`;
    });

    const ctx: Record<string, unknown> = { message: "hello", preContent: "" };
    await hd.dispatch("pre-write", ctx);
    assertEquals(ctx.preContent, "<user_message>\nhello\n</user_message>\n\n");
  });

  await t.step("pre-write: preContent remains empty when no handlers", async () => {
    const hd = new HookDispatcher();
    const ctx: Record<string, unknown> = { message: "hello", preContent: "" };
    await hd.dispatch("pre-write", ctx);
    assertEquals(ctx.preContent, "");
  });

  await t.step("pre-write: multiple handlers append in priority order", async () => {
    const hd = new HookDispatcher();
    hd.register("pre-write", async (ctx) => {
      (ctx.preContent as string) += "B";
    }, 100);
    hd.register("pre-write", async (ctx) => {
      (ctx.preContent as string) += "A";
    }, 50);

    const ctx: Record<string, unknown> = { preContent: "" };
    await hd.dispatch("pre-write", ctx);
    assertEquals(ctx.preContent, "AB");
  });

  await t.step("injects logger into context when correlationId is present", async () => {
    const hd = new HookDispatcher();
    let receivedLogger: unknown = undefined;
    hd.register("post-response", async (ctx) => {
      receivedLogger = ctx.logger;
    }, 100, "test-plugin");

    await hd.dispatch("post-response", { correlationId: "abc-123" });
    // Logger should be injected
    assertEquals(typeof receivedLogger, "object");
    assertEquals(typeof (receivedLogger as Record<string, unknown>).info, "function");
    assertEquals(typeof (receivedLogger as Record<string, unknown>).debug, "function");
  });

  await t.step("injects logger even without correlationId", async () => {
    const hd = new HookDispatcher();
    let receivedLogger: unknown = "sentinel";
    hd.register("post-response", async (ctx) => {
      receivedLogger = ctx.logger;
    }, 100, "test-plugin");

    await hd.dispatch("post-response", {});
    // Logger should always be injected (per spec)
    assertEquals(typeof receivedLogger, "object");
    assertEquals(typeof (receivedLogger as Record<string, unknown>).info, "function");
  });

  await t.step("register accepts plugin name parameter", () => {
    const hd = new HookDispatcher();
    // Should not throw
    hd.register("prompt-assembly", async () => {}, 100, "my-plugin");
  });

  await t.step("derives request logger from baseLogger preserving baseData", async () => {
    const hd = new HookDispatcher();
    const { createLogger } = await import("../../../writer/lib/logger.ts");
    const pluginLogger = createLogger("plugin", { baseData: { plugin: "derive-test" } });

    let receivedLogger: unknown = undefined;
    hd.register("post-response", async (ctx) => {
      receivedLogger = ctx.logger;
    }, 100, "derive-test", pluginLogger);

    await hd.dispatch("post-response", { correlationId: "req-xyz" });
    // Logger should be derived from baseLogger (has info, debug, withContext methods)
    assertEquals(typeof receivedLogger, "object");
    assertEquals(typeof (receivedLogger as Record<string, unknown>).info, "function");
    assertEquals(typeof (receivedLogger as Record<string, unknown>).withContext, "function");
  });
});

// =============================================================================
// Parallel dispatch tests (tasks 5.1–5.19)
// =============================================================================

/** Helper: stub console.log/warn/error, run fn, restore. Returns call arrays. */
async function withSilencedConsole<T>(
  fn: (stubs: {
    logCalls: unknown[][];
    warnCalls: unknown[][];
    errorCalls: unknown[][];
  }) => Promise<T>,
): Promise<T> {
  const logCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  const logStub = stub(console, "log", (...args: unknown[]) => { logCalls.push(args); });
  const warnStub = stub(console, "warn", (...args: unknown[]) => { warnCalls.push(args); });
  const errorStub = stub(console, "error", (...args: unknown[]) => { errorCalls.push(args); });
  try {
    return await fn({ logCalls, warnCalls, errorCalls });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
}

/** Count calls whose first argument (formatted string) contains the substring. */
function countCallsContaining(calls: unknown[][], substr: string): number {
  return calls.filter((args) => typeof args[0] === "string" && args[0].includes(substr)).length;
}

Deno.test("HookDispatcher — Parallel dispatch", async (t) => {
  // 5.1 Mixed bucket ordering
  await t.step("5.1 serial handlers run in priority order, parallel after serial completes", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const events: { id: string; time: number }[] = [];

      // 3 serial handlers (priority 50, 100, 150)
      hd.register("post-response", async () => {
        events.push({ id: "s50", time: performance.now() });
      }, 50);
      hd.register("post-response", async () => {
        events.push({ id: "s100", time: performance.now() });
      }, 100);
      hd.register("post-response", async () => {
        await new Promise((r) => setTimeout(r, 10));
        events.push({ id: "s150", time: performance.now() });
      }, 150);

      // 2 parallel handlers
      hd.register("post-response", async () => {
        events.push({ id: "p1", time: performance.now() });
      }, { parallel: true, readOnly: true, priority: 200 }, "p1-plugin");
      hd.register("post-response", async () => {
        events.push({ id: "p2", time: performance.now() });
      }, { parallel: true, readOnly: true, priority: 210 }, "p2-plugin");

      await hd.dispatch("post-response", {});

      // Serial order: 50 → 100 → 150
      const serialEvents = events.filter((e) => e.id.startsWith("s"));
      assertEquals(serialEvents.map((e) => e.id), ["s50", "s100", "s150"]);

      // Parallel handlers start AFTER serial-150 completes
      const s150Time = events.find((e) => e.id === "s150")!.time;
      const parallelEvents = events.filter((e) => e.id.startsWith("p"));
      for (const pe of parallelEvents) {
        assertEquals(pe.time >= s150Time, true,
          `Parallel ${pe.id} started before serial-150 completed`);
      }
    });
  });

  // 5.2 Priority semantics change
  await t.step("5.2 parallel p10 does NOT preempt serial p150", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const events: { id: string; time: number }[] = [];

      hd.register("post-response", async () => {
        await new Promise((r) => setTimeout(r, 20));
        events.push({ id: "serial-150", time: performance.now() });
      }, 150);
      hd.register("post-response", async () => {
        events.push({ id: "parallel-10", time: performance.now() });
      }, { parallel: true, readOnly: true, priority: 10 }, "fast-plugin");

      await hd.dispatch("post-response", {});

      const serialTime = events.find((e) => e.id === "serial-150")!.time;
      const parallelTime = events.find((e) => e.id === "parallel-10")!.time;
      assertEquals(parallelTime >= serialTime, true,
        "Parallel handler with lower priority should NOT preempt serial handler");
    });
  });

  // 5.3 Parallel error isolation
  await t.step("5.3 parallel errors: all 5 settle, 2 errors logged, dispatch resolves", async () => {
    await withSilencedConsole(async ({ errorCalls }) => {
      const hd = new HookDispatcher();
      const settled: string[] = [];

      for (let i = 0; i < 5; i++) {
        const id = `h${i}`;
        const shouldThrow = i === 1 || i === 3;
        hd.register("post-response", async () => {
          settled.push(id);
          if (shouldThrow) throw new Error(`fail-${id}`);
        }, { parallel: true, readOnly: true, priority: 100 + i }, `plugin-${id}`);
      }

      await hd.dispatch("post-response", {});

      // All 5 settled
      assertEquals(settled.length, 5);
      // log.error called 2x with dispatchPhase: "parallel"
      const parallelErrors = countCallsContaining(errorCalls, '"parallel"');
      assertEquals(parallelErrors, 2);
    });
  });

  // 5.4 Serial mutator regression
  await t.step("5.4 serial handler mutates context.preContent, same reference returned", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("pre-write", async (ctx) => {
        ctx.preContent = "<user_message>test</user_message>";
      });

      const ctx: Record<string, unknown> = { preContent: "" };
      const result = await hd.dispatch("pre-write", ctx);
      assertEquals(result.preContent, "<user_message>test</user_message>");
      assertStrictEquals(result, ctx);
    });
  });

  // 5.5 Logger isolation (parallel)
  await t.step("5.5 parallel handlers receive isolated loggers with own plugin name", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const loggers: unknown[] = [];

      hd.register("post-response", async (ctx) => {
        loggers.push(ctx.logger);
      }, { parallel: true, readOnly: true }, "plugin-alpha");
      hd.register("post-response", async (ctx) => {
        loggers.push(ctx.logger);
      }, { parallel: true, readOnly: true }, "plugin-beta");

      const baseCtx: Record<string, unknown> = {};
      await hd.dispatch("post-response", baseCtx);

      assertEquals(loggers.length, 2);
      // Each gets a different logger instance
      assertEquals(loggers[0] !== loggers[1], true, "Loggers should be different instances");
      // Base context.logger should not be set to either parallel handler's logger
      // (parallel handlers use Proxy views, writes to "logger" are no-ops)
    });
  });

  // 5.6 Allowlist enforcement
  await t.step("5.6a pre-write parallel:true readOnly:true → coerced to serial + warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();
      const ran: string[] = [];

      hd.register("pre-write", async () => { ran.push("serial-first"); }, 50);
      hd.register("pre-write", async () => { ran.push("coerced"); },
        { parallel: true, readOnly: true, priority: 60 }, "coerced-plugin");

      await hd.dispatch("pre-write", {});

      // Coerced to serial: runs in priority order
      assertEquals(ran, ["serial-first", "coerced"]);
      // Warn about PARALLEL_ALLOWED
      assertEquals(countCallsContaining(warnCalls, "PARALLEL_ALLOWED") >= 1, true);
    });
  });

  await t.step("5.6b post-response parallel:true readOnly:false → coerced + warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {},
        { parallel: true, readOnly: false, priority: 100 }, "no-ro-plugin");

      await hd.dispatch("post-response", {});
      assertEquals(countCallsContaining(warnCalls, "readOnly:true") >= 1, true);
    });
  });

  await t.step("5.6c post-response parallel:true readOnly:true → accepted as parallel", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {},
        { parallel: true, readOnly: true }, "ok-plugin");

      // No PARALLEL_ALLOWED or readOnly warn
      const allowlistWarns = countCallsContaining(warnCalls, "PARALLEL_ALLOWED");
      const readOnlyWarns = countCallsContaining(warnCalls, "readOnly:true");
      assertEquals(allowlistWarns, 0);
      assertEquals(readOnlyWarns, 0);

      
      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m.length, 1);
      assertEquals(m[0]!.parallelCount, 1);
    });
  });

  // 5.7 response-stream
  await t.step("5.7a response-stream parallel:true readOnly:true → accepted", async () => {
    await withSilencedConsole(async ({ errorCalls }) => {
      const hd = new HookDispatcher();
      hd.register("response-stream", async () => {},
        { parallel: true, readOnly: true }, "stream-ok");

      await hd.dispatch("response-stream", {});
      // No error logged about readOnly
      assertEquals(countCallsContaining(errorCalls, "readOnly:true"), 0);
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.parallelCount, 1);
    });
  });

  await t.step("5.7b response-stream parallel:true no readOnly → rejected + log.error", async () => {
    await withSilencedConsole(async ({ errorCalls }) => {
      const hd = new HookDispatcher();
      hd.register("response-stream", async () => {},
        { parallel: true, readOnly: false }, "stream-bad");

      await hd.dispatch("response-stream", {});
      assertEquals(countCallsContaining(errorCalls, "readOnly:true") >= 1, true);
      // Falls to serial
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.parallelCount, 0);
      assertEquals(m[0]!.serialCount, 1);
    });
  });

  await t.step("5.7c two parallel readOnly observers: timestamps overlap (actually parallel)", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const timestamps: { id: string; start: number; end: number }[] = [];

      hd.register("post-response", async () => {
        const start = performance.now();
        await new Promise((r) => setTimeout(r, 30));
        timestamps.push({ id: "obs1", start, end: performance.now() });
      }, { parallel: true, readOnly: true }, "obs1");
      hd.register("post-response", async () => {
        const start = performance.now();
        await new Promise((r) => setTimeout(r, 30));
        timestamps.push({ id: "obs2", start, end: performance.now() });
      }, { parallel: true, readOnly: true }, "obs2");

      await hd.dispatch("post-response", {});

      assertEquals(timestamps.length, 2);
      const a = timestamps[0]!;
      const b = timestamps[1]!;
      // They should overlap: a.start < b.end && b.start < a.end
      assertEquals(a.start < b.end && b.start < a.end, true,
        "Parallel observers should have overlapping time ranges");
    });
  });

  await t.step("5.7d response-stream: next chunk not blocked by previous parallel handlers", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const chunkStarts: number[] = [];

      hd.register("response-stream", async () => {
        await new Promise((r) => setTimeout(r, 50));
      }, { parallel: true, readOnly: true }, "slow-observer");

      // Dispatch two chunks rapidly
      const t0 = performance.now();
      await hd.dispatch("response-stream", { chunk: 1 });
      chunkStarts.push(performance.now() - t0);
      await hd.dispatch("response-stream", { chunk: 2 });
      chunkStarts.push(performance.now() - t0);

      // response-stream parallel is fire-and-forget, so dispatch returns quickly
      // Second chunk start should be close to first (no 50ms back-pressure)
      assertEquals(chunkStarts[1]! - chunkStarts[0]! < 40, true,
        "Next chunk should not wait for previous parallel handlers");
      // Wait for background promises to settle
      await new Promise((r) => setTimeout(r, 80));
    });
  });

  // 5.8 HOOK_DEBUG write detector
  await t.step("5.8 HOOK_DEBUG: parallel write triggers log.warn with mutatedKey", async () => {
    Deno.env.set("HOOK_DEBUG", "1");
    try {
      await withSilencedConsole(async ({ warnCalls }) => {
        const hd = new HookDispatcher();
        hd.register("post-response", async (ctx) => {
          ctx.foo = 1;
        }, { parallel: true, readOnly: true }, "debug-writer");

        await hd.dispatch("post-response", {});

        const mutationWarns = countCallsContaining(warnCalls, "mutatedKey");
        assertEquals(mutationWarns >= 1, true, "Should warn about readOnly violation");
        // Check specific content
        const warnStr = warnCalls.find((a) =>
          typeof a[0] === "string" && a[0].includes("mutatedKey"))![0] as string;
        assertEquals(warnStr.includes('"foo"'), true);
        assertEquals(warnStr.includes('"parallel"'), true);
      });
    } finally {
      Deno.env.delete("HOOK_DEBUG");
    }
  });

  // 5.9 No-manifest backward-compat
  await t.step("5.9 no parallel options → all serial, legacy behavior", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const order: string[] = [];

      hd.register("prompt-assembly", async () => { order.push("a"); }, 50);
      hd.register("prompt-assembly", async () => { order.push("b"); }, 100);
      hd.register("prompt-assembly", async (ctx) => {
        order.push("c");
        ctx.result = "done";
      }, 150);

      const ctx: Record<string, unknown> = {};
      const result = await hd.dispatch("prompt-assembly", ctx);

      assertEquals(order, ["a", "b", "c"]);
      assertEquals(result.result, "done");
      assertStrictEquals(result, ctx);

      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.dispatchPhase, "serial");
      assertEquals(m[0]!.parallelCount, 0);
    });
  });

  // 5.10 Concurrency cap
  await t.step("5.10a concurrency:1 → 4 parallel handlers run sequentially", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const DELAY = 30;
      const events: { id: number; start: number }[] = [];

      for (let i = 0; i < 4; i++) {
        hd.register("post-response", async () => {
          events.push({ id: i, start: performance.now() });
          await new Promise((r) => setTimeout(r, DELAY));
        }, { parallel: true, readOnly: true, concurrency: 1 }, `conc1-${i}`);
      }

      const t0 = performance.now();
      await hd.dispatch("post-response", {});
      const elapsed = performance.now() - t0;

      assertEquals(events.length, 4);
      // Wall-time should be ≈ 4×DELAY (sequential)
      assertEquals(elapsed >= DELAY * 3.5, true,
        `Expected ≈${DELAY * 4}ms, got ${elapsed}ms`);
    });
  });

  await t.step("5.10b concurrency:2 → 4 handlers in 2 chunks", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const DELAY = 30;

      for (let i = 0; i < 4; i++) {
        hd.register("post-response", async () => {
          await new Promise((r) => setTimeout(r, DELAY));
        }, { parallel: true, readOnly: true, concurrency: 2 }, `conc2-${i}`);
      }

      const t0 = performance.now();
      await hd.dispatch("post-response", {});
      const elapsed = performance.now() - t0;

      // Wall-time should be ≈ 2×DELAY (2 chunks of 2)
      assertEquals(elapsed >= DELAY * 1.8, true, `Too fast: ${elapsed}ms`);
      assertEquals(elapsed < DELAY * 3.5, true, `Too slow: ${elapsed}ms`);
    });
  });

  await t.step("5.10c multiple entries with different concurrency → min taken", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const DELAY = 20;
      const concurrent: number[] = [];

      let running = 0;
      for (let i = 0; i < 4; i++) {
        const conc = i < 2 ? 2 : 4; // entries with 2 and 4 → min = 2
        hd.register("post-response", async () => {
          running++;
          concurrent.push(running);
          await new Promise((r) => setTimeout(r, DELAY));
          running--;
        }, { parallel: true, readOnly: true, concurrency: conc }, `conc-mix-${i}`);
      }

      await hd.dispatch("post-response", {});

      // Max concurrent should be 2 (min of declared concurrencies)
      const maxConcurrent = Math.max(...concurrent);
      assertEquals(maxConcurrent <= 2, true, `Max concurrent was ${maxConcurrent}, expected ≤ 2`);
    });
  });

  await t.step("5.10d no concurrency declared → unbounded", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const DELAY = 30;

      for (let i = 0; i < 4; i++) {
        hd.register("post-response", async () => {
          await new Promise((r) => setTimeout(r, DELAY));
        }, { parallel: true, readOnly: true }, `no-conc-${i}`);
      }

      const t0 = performance.now();
      await hd.dispatch("post-response", {});
      const elapsed = performance.now() - t0;

      // Unbounded: all 4 run at once → wall-time ≈ 1×DELAY
      assertEquals(elapsed < DELAY * 2, true,
        `Expected unbounded parallel (≈${DELAY}ms), got ${elapsed}ms`);
    });
  });

  // 5.11 Concurrency coercion
  await t.step("5.11 invalid concurrency values coerced to undefined + log.warn", async () => {
    const badValues = [0, -1, 1.5, "two" as unknown as number];

    for (const val of badValues) {
      await withSilencedConsole(async ({ warnCalls }) => {
        const hd = new HookDispatcher();
        hd.register("post-response", async () => {},
          { parallel: true, readOnly: true, concurrency: val } as Parameters<typeof hd.register>[2],
          `coerce-${val}`);

        assertEquals(countCallsContaining(warnCalls, "concurrency") >= 1, true,
          `concurrency:${val} should trigger warn`);

        // Should still dispatch without issues (unbounded fallback)
        await hd.dispatch("post-response", {});
      });
    }
  });

  // 5.12 dependsOn topo order
  await t.step("5.12 dependsOn: b settles before a starts", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const events: { id: string; time: number }[] = [];

      hd.register("post-response", async () => {
        await new Promise((r) => setTimeout(r, 20));
        events.push({ id: "b", time: performance.now() });
      }, { parallel: true, readOnly: true, priority: 100 }, "b");

      hd.register("post-response", async () => {
        events.push({ id: "a", time: performance.now() });
      }, { parallel: true, readOnly: true, priority: 100, dependsOn: ["b"] }, "a");

      await hd.dispatch("post-response", {});

      assertEquals(events.length, 2);
      const bTime = events.find((e) => e.id === "b")!.time;
      const aTime = events.find((e) => e.id === "a")!.time;
      assertEquals(aTime >= bTime, true, "a should start after b settles");
    });
  });

  // 5.13 dependsOn cycle reject
  await t.step("5.13 dependsOn cycle: log.error, fallback to priority-only", async () => {
    await withSilencedConsole(async ({ errorCalls }) => {
      const hd = new HookDispatcher();
      const order: string[] = [];

      hd.register("post-response", async () => {
        order.push("a");
      }, { parallel: true, readOnly: true, priority: 50, dependsOn: ["b"] }, "a");

      hd.register("post-response", async () => {
        order.push("b");
      }, { parallel: true, readOnly: true, priority: 100, dependsOn: ["a"] }, "b");

      await hd.dispatch("post-response", {});

      // Both should still run (fallback to priority-only in single layer)
      assertEquals(order.length, 2);
      // log.error about cycle
      assertEquals(countCallsContaining(errorCalls, "cycle") >= 1, true,
        "Should log.error about cycle detection");
    });
  });

  // 5.14 dependsOn unknown reject
  await t.step("5.14 dependsOn unknown plugin: log.error, fallback to priority-only", async () => {
    await withSilencedConsole(async ({ errorCalls }) => {
      const hd = new HookDispatcher();
      const order: string[] = [];

      hd.register("post-response", async () => {
        order.push("a");
      }, { parallel: true, readOnly: true, priority: 100, dependsOn: ["ghost"] }, "a");

      hd.register("post-response", async () => {
        order.push("other");
      }, { parallel: true, readOnly: true, priority: 50 }, "other");

      await hd.dispatch("post-response", {});

      assertEquals(order.length, 2);
      assertEquals(countCallsContaining(errorCalls, "unknown") >= 1, true,
        "Should log.error about unknown dep");
    });
  });

  // 5.15 Track B default-on
  await t.step("5.15a readOnly:true no parallel → treated as parallel (Track B)", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();

      hd.register("post-response", async () => {},
        { readOnly: true }, "trackb-plugin");

      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.parallelCount, 1, "readOnly:true should auto-promote to parallel");
      assertEquals(m[0]!.serialCount, 0);
    });
  });

  await t.step("5.15b readOnly:true parallel:false → serial (explicit opt-out)", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();

      hd.register("post-response", async () => {},
        { readOnly: true, parallel: false }, "optout-plugin");

      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.serialCount, 1, "explicit parallel:false should remain serial");
      assertEquals(m[0]!.parallelCount, 0);
    });
  });

  await t.step("5.15c readOnly:false → serial", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();

      hd.register("post-response", async () => {},
        { readOnly: false }, "no-ro-plugin");

      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.serialCount, 1);
      assertEquals(m[0]!.parallelCount, 0);
    });
  });

  // 5.16 Priority<100 warn
  await t.step("5.16 parallel:true priority:50 → log.warn about priority", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();

      hd.register("post-response", async () => {},
        { parallel: true, readOnly: true, priority: 50 }, "low-prio-plugin");

      assertEquals(countCallsContaining(warnCalls, "priority") >= 1, true,
        "Should warn about priority < 100 for parallel handler");

      // Handler should still be registered as parallel
      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.parallelCount, 1);
    });
  });

  // 5.17 register() overload
  await t.step("5.17a register(stage, h, 50) ≡ register(stage, h, { priority: 50 })", async () => {
    await withSilencedConsole(async () => {
      const hd1 = new HookDispatcher();
      const hd2 = new HookDispatcher();
      const order1: string[] = [];
      const order2: string[] = [];

      hd1.register("prompt-assembly", async () => { order1.push("a"); }, 50);
      hd1.register("prompt-assembly", async () => { order1.push("b"); }, 200);

      hd2.register("prompt-assembly", async () => { order2.push("a"); }, { priority: 50 });
      hd2.register("prompt-assembly", async () => { order2.push("b"); }, { priority: 200 });

      await hd1.dispatch("prompt-assembly", {});
      await hd2.dispatch("prompt-assembly", {});

      assertEquals(order1, order2);
    });
  });

  await t.step("5.17b register with parallel:false overrides Track B → serial", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();

      hd.register("post-response", async () => {},
        { readOnly: true, parallel: false }, "override-plugin");

      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.serialCount, 1);
      assertEquals(m[0]!.parallelCount, 0);
    });
  });

  await t.step("5.17c register with dependsOn unions with existing", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const events: { id: string; time: number }[] = [];

      hd.register("post-response", async () => {
        await new Promise((r) => setTimeout(r, 10));
        events.push({ id: "c", time: performance.now() });
      }, { parallel: true, readOnly: true }, "c");

      hd.register("post-response", async () => {
        events.push({ id: "a", time: performance.now() });
      }, { parallel: true, readOnly: true, dependsOn: ["c"] }, "a");

      await hd.dispatch("post-response", {});

      const cTime = events.find((e) => e.id === "c")!.time;
      const aTime = events.find((e) => e.id === "a")!.time;
      assertEquals(aTime >= cTime, true, "a should depend on c");
    });
  });

  await t.step("5.17d register pre-write parallel:true readOnly:true → coerce + warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();

      hd.register("pre-write", async () => {},
        { parallel: true, readOnly: true }, "pw-plugin");

      assertEquals(countCallsContaining(warnCalls, "PARALLEL_ALLOWED") >= 1, true);

      await hd.dispatch("pre-write", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.serialCount, 1);
      assertEquals(m[0]!.parallelCount, 0);
    });
  });

  await t.step("5.17e register response-stream parallel:true no readOnly → reject + log.error", async () => {
    await withSilencedConsole(async ({ errorCalls }) => {
      const hd = new HookDispatcher();

      hd.register("response-stream", async () => {},
        { parallel: true }, "stream-bad-plugin");

      assertEquals(countCallsContaining(errorCalls, "readOnly:true") >= 1, true);

      await hd.dispatch("response-stream", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.serialCount, 1);
      assertEquals(m[0]!.parallelCount, 0);
    });
  });

  // 5.19 response-stream 5ms soft warn
  await t.step("5.19 response-stream sliding window warn after 50 samples > 5ms", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();

      hd.register("response-stream", async () => {
        await new Promise((r) => setTimeout(r, 10));
      }, { parallel: true, readOnly: true }, "slow-stream-handler");

      // Dispatch 51 chunks
      for (let i = 0; i < 51; i++) {
        await hd.dispatch("response-stream", { chunk: i });
        // Small delay to let fire-and-forget promises settle
        await new Promise((r) => setTimeout(r, 15));
      }

      // Warn should fire once with avgMs >= 5 and samples: 50
      const streamWarns = warnCalls.filter((a) =>
        typeof a[0] === "string" && a[0].includes("5ms"));
      assertEquals(streamWarns.length >= 1, true,
        "Should warn about response-stream handlers exceeding 5ms average");

      // Subsequent dispatches should NOT warn again (debounce)
      const warnCountBefore = streamWarns.length;
      for (let i = 0; i < 5; i++) {
        await hd.dispatch("response-stream", { chunk: 100 + i });
        await new Promise((r) => setTimeout(r, 15));
      }
      const streamWarnsAfter = warnCalls.filter((a) =>
        typeof a[0] === "string" && a[0].includes("5ms"));
      assertEquals(streamWarnsAfter.length, warnCountBefore,
        "Should not warn again (debounce until crossing below threshold)");
    });
  });
});

// ---------------------------------------------------------------------------
// Per-handler event subscription surface (add-hook-observability change)
// ---------------------------------------------------------------------------

Deno.test("HookDispatcher per-handler events", async (t) => {
  await t.step("emits handler-start before handler-end (serial)", async () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async () => {});
    const events: string[] = [];
    hd.subscribeHandlerEvents((ev) => {
      events.push(ev.kind);
    });
    await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
    assertEquals(events, ["handler-start", "handler-end"]);
  });

  await t.step("snapshots are deep clones independent of live context", async () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async (ctx: Record<string, unknown>) => {
      const arr = ctx.previousContext as string[];
      arr.push("added-by-handler");
    });
    let startSnap: unknown;
    let endSnap: unknown;
    hd.subscribeHandlerEvents((ev) => {
      if (ev.kind === "handler-start") startSnap = ev.ctxBeforeSnapshot;
      else endSnap = ev.ctxAfterSnapshot;
    });
    const ctx = { previousContext: ["a"], rawChapters: [] };
    await hd.dispatch("prompt-assembly", ctx);
    // Live context now has 2 items; start snapshot has 1; end snapshot has 2.
    assertEquals((ctx.previousContext as string[]).length, 2);
    assertEquals(((startSnap as Record<string, unknown>).previousContext as string[]).length, 1);
    assertEquals(((endSnap as Record<string, unknown>).previousContext as string[]).length, 2);
    // Mutating the snapshot does NOT change live context.
    ((endSnap as Record<string, unknown>).previousContext as string[]).push("snap-only");
    assertEquals((ctx.previousContext as string[]).length, 2);
  });

  await t.step("detects reassignment via ctxAfterRefs !== ctxBeforeRefs", async () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async (ctx: Record<string, unknown>) => {
      // Reassign field, do not mutate in place.
      ctx.previousContext = ["replaced"];
    });
    let reassigned: readonly string[] | undefined;
    hd.subscribeHandlerEvents((ev) => {
      if (ev.kind === "handler-end") reassigned = ev.reassigned;
    });
    await hd.dispatch("prompt-assembly", { previousContext: ["original"], rawChapters: [] });
    assertEquals(reassigned, ["previousContext"]);
  });

  await t.step("mutation in place does NOT mark reassigned", async () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async (ctx: Record<string, unknown>) => {
      (ctx.previousContext as string[]).push("appended");
    });
    let reassigned: readonly string[] | undefined;
    hd.subscribeHandlerEvents((ev) => {
      if (ev.kind === "handler-end") reassigned = ev.reassigned;
    });
    await hd.dispatch("prompt-assembly", { previousContext: ["x"], rawChapters: [] });
    assertEquals(reassigned, []);
  });

  await t.step("propagates handler error via event.error", async () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async () => {
      throw new Error("boom");
    });
    let captured: { message: string; name: string } | undefined;
    hd.subscribeHandlerEvents((ev) => {
      if (ev.kind === "handler-end") captured = ev.error;
    });
    await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
    assertEquals(captured?.message, "boom");
    assertEquals(captured?.name, "Error");
  });

  await t.step("emits for pre-llm-fetch stage (serial-only)", async () => {
    const hd = new HookDispatcher();
    hd.register("pre-llm-fetch", async () => {});
    const stages: string[] = [];
    hd.subscribeHandlerEvents((ev) => {
      if (ev.kind === "handler-start") stages.push(ev.stage);
    });
    await hd.dispatch("pre-llm-fetch", {
      correlationId: "test-cid",
      messages: [],
      model: "stub",
      requestMetadata: {},
    });
    assertEquals(stages, ["pre-llm-fetch"]);
  });

  await t.step("isolates subscriber throws + auto-unsubscribes after 2 consecutive", async () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async () => {});
    let calls = 0;
    const throwingCb = () => {
      calls++;
      throw new Error("subscriber-bad");
    };
    let cleanCalls = 0;
    const cleanCb = () => {
      cleanCalls++;
    };
    hd.subscribeHandlerEvents(throwingCb);
    hd.subscribeHandlerEvents(cleanCb);
    // 1st dispatch: start+end both throw (2 events = 2 throws) → unsubscribed
    await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
    const callsAfter1 = calls;
    // 2nd dispatch: throwingCb should NOT be called
    await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
    assertEquals(calls, callsAfter1, "auto-unsubscribed after 2 consecutive throws");
    // Clean subscriber received all 4 events (2 per dispatch)
    assertEquals(cleanCalls, 4);
  });

  await t.step("zero subscribers => no snapshot built (gate works)", async () => {
    const hd = new HookDispatcher();
    let cloned = false;
    // Sentinel object whose getter side-effects on access — proves the
    // dispatcher does not enumerate allowlist fields when no subscribers.
    const ctx: Record<string, unknown> = {};
    Object.defineProperty(ctx, "previousContext", {
      get() {
        cloned = true;
        return [];
      },
      enumerable: true,
    });
    Object.defineProperty(ctx, "rawChapters", { value: [], enumerable: true });
    hd.register("prompt-assembly", async () => {});
    await hd.dispatch("prompt-assembly", ctx);
    assertEquals(cloned, false, "no subscriber => allowlist getter never invoked");
  });

  await t.step("unsubscribe removes subscriber", async () => {
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async () => {});
    let count = 0;
    const cb = () => { count++; };
    hd.subscribeHandlerEvents(cb);
    await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
    assertEquals(count, 2);
    hd.unsubscribeHandlerEvents(cb);
    await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
    assertEquals(count, 2);
  });

  await t.step("QUALITY-5: non-cloneable allowlist field yields sentinel, dispatch completes", async () => {
    const hd = new HookDispatcher();
    // Handler stashes a function on previousContext (non-cloneable).
    hd.register("prompt-assembly", async (ctx) => {
      (ctx as Record<string, unknown>).previousContext = () => "I am a function";
    });
    const events: Array<{ kind: string; ctxAfterSnapshot?: unknown }> = [];
    hd.subscribeHandlerEvents((ev) => {
      if (ev.kind === "handler-end") {
        events.push({ kind: ev.kind, ctxAfterSnapshot: ev.ctxAfterSnapshot });
      }
    });
    // Dispatch must NOT throw.
    await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
    assertEquals(events.length, 1);
    const snap = events[0]!.ctxAfterSnapshot as Record<string, unknown>;
    // The non-cloneable field has a sentinel; rawChapters cloned normally.
    const pc = snap.previousContext as { __snapshotError?: string };
    assertEquals(typeof pc.__snapshotError, "string");
    assertEquals(Array.isArray(snap.rawChapters), true);
  });

  await t.step("QUALITY-8: getHandlerEventSubscribers returns plugin → kinds", () => {
    const hd = new HookDispatcher();
    const cbStart = () => {};
    const cbEnd = () => {};
    const cbAnon = () => {};
    hd.subscribeHandlerEvents(cbStart, { plugin: "alpha", kind: "handler-start" });
    hd.subscribeHandlerEvents(cbEnd, { plugin: "alpha", kind: "handler-end" });
    hd.subscribeHandlerEvents(cbAnon);
    const subs = hd.getHandlerEventSubscribers();
    assertEquals(subs.alpha!.sort(), ["handler-end", "handler-start"]);
    assertEquals(subs["<anonymous>"], ["handler-end", "handler-start"]);
    hd.unsubscribeHandlerEvents(cbEnd);
    const subs2 = hd.getHandlerEventSubscribers();
    assertEquals(subs2.alpha, ["handler-start"]);
  });
});

// =============================================================================
// pre-llm-fetch parallel-eligibility (enhance-hook-parallel-controls)
// =============================================================================

Deno.test("HookDispatcher — pre-llm-fetch parallel eligibility", async (t) => {
  const { _resetThrottleWarnDedupForTesting } = await import("../../../writer/lib/hooks.ts");

  await t.step("pre-llm-fetch accepts {parallel:true, readOnly:true} without coercion warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register(
        "pre-llm-fetch",
        async () => {},
        { parallel: true, readOnly: true },
        "obs-plugin",
      );
      // Must NOT trigger the PARALLEL_ALLOWED rejection warn.
      assertEquals(
        countCallsContaining(warnCalls, "PARALLEL_ALLOWED"),
        0,
        "pre-llm-fetch should be in PARALLEL_ALLOWED",
      );
      const intro = hd.introspect();
      assertEquals(intro["pre-llm-fetch"]![0]!.parallel, true);
    });
  });

  await t.step("pre-llm-fetch {readOnly:true} auto-promotes to parallel (Track B)", async () => {
    await withSilencedConsole(async () => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register(
        "pre-llm-fetch",
        async () => {},
        { readOnly: true },
        "auto-promote-plugin",
      );
      const intro = hd.introspect();
      assertEquals(intro["pre-llm-fetch"]![0]!.parallel, true);
    });
  });

  await t.step("parallel handler push() on ctx.messages throws TypeError (deep-frozen)", async () => {
    await withSilencedConsole(async () => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      let caught: unknown;
      hd.register("pre-llm-fetch", async (ctx) => {
        try {
          (ctx.messages as unknown as Array<unknown>).push({ role: "system", content: "rogue" });
        } catch (e) {
          caught = e;
          throw e;
        }
      }, { parallel: true, readOnly: true }, "mutator");
      // Simulate the dispatch-site freeze invariant by freezing messages here.
      const msgs = Object.freeze([{ role: "user", content: "hi" }]);
      await hd.dispatch("pre-llm-fetch", { messages: msgs });
      assertEquals(caught instanceof TypeError, true, "push on frozen array should throw TypeError");
    });
  });

  await t.step("parallel handler mutating nested message field throws (deep-frozen)", async () => {
    await withSilencedConsole(async () => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      let caught: unknown;
      hd.register("pre-llm-fetch", async (ctx) => {
        try {
          (ctx.messages as Array<{ role: string }>)[0]!.role = "x";
        } catch (e) {
          caught = e;
          throw e;
        }
      }, { parallel: true, readOnly: true }, "nested-mutator");
      // Deep-freeze the nested element (mirrors chat-shared deepFreeze).
      const msg0 = Object.freeze({ role: "user", content: "hi" });
      const msgs = Object.freeze([msg0]);
      await hd.dispatch("pre-llm-fetch", { messages: msgs });
      assertEquals(caught instanceof TypeError, true, "nested freeze should throw TypeError");
    });
  });

  await t.step("parallel handler reassigning ctx.model does NOT throw (outer not frozen, observe-only)", async () => {
    await withSilencedConsole(async () => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      let errored = false;
      hd.register("pre-llm-fetch", async (ctx) => {
        try {
          (ctx as Record<string, unknown>).model = "tampered";
        } catch {
          errored = true;
        }
      }, { parallel: true, readOnly: true }, "outer-mutator");
      await hd.dispatch("pre-llm-fetch", { model: "real-model", messages: Object.freeze([]) });
      assertEquals(errored, false, "reassigning outer-context field must not throw");
    });
  });
});

// =============================================================================
// Registration-time throttle warning (enhance-hook-parallel-controls)
// =============================================================================

Deno.test("HookDispatcher — register-time throttle warning", async (t) => {
  const { _resetThrottleWarnDedupForTesting } = await import("../../../writer/lib/hooks.ts");

  await t.step("finite-vs-unbounded: exactly one warn emitted on second registration", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "throttle-a");
      // First registration alone: must NOT warn.
      assertEquals(countCallsContaining(warnCalls, "'prompt-assembly' parallel bucket"), 0);
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "throttle-b");
      const warns = countCallsContaining(warnCalls, "'prompt-assembly' parallel bucket");
      assertEquals(warns, 1, "Exactly one throttle warn must be emitted");
      // Warn should cite both plugins.
      const warnLine = warnCalls.find((a) =>
        typeof a[0] === "string" && a[0].includes("'prompt-assembly' parallel bucket"))![0] as string;
      assertEquals(warnLine.includes("throttle-a"), true);
      assertEquals(warnLine.includes("throttle-b"), true);
    });
  });

  await t.step("finite-1 vs finite-5: warn names plugin-1 as throttler", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 5 }, "high-cap");
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "low-cap");
      const warnLine = warnCalls.find((a) =>
        typeof a[0] === "string" && a[0].includes("'prompt-assembly' parallel bucket"));
      assertEquals(warnLine !== undefined, true);
      const msg = warnLine![0] as string;
      // low-cap is the throttler (declared 1).
      assertEquals(msg.includes("low-cap (concurrency=1)"), true, msg);
      // high-cap is the slowed peer (declared 5).
      assertEquals(msg.includes("high-cap"), true);
    });
  });

  await t.step("same finite cap on both → no throttle warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 2 }, "same-a");
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 2 }, "same-b");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 0);
    });
  });

  await t.step("dedup: identical (stage, plugin, concurrency) registered twice → one warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "dedup-peer");
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "dedup-target");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 1);
      // Re-register the same plugin with same concurrency — dedup kicks in.
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "dedup-target");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 1, "dedup must keep count at 1");
    });
  });

  await t.step("dedup-key discrimination: same plugin different concurrency → two warns", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "discrim-peer");
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "discrim-target");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 1);
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 2 }, "discrim-target");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 2,
        "different concurrency must produce a new warn");
    });
  });

  await t.step("_resetThrottleWarnDedupForTesting() clears dedup so warns re-emit", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "reset-peer");
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "reset-target");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 1);
      // Re-registration WITHOUT reset → still 1.
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "reset-target");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 1);
      // After reset on a fresh dispatcher → fires again.
      _resetThrottleWarnDedupForTesting();
      const hd2 = new HookDispatcher();
      hd2.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "reset-peer");
      hd2.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "reset-target");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 2,
        "post-reset re-registration must re-emit");
    });
  });

  await t.step("serial-bucket handlers are ignored by the check", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      // Plain serial handler with no parallel options.
      hd.register("prompt-assembly", async () => {}, 100, "serial-handler");
      // Parallel handler with finite concurrency — no parallel peer, so no warn.
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "only-parallel");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 0);
    });
  });

  await t.step("reverse: existing finite + new unbounded → warn names existing as throttler, role=slowed", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true, concurrency: 1 }, "existing-cap");
      // New unbounded registration is the SLOWED party.
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "new-unbounded");
      const warnLine = warnCalls.find((a) =>
        typeof a[0] === "string" && a[0].includes("parallel bucket"));
      assertEquals(warnLine !== undefined, true, "must emit one warn");
      const msg = warnLine![0] as string;
      // existing-cap is the throttler (declared 1).
      assertEquals(msg.includes("existing-cap (concurrency=1)"), true, msg);
      // Wording must NOT claim the new unbounded plugin is throttling peers.
      assertEquals(msg.includes("which throttles peers"), false,
        `new-unbounded is the slowed party, not the throttler: ${msg}`);
      // Reverse-direction wording must surface that the bucket — including the
      // new registration — is being throttled.
      assertEquals(msg.includes("will throttle"), true,
        `must surface that the bucket is throttled: ${msg}`);
    });
  });

  await t.step("all-unbounded peers → no warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "ub-a");
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "ub-b");
      hd.register("prompt-assembly", async () => {},
        { parallel: true, readOnly: true }, "ub-c");
      assertEquals(countCallsContaining(warnCalls, "parallel bucket"), 0);
    });
  });

  await t.step("warn is emitted via injected baseLogger, not just console", async () => {
    _resetThrottleWarnDedupForTesting();
    const captured: Array<{ msg: unknown; payload: unknown }> = [];
    const baseLogger = {
      warn: (msg: unknown, payload?: unknown) => { captured.push({ msg, payload }); },
      info: () => {},
      error: () => {},
      debug: () => {},
    };
    const hd = new HookDispatcher();
    hd.register("prompt-assembly", async () => {},
      { parallel: true, readOnly: true }, "peer-a");
    hd.register(
      "prompt-assembly",
      async () => {},
      { parallel: true, readOnly: true, concurrency: 1 },
      "target",
      // deno-lint-ignore no-explicit-any
      baseLogger as any,
    );
    const throttleWarns = captured.filter((c) =>
      typeof c.msg === "string" && (c.msg as string).includes("parallel bucket"));
    assertEquals(throttleWarns.length, 1, "baseLogger.warn must receive the throttle warn");
    const payload = throttleWarns[0]!.payload as { role?: string; throttlers?: unknown[] };
    assertEquals(payload.role, "throttler");
    assertEquals(Array.isArray(payload.throttlers), true);
  });
});
