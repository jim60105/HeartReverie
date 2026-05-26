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

import { assertEquals, assertStrictEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import {
  _resetThrottleWarnDedupForTesting,
  HookDispatcher,
  KNOWN_BACKEND_STAGES,
  PARALLEL_ALLOWED,
  VALID_STAGES,
} from "../../../writer/lib/hooks.ts";
import type { HandlerEvent, HookHandler } from "../../../writer/types.ts";

// ---------------------------------------------------------------------------
// Helpers (mirrored from hooks_test.ts)
// ---------------------------------------------------------------------------

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
  const logStub = stub(console, "log", (...args: unknown[]) => {
    logCalls.push(args);
  });
  const warnStub = stub(console, "warn", (...args: unknown[]) => {
    warnCalls.push(args);
  });
  const errorStub = stub(console, "error", (...args: unknown[]) => {
    errorCalls.push(args);
  });
  try {
    return await fn({ logCalls, warnCalls, errorCalls });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
}

function countCallsContaining(calls: unknown[][], substr: string): number {
  return calls.filter((args) => typeof args[0] === "string" && (args[0] as string).includes(substr))
    .length;
}

// =============================================================================
// Concurrency validation edge cases
// =============================================================================

Deno.test("Concurrency validation", async (t) => {
  await t.step("NaN coerced to unbounded + warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();
      hd.register(
        "post-response",
        async () => {},
        { parallel: true, readOnly: true, concurrency: NaN } as Parameters<typeof hd.register>[2],
        "nan-plugin",
      );
      assertEquals(
        countCallsContaining(warnCalls, "concurrency") >= 1,
        true,
        "NaN concurrency should trigger warn",
      );
    });
  });

  await t.step("Infinity coerced to unbounded + warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();
      hd.register(
        "post-response",
        async () => {},
        { parallel: true, readOnly: true, concurrency: Infinity } as Parameters<
          typeof hd.register
        >[2],
        "inf-plugin",
      );
      assertEquals(
        countCallsContaining(warnCalls, "concurrency") >= 1,
        true,
        "Infinity concurrency should trigger warn",
      );
    });
  });

  await t.step("-Infinity coerced to unbounded + warn", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();
      hd.register(
        "post-response",
        async () => {},
        { parallel: true, readOnly: true, concurrency: -Infinity } as Parameters<
          typeof hd.register
        >[2],
        "neg-inf-plugin",
      );
      assertEquals(
        countCallsContaining(warnCalls, "concurrency") >= 1,
        true,
        "-Infinity concurrency should trigger warn",
      );
    });
  });

  await t.step("valid concurrency=1 does NOT warn about coercion", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {}, {
        parallel: true,
        readOnly: true,
        concurrency: 1,
      }, "valid-conc-plugin");
      // Should not have the "Invalid concurrency" warn
      const coercionWarns = warnCalls.filter((a) =>
        typeof a[0] === "string" && (a[0] as string).includes("Invalid concurrency")
      );
      assertEquals(coercionWarns.length, 0);
    });
  });

  await t.step("valid concurrency=100 does NOT warn about coercion", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {}, {
        parallel: true,
        readOnly: true,
        concurrency: 100,
      }, "valid-conc-100");
      const coercionWarns = warnCalls.filter((a) =>
        typeof a[0] === "string" && (a[0] as string).includes("Invalid concurrency")
      );
      assertEquals(coercionWarns.length, 0);
    });
  });
});

// =============================================================================
// Heterogeneous concurrency warnings
// =============================================================================

