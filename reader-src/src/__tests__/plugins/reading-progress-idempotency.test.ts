// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Tests for plugins/reading-progress/frontend.js — specifically the
// idempotency guard that prevents re-restoring scroll on every streaming
// chapter:dom:ready dispatch for the same (container, chapterIndex) pair.

interface HookRegister {
  (stage: string, handler: (ctx: unknown) => void, priority?: number): void;
}

interface MockHooks {
  register: HookRegister;
  getSettings: () => Record<string, unknown>;
  handlers: Map<string, Array<(ctx: unknown) => void>>;
}

function createMockHooks(settings: Record<string, unknown>): MockHooks {
  const handlers = new Map<string, Array<(ctx: unknown) => void>>();
  return {
    handlers,
    register: ((stage, handler) => {
      if (!handlers.has(stage)) handlers.set(stage, []);
      handlers.get(stage)!.push(handler);
    }) as HookRegister,
    getSettings: () => settings,
  };
}

async function freshImport() {
  vi.resetModules();
  // @ts-expect-error — plain JS plugin module, no type declaration
  return await import("../../../../plugins/reading-progress/frontend.js");
}

describe("reading-progress plugin — chapter:dom:ready idempotency", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    // Reset scroll position.
    document.body.innerHTML = "";
    Object.defineProperty(document.documentElement, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
  });

  it("local mode: two consecutive dispatches for the same (container, chapterIndex) restore scroll only once", async () => {
    // Seed localStorage with saved progress for chapter 3 at ratio 0.5.
    localStorage.setItem(
      "reading-progress:series-a/story-a",
      JSON.stringify({
        chapterIndex: 3,
        scrollRatio: 0.5,
        lastReadAt: "2026-05-22T00:00:00Z",
      }),
    );

    const mod = await freshImport();
    const hooks = createMockHooks({ enabled: true, storageBackend: "local" });
    mod.register(hooks, {});

    const handlers = hooks.handlers.get("chapter:dom:ready") ?? [];
    expect(handlers).toHaveLength(1);
    const handler = handlers[0];

    // Build a fake scroll element with a measurable scrollHeight.
    const container = document.createElement("div");
    document.body.appendChild(container);

    // Stub scrollHeight/innerHeight so the ratio math produces a non-zero
    // target. We track every scrollTop assignment to confirm the second
    // dispatch is a no-op.
    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });

    const scrollTopWrites: number[] = [];
    let storedScrollTop = 0;
    Object.defineProperty(document.documentElement, "scrollTop", {
      get() {
        return storedScrollTop;
      },
      set(value: number) {
        storedScrollTop = value;
        scrollTopWrites.push(value);
      },
      configurable: true,
    });

    const ctx = {
      series: "series-a",
      story: "story-a",
      chapterIndex: 3,
      container,
    };

    // First dispatch — should restore scroll exactly once.
    handler(ctx);
    expect(scrollTopWrites.length).toBe(1);
    expect(scrollTopWrites[0]).toBeGreaterThan(0);

    // Simulate the user scrolling away.
    storedScrollTop = 50;

    // Second dispatch (streaming chunk) — must be a no-op: no extra
    // scrollTop write, scroll position preserved.
    handler(ctx);
    expect(scrollTopWrites.length).toBe(1);
    expect(storedScrollTop).toBe(50);

    // Third dispatch — same story, but a different chapterIndex SHOULD
    // trigger a fresh restoration pass (with no saved data for chapter 4
    // there is no scroll write, but the guard branch must NOT short-circuit
    // — proved by the fact that handler doesn't throw and that
    // a fresh restore for the same chapter again would work).
    handler({ ...ctx, chapterIndex: 4 });
    // Re-dispatch chapter 3 — guard for the new (container, 3) state should
    // be gone, so we get one more restore.
    handler(ctx);
    expect(scrollTopWrites.length).toBe(2);
  });
});