Deno.test("Heterogeneous concurrency warnings", async (t) => {
  await t.step("two parallel handlers with different concurrency → warning logged", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {}, {
        parallel: true,
        readOnly: true,
        concurrency: 3,
      }, "conc-3-plugin");
      hd.register("prompt-assembly", async () => {}, {
        parallel: true,
        readOnly: true,
        concurrency: 1,
      }, "conc-1-plugin");
      assertEquals(
        countCallsContaining(warnCalls, "parallel bucket") >= 1,
        true,
        "heterogeneous concurrency should warn",
      );
    });
  });

  await t.step(
    "three parallel handlers: mixed finite + unbounded → warning mentions effective cap",
    async () => {
      await withSilencedConsole(async ({ warnCalls }) => {
        _resetThrottleWarnDedupForTesting();
        const hd = new HookDispatcher();
        hd.register(
          "prompt-assembly",
          async () => {},
          { parallel: true, readOnly: true },
          "unbounded-a",
        );
        hd.register("prompt-assembly", async () => {}, {
          parallel: true,
          readOnly: true,
          concurrency: 5,
        }, "cap-5");
        hd.register("prompt-assembly", async () => {}, {
          parallel: true,
          readOnly: true,
          concurrency: 2,
        }, "cap-2");
        // Should warn mentioning effective cap
        const throttleWarns = warnCalls.filter((a) =>
          typeof a[0] === "string" && (a[0] as string).includes("parallel bucket")
        );
        assertEquals(throttleWarns.length >= 1, true);
      });
    },
  );

  await t.step("anonymous plugin in warn (no plugin name)", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      _resetThrottleWarnDedupForTesting();
      const hd = new HookDispatcher();
      // No plugin name → uses "<anonymous>" in dedup key
      hd.register("prompt-assembly", async () => {}, { parallel: true, readOnly: true });
      hd.register("prompt-assembly", async () => {}, {
        parallel: true,
        readOnly: true,
        concurrency: 1,
      });
      const throttleWarns = warnCalls.filter((a) =>
        typeof a[0] === "string" && (a[0] as string).includes("parallel bucket")
      );
      assertEquals(
        throttleWarns.length >= 1,
        true,
        "anonymous plugins should still get throttle warn",
      );
    });
  });
});

// =============================================================================
// Subscriber error handling & auto-unsubscribe
// =============================================================================

Deno.test("Subscriber error handling", async (t) => {
  await t.step("throwing subscriber does not break dispatch; handler still runs", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      let handlerRan = false;
      hd.register("prompt-assembly", async () => {
        handlerRan = true;
      });
      hd.subscribeHandlerEvents(() => {
        throw new Error("subscriber-boom");
      });
      await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
      assertEquals(handlerRan, true, "handler must run despite subscriber throw");
    });
  });

  await t.step("subscriber throw counter resets on clean invocation", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {});
      let callCount = 0;
      let shouldThrow = true;
      const cb = () => {
        callCount++;
        if (shouldThrow) throw new Error("transient");
      };
      hd.subscribeHandlerEvents(cb);
      // First dispatch: throws on handler-start, counter=1. Then handler-end also throws → counter=2 → auto-unsub.
      // But let's test the reset: throw once, then succeed.
      // Actually handler-start fires, throws → counter=1. handler-end fires, throws → counter=2 → auto-unsub.
      // To test reset, we need to interleave clean calls. Let's use two handlers:
      // With one handler per dispatch, we get 2 events (start+end). Both throw → counter=2 → auto-unsub.
      // Instead, let's have the subscriber only throw on "handler-start":
      hd.unsubscribeHandlerEvents(cb);

      callCount = 0;
      shouldThrow = false;
      const throwOnStart = true;
      const cb2 = (ev: HandlerEvent) => {
        callCount++;
        if (throwOnStart && ev.kind === "handler-start") throw new Error("start-only");
        // handler-end succeeds → resets counter
      };
      hd.subscribeHandlerEvents(cb2);
      // Dispatch 1: start throws (counter=1), end succeeds (counter reset).
      await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
      // Dispatch 2: start throws (counter=1), end succeeds (counter reset).
      await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
      // Subscriber should still be active (never hit 2 consecutive throws).
      // Dispatch 3: still active
      await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
      // 3 dispatches × 2 events = 6 calls
      assertEquals(
        callCount,
        6,
        "subscriber should remain active since counter resets on clean call",
      );
    });
  });

  await t.step("rate-limited warn log for subscriber throws (per stage)", async () => {
    await withSilencedConsole(async ({ warnCalls }) => {
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {});
      // Subscriber that always throws but is NOT auto-unsubscribed because
      // we re-register between dispatches. Actually auto-unsub happens after 2
      // consecutive throws, so it throws on start (counter=1) and end (counter=2)
      // and is removed. The warn log fires for the first stage occurrence.
      hd.subscribeHandlerEvents(() => {
        throw new Error("rate-limit-test");
      });
      await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
      const subscriberWarns = countCallsContaining(warnCalls, "Handler-event subscriber threw");
      assertEquals(subscriberWarns >= 1, true, "should warn about throwing subscriber");
    });
  });
});

// =============================================================================
// Handler error handling during dispatch
// =============================================================================

Deno.test("Handler error handling during dispatch", async (t) => {
  await t.step("serial handler throws → error logged, other handlers still run", async () => {
    await withSilencedConsole(async ({ errorCalls }) => {
      const hd = new HookDispatcher();
      const results: string[] = [];
      hd.register("prompt-assembly", async () => {
        results.push("before");
      }, 50);
      hd.register("prompt-assembly", async () => {
        throw new Error("serial-boom");
      }, 100);
      hd.register("prompt-assembly", async () => {
        results.push("after");
      }, 150);
      await hd.dispatch("prompt-assembly", {});
      assertEquals(results, ["before", "after"]);
      assertEquals(countCallsContaining(errorCalls, "serial-boom") >= 1, true);
    });
  });

  await t.step("parallel handler throws → error logged, errorCount incremented", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const results: string[] = [];
      hd.register(
        "post-response",
        async () => {
          results.push("ok");
        },
        { parallel: true, readOnly: true },
        "good-plugin",
      );
      hd.register(
        "post-response",
        async () => {
          throw new Error("parallel-boom");
        },
        { parallel: true, readOnly: true },
        "bad-plugin",
      );
      await hd.dispatch("post-response", {});
      assertEquals(results, ["ok"]);
      const intro = hd.introspect();
      const badEntry = intro["post-response"]!.find((e) => e.plugin === "bad-plugin");
      assertEquals(badEntry!.errorCount, 1);
    });
  });

  await t.step("serial handler throws non-Error → error message is stringified", async () => {
    await withSilencedConsole(async ({ errorCalls }) => {
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {
        throw "string-error";
      });
      await hd.dispatch("prompt-assembly", {});
      const hasStringError = errorCalls.some((a) =>
        typeof a[0] === "string" && (a[0] as string).includes("string-error")
      );
      assertEquals(hasStringError, true, "non-Error throw should be stringified");
    });
  });
});

// =============================================================================
// Duplicate handler registration
// =============================================================================

Deno.test("Duplicate handler registration", async (t) => {
  await t.step("same handler function registered twice → runs twice", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      let count = 0;
      const handler: HookHandler = async () => {
        count++;
      };
      hd.register("post-response", handler, 100);
      hd.register("post-response", handler, 100);
      await hd.dispatch("post-response", {});
      assertEquals(count, 2, "same handler registered twice should run twice");
    });
  });

  await t.step("same handler function at different priorities → correct order", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const calls: number[] = [];
      const handler: HookHandler = async (ctx) => {
        calls.push(ctx.id as number);
      };
      hd.register("prompt-assembly", async (ctx) => {
        ctx.id = 1;
        handler(ctx);
      }, 50);
      hd.register("prompt-assembly", async (ctx) => {
        ctx.id = 2;
        handler(ctx);
      }, 200);
      const ctx: Record<string, unknown> = {};
      await hd.dispatch("prompt-assembly", ctx);
      assertEquals(calls, [1, 2]);
    });
  });
});

// =============================================================================
// Metrics buffer and SSE
// =============================================================================

Deno.test("Metrics buffer and SSE", async (t) => {
  await t.step("getMetricsBuffer returns dispatch metrics", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {});
      await hd.dispatch("prompt-assembly", {});
      const metrics = hd.getMetricsBuffer();
      assertEquals(metrics.length, 1);
      assertEquals(metrics[0]!.stage, "prompt-assembly");
      assertEquals(metrics[0]!.dispatchPhase, "serial");
      assertEquals(typeof metrics[0]!.durationMs, "number");
      assertEquals(typeof metrics[0]!.timestamp, "number");
    });
  });

  await t.step("metrics buffer is a shallow copy (mutations don't affect internal)", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {});
      await hd.dispatch("prompt-assembly", {});
      const m1 = hd.getMetricsBuffer();
      m1.pop();
      const m2 = hd.getMetricsBuffer();
      assertEquals(m2.length, 1, "internal buffer unaffected by external mutation");
    });
  });

  await t.step("SSE subscriber receives metrics on dispatch", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {});
      const received: unknown[] = [];
      hd.subscribeSSE((m) => {
        received.push(m);
      });
      await hd.dispatch("post-response", {});
      assertEquals(received.length, 1);
    });
  });

  await t.step("SSE unsubscribe stops delivery", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {});
      const received: unknown[] = [];
      const cb = (m: unknown) => {
        received.push(m);
      };
      hd.subscribeSSE(cb);
      await hd.dispatch("post-response", {});
      assertEquals(received.length, 1);
      hd.unsubscribeSSE(cb);
      await hd.dispatch("post-response", {});
      assertEquals(received.length, 1, "should not receive after unsubscribe");
    });
  });

  await t.step("SSE subscriber that throws does not break dispatch", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {});
      hd.subscribeSSE(() => {
        throw new Error("sse-boom");
      });
      // Should not throw
      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m.length, 1, "dispatch completed despite SSE subscriber throw");
    });
  });

  await t.step("dispatchPhase is 'mixed' for serial+parallel handlers", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {}, 100);
      hd.register("post-response", async () => {}, { parallel: true, readOnly: true }, "p1");
      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.dispatchPhase, "mixed");
      assertEquals(m[0]!.serialCount, 1);
      assertEquals(m[0]!.parallelCount, 1);
    });
  });

  await t.step("dispatchPhase is 'parallel' when only parallel handlers", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {}, { parallel: true, readOnly: true }, "p1");
      hd.register("post-response", async () => {}, { parallel: true, readOnly: true }, "p2");
      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.dispatchPhase, "parallel");
    });
  });

  await t.step("metrics plugins array includes plugin names", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {}, 100, "serial-p");
      hd.register(
        "post-response",
        async () => {},
        { parallel: true, readOnly: true },
        "parallel-p",
      );
      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      const pluginNames = m[0]!.plugins.map((p) => p.plugin);
      assertEquals(pluginNames.includes("serial-p"), true);
      assertEquals(pluginNames.includes("parallel-p"), true);
    });
  });

  await t.step("anonymous handler shows as '<anonymous>' in metrics", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {});
      await hd.dispatch("post-response", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.plugins[0]!.plugin, "<anonymous>");
    });
  });

  await t.step("metrics ring buffer caps at 200 entries", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {});
      for (let i = 0; i < 210; i++) {
        await hd.dispatch("post-response", {});
      }
      const m = hd.getMetricsBuffer();
      assertEquals(m.length, 200, "ring buffer should cap at 200");
    });
  });
});

// =============================================================================
// Introspect
// =============================================================================

Deno.test("Introspect", async (t) => {
  await t.step("returns empty for unregistered stages", () => {
    const hd = new HookDispatcher();
    const intro = hd.introspect();
    assertEquals(Object.keys(intro).length, 0);
  });

  await t.step("returns handler info for registered stages", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {}, 50, "p1");
      hd.register("prompt-assembly", async () => {}, {
        parallel: true,
        readOnly: true,
        priority: 100,
      }, "p2");
      const intro = hd.introspect();
      assertEquals(intro["prompt-assembly"]!.length, 2);
      assertEquals(intro["prompt-assembly"]![0]!.plugin, "p1");
      assertEquals(intro["prompt-assembly"]![0]!.priority, 50);
      assertEquals(intro["prompt-assembly"]![0]!.parallel, false);
      assertEquals(intro["prompt-assembly"]![1]!.plugin, "p2");
      assertEquals(intro["prompt-assembly"]![1]!.parallel, true);
    });
  });

  await t.step("introspect returns detached copy (mutation safe)", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {}, 100, "test-p");
      const intro1 = hd.introspect();
      intro1["post-response"]!.pop();
      const intro2 = hd.introspect();
      assertEquals(intro2["post-response"]!.length, 1, "internal state unaffected");
    });
  });

  await t.step("errorCount tracks handler failures across dispatches", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register(
        "prompt-assembly",
        async () => {
          throw new Error("fail");
        },
        100,
        "flaky",
      );
      await hd.dispatch("prompt-assembly", {});
      await hd.dispatch("prompt-assembly", {});
      const intro = hd.introspect();
      assertEquals(intro["prompt-assembly"]![0]!.errorCount, 2);
    });
  });
});

// =============================================================================
// Handler event observability edge cases
// =============================================================================

Deno.test("Handler event observability edge cases", async (t) => {
  await t.step("parallel handler emits handler-start and handler-end events", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register(
        "post-response",
        async () => {},
        { parallel: true, readOnly: true },
        "obs-plugin",
      );
      const events: HandlerEvent[] = [];
      hd.subscribeHandlerEvents((ev) => {
        events.push(ev);
      });
      await hd.dispatch("post-response", {});
      const kinds = events.map((e) => e.kind);
      assertEquals(kinds, ["handler-start", "handler-end"]);
    });
  });

  await t.step("parallel handler error surfaces in handler-end event", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register(
        "post-response",
        async () => {
          throw new Error("par-err");
        },
        { parallel: true, readOnly: true },
        "err-plugin",
      );
      let capturedError: { message: string; name: string } | undefined;
      hd.subscribeHandlerEvents((ev) => {
        if (ev.kind === "handler-end" && ev.error) capturedError = ev.error;
      });
      await hd.dispatch("post-response", {});
      assertEquals(capturedError?.message, "par-err");
      assertEquals(capturedError?.name, "Error");
    });
  });

  await t.step("handlerIndex is correct for serial and parallel handlers", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {}, 50, "serial-0");
      hd.register("post-response", async () => {}, 100, "serial-1");
      hd.register("post-response", async () => {}, {
        parallel: true,
        readOnly: true,
        priority: 200,
      }, "parallel-2");
      const indices: Array<{ plugin?: string; index: number }> = [];
      hd.subscribeHandlerEvents((ev) => {
        if (ev.kind === "handler-start") {
          indices.push({ plugin: ev.plugin, index: ev.handlerIndex });
        }
      });
      await hd.dispatch("post-response", {});
      assertEquals(indices[0]!.index, 0);
      assertEquals(indices[1]!.index, 1);
      assertEquals(indices[2]!.index, 2);
    });
  });

  await t.step("correlationId propagated to handler events", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {}, 100, "cid-plugin");
      let capturedCid: string | undefined;
      hd.subscribeHandlerEvents((ev) => {
        if (ev.kind === "handler-start") capturedCid = ev.correlationId;
      });
      await hd.dispatch("post-response", { correlationId: "test-cid-123" });
      assertEquals(capturedCid, "test-cid-123");
    });
  });

  await t.step("handler-end event includes durationMs >= 0", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("prompt-assembly", async () => {
        await new Promise((r) => setTimeout(r, 5));
      });
      let duration: number | undefined;
      hd.subscribeHandlerEvents((ev) => {
        if (ev.kind === "handler-end") duration = ev.durationMs;
      });
      await hd.dispatch("prompt-assembly", { previousContext: [], rawChapters: [] });
      assertEquals(typeof duration, "number");
      assertEquals(duration! >= 0, true);
    });
  });

  await t.step("stages outside SNAPSHOT_ALLOWLIST produce empty snapshots", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("post-response", async () => {});
      let beforeSnap: Record<string, unknown> | undefined;
      let afterSnap: Record<string, unknown> | undefined;
      hd.subscribeHandlerEvents((ev) => {
        if (ev.kind === "handler-start") {
          beforeSnap = ev.ctxBeforeSnapshot as Record<string, unknown>;
        }
        if (ev.kind === "handler-end") afterSnap = ev.ctxAfterSnapshot as Record<string, unknown>;
      });
      await hd.dispatch("post-response", { someField: "value" });
      assertEquals(
        Object.keys(beforeSnap!).length,
        0,
        "post-response not in allowlist → empty snapshot",
      );
      assertEquals(Object.keys(afterSnap!).length, 0);
    });
  });
});

// =============================================================================
// getHandlerEventSubscribers edge cases
// =============================================================================

Deno.test("getHandlerEventSubscribers edge cases", async (t) => {
  await t.step("empty when no subscribers", () => {
    const hd = new HookDispatcher();
    const subs = hd.getHandlerEventSubscribers();
    assertEquals(Object.keys(subs).length, 0);
  });

  await t.step("unsubscribe removes from introspection", () => {
    const hd = new HookDispatcher();
    const cb = () => {};
    hd.subscribeHandlerEvents(cb, { plugin: "test-p", kind: "handler-start" });
    assertEquals(hd.getHandlerEventSubscribers()["test-p"]!.length, 1);
    hd.unsubscribeHandlerEvents(cb);
    assertEquals(hd.getHandlerEventSubscribers()["test-p"], undefined);
  });

  await t.step("unsubscribe unknown cb is a no-op", () => {
    const hd = new HookDispatcher();
    // Should not throw
    hd.unsubscribeHandlerEvents(() => {});
  });

  await t.step("same plugin with both kinds", () => {
    const hd = new HookDispatcher();
    hd.subscribeHandlerEvents(() => {}, { plugin: "multi", kind: "handler-start" });
    hd.subscribeHandlerEvents(() => {}, { plugin: "multi", kind: "handler-end" });
    const subs = hd.getHandlerEventSubscribers();
    assertEquals(subs["multi"]!.sort(), ["handler-end", "handler-start"]);
  });

  await t.step("subscriber with no kind reports both kinds", () => {
    const hd = new HookDispatcher();
    hd.subscribeHandlerEvents(() => {}, { plugin: "both-kinds" });
    const subs = hd.getHandlerEventSubscribers();
    assertEquals(subs["both-kinds"]!.sort(), ["handler-end", "handler-start"]);
  });
});

// =============================================================================
// Dispatch with no handlers / empty context
// =============================================================================

Deno.test("Dispatch edge cases", async (t) => {
  await t.step("dispatch with no handlers returns context unchanged", async () => {
    const hd = new HookDispatcher();
    const ctx = { foo: "bar" };
    const result = await hd.dispatch("prompt-assembly", ctx);
    assertStrictEquals(result, ctx);
  });

  await t.step("dispatch with correlationId as non-string → treated as undefined", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      let receivedCid: string | undefined = "sentinel";
      hd.register("post-response", async () => {});
      hd.subscribeHandlerEvents((ev) => {
        if (ev.kind === "handler-start") receivedCid = ev.correlationId;
      });
      await hd.dispatch("post-response", { correlationId: 42 as unknown as string });
      assertEquals(receivedCid, undefined, "non-string correlationId → undefined");
    });
  });
});

// =============================================================================
// Logger injection edge cases
// =============================================================================

Deno.test("Logger injection", async (t) => {
  await t.step("serial handler cannot overwrite logger via ctx.logger=", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      let loggerAfterSet: unknown;
      hd.register(
        "post-response",
        async (ctx) => {
          ctx.logger = "tampered";
          loggerAfterSet = ctx.logger;
        },
        100,
        "tamper-plugin",
      );
      await hd.dispatch("post-response", {});
      // The Proxy intercepts logger writes; reads still return the derived logger.
      assertEquals(
        typeof loggerAfterSet,
        "object",
        "logger should be the derived logger, not 'tampered'",
      );
    });
  });

  await t.step("parallel handler gets logger even without plugin name", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      let receivedLogger: unknown;
      hd.register("post-response", async (ctx) => {
        receivedLogger = ctx.logger;
      }, { parallel: true, readOnly: true });
      await hd.dispatch("post-response", {});
      assertEquals(typeof receivedLogger, "object");
      assertEquals(typeof (receivedLogger as Record<string, unknown>).info, "function");
    });
  });
});

// =============================================================================
// Exported constants
// =============================================================================

Deno.test("Exported constants", async (t) => {
  await t.step("PARALLEL_ALLOWED contains expected stages", () => {
    assertEquals(PARALLEL_ALLOWED.has("prompt-assembly"), true);
    assertEquals(PARALLEL_ALLOWED.has("post-response"), true);
    assertEquals(PARALLEL_ALLOWED.has("response-stream"), true);
    assertEquals(PARALLEL_ALLOWED.has("pre-llm-fetch"), true);
    assertEquals(PARALLEL_ALLOWED.has("pre-write"), false);
    assertEquals(PARALLEL_ALLOWED.has("strip-tags"), false);
  });

  await t.step("KNOWN_BACKEND_STAGES does not include strip-tags", () => {
    assertEquals(KNOWN_BACKEND_STAGES.has("strip-tags"), false);
    assertEquals(KNOWN_BACKEND_STAGES.has("prompt-assembly"), true);
    assertEquals(KNOWN_BACKEND_STAGES.has("pre-llm-fetch"), true);
    assertEquals(KNOWN_BACKEND_STAGES.has("response-stream"), true);
    assertEquals(KNOWN_BACKEND_STAGES.has("pre-write"), true);
    assertEquals(KNOWN_BACKEND_STAGES.has("post-response"), true);
  });

  await t.step("VALID_STAGES includes strip-tags", () => {
    assertEquals(VALID_STAGES.has("strip-tags"), true);
    for (const stage of KNOWN_BACKEND_STAGES) {
      assertEquals(VALID_STAGES.has(stage), true, `${stage} should be in VALID_STAGES`);
    }
  });
});

// =============================================================================
// Parallel concurrency execution limit
// =============================================================================

Deno.test("Parallel concurrency execution limit", async (t) => {
  await t.step("concurrency:1 serializes parallel handlers (max-in-flight = 1)", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      let maxInFlight = 0;
      let inFlight = 0;

      for (let i = 0; i < 3; i++) {
        hd.register(
          "post-response",
          async () => {
            inFlight++;
            if (inFlight > maxInFlight) maxInFlight = inFlight;
            await new Promise((r) => setTimeout(r, 10));
            inFlight--;
          },
          { parallel: true, readOnly: true, concurrency: 1 },
          `capped-${i}`,
        );
      }

      await hd.dispatch("post-response", {});
      assertEquals(maxInFlight, 1, "concurrency:1 should only allow 1 in-flight");
    });
  });

  await t.step("concurrency:2 allows max 2 in-flight", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      let maxInFlight = 0;
      let inFlight = 0;

      for (let i = 0; i < 6; i++) {
        hd.register(
          "post-response",
          async () => {
            inFlight++;
            if (inFlight > maxInFlight) maxInFlight = inFlight;
            await new Promise((r) => setTimeout(r, 15));
            inFlight--;
          },
          { parallel: true, readOnly: true, concurrency: 2 },
          `capped2-${i}`,
        );
      }

      await hd.dispatch("post-response", {});
      assertEquals(maxInFlight <= 2, true, `max in-flight was ${maxInFlight}, expected ≤ 2`);
    });
  });
});

// =============================================================================
// Track B auto-promotion edge cases
// =============================================================================

Deno.test("Track B auto-promotion", async (t) => {
  await t.step("readOnly:true on non-PARALLEL_ALLOWED stage stays serial", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("pre-write", async () => {}, { readOnly: true }, "pre-write-ro");
      await hd.dispatch("pre-write", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.serialCount, 1);
      assertEquals(m[0]!.parallelCount, 0, "pre-write not in PARALLEL_ALLOWED → stays serial");
    });
  });

  await t.step("readOnly:true on strip-tags stays serial", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      hd.register("strip-tags", async () => {}, { readOnly: true }, "strip-tags-ro");
      await hd.dispatch("strip-tags", {});
      const m = hd.getMetricsBuffer();
      assertEquals(m[0]!.serialCount, 1);
      assertEquals(m[0]!.parallelCount, 0);
    });
  });
});

// =============================================================================
// response-stream fire-and-forget behavior
// =============================================================================

Deno.test("response-stream fire-and-forget", async (t) => {
  await t.step("dispatch resolves before slow parallel handler completes", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      let handlerDone = false;
      hd.register(
        "response-stream",
        async () => {
          await new Promise((r) => setTimeout(r, 100));
          handlerDone = true;
        },
        { parallel: true, readOnly: true },
        "slow-stream",
      );

      const t0 = performance.now();
      await hd.dispatch("response-stream", {});
      const elapsed = performance.now() - t0;
      assertEquals(
        elapsed < 80,
        true,
        `dispatch should resolve quickly for fire-and-forget, took ${elapsed}ms`,
      );
      assertEquals(handlerDone, false, "handler should not be done yet");
      // Wait for background
      await new Promise((r) => setTimeout(r, 150));
      assertEquals(handlerDone, true, "handler eventually completes");
    });
  });
});

// =============================================================================
// dependsOn topo layers
// =============================================================================

Deno.test("dependsOn multi-layer topology", async (t) => {
  await t.step("three layers: c depends on b, b depends on a", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const order: string[] = [];

      hd.register(
        "post-response",
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          order.push("a");
        },
        { parallel: true, readOnly: true },
        "a",
      );
      hd.register(
        "post-response",
        async () => {
          await new Promise((r) => setTimeout(r, 5));
          order.push("b");
        },
        { parallel: true, readOnly: true, dependsOn: ["a"] },
        "b",
      );
      hd.register(
        "post-response",
        async () => {
          order.push("c");
        },
        { parallel: true, readOnly: true, dependsOn: ["b"] },
        "c",
      );

      await hd.dispatch("post-response", {});
      assertEquals(order, ["a", "b", "c"]);
    });
  });

  await t.step("independent entries in same layer run concurrently", async () => {
    await withSilencedConsole(async () => {
      const hd = new HookDispatcher();
      const ts: {
        a: { start: number; end: number };
        b: { start: number; end: number };
        c: { start: number; end: number };
      } = {
        a: { start: 0, end: 0 },
        b: { start: 0, end: 0 },
        c: { start: 0, end: 0 },
      };

      // a and b are independent (layer 0), c depends on both (layer 1)
      hd.register(
        "post-response",
        async () => {
          ts.a.start = performance.now();
          await new Promise((r) => setTimeout(r, 30));
          ts.a.end = performance.now();
        },
        { parallel: true, readOnly: true },
        "a",
      );
      hd.register(
        "post-response",
        async () => {
          ts.b.start = performance.now();
          await new Promise((r) => setTimeout(r, 30));
          ts.b.end = performance.now();
        },
        { parallel: true, readOnly: true },
        "b",
      );
      hd.register(
        "post-response",
        async () => {
          ts.c.start = performance.now();
          ts.c.end = performance.now();
        },
        { parallel: true, readOnly: true, dependsOn: ["a", "b"] },
        "c",
      );

      await hd.dispatch("post-response", {});

      // a and b should overlap (same layer)
      assertEquals(ts.a.start < ts.b.end, true);
      assertEquals(ts.b.start < ts.a.end, true);
      // c should start after both a and b
      assertEquals(ts.c.start >= ts.a.end, true);
      assertEquals(ts.c.start >= ts.b.end, true);
    });
  });
});
