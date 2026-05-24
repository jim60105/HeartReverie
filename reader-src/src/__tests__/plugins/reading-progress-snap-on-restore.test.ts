// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Tests for plugins/reading-progress/frontend.js — the "at the top" snap
// behaviour added by the align-initial-chapter-scroll-to-content-top change.
//
// Covers:
//   * Local mode: saved scrollRatio that decodes to < 1 px leaves scrollTop
//     untouched; ratio that decodes to >= 1 px still mutates as before.
//   * Local mode: capture path at scrollTop === 0 (no anchor concept in local
//     mode, but the snap on restore must still hold even after a legacy
//     non-zero ratio is stored that decodes sub-pixel against the current
//     viewport size).
//
// File-mode restoreScroll() and captureTextFragmentAnchor() are exercised at
// a higher level by the cross-chapter / idempotency tests and by the
// container-level verification in tasks.md §4. The unit-level coverage here
// is intentionally focused on the local-mode mutation site, which is the only
// path exposed without mocking the full file-mode HTTP plumbing.

interface HookRegister {
  (stage: string, handler: (ctx: unknown) => void, priority?: number): void;
}

interface MockHooks {
  register: HookRegister;
  getSettings: () => Record<string, unknown>;
  handlers: Map<string, Array<(ctx: unknown) => void>>;
}

function createMockHooksForSnap(settings: Record<string, unknown>): MockHooks {
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

async function freshImportForSnap() {
  vi.resetModules();
  // @ts-expect-error — plain JS plugin module, no type declaration
  return await import("../../../../plugins/reading-progress/frontend.js");
}

interface ScrollHarness {
  container: HTMLElement;
  writes: number[];
  setStoredScrollTop: (value: number) => void;
  getStoredScrollTop: () => number;
}

function installScrollHarness(scrollHeight: number, innerHeight: number): ScrollHarness {
  document.body.innerHTML = "";
  const container = document.createElement("div");
  document.body.appendChild(container);

  Object.defineProperty(document.documentElement, "scrollHeight", {
    value: scrollHeight,
    configurable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: innerHeight,
    configurable: true,
  });

  const writes: number[] = [];
  let stored = 0;
  Object.defineProperty(document.documentElement, "scrollTop", {
    get() {
      return stored;
    },
    set(value: number) {
      stored = value;
      writes.push(value);
    },
    configurable: true,
  });

  return {
    container,
    writes,
    setStoredScrollTop: (value) => {
      stored = value;
    },
    getStoredScrollTop: () => stored,
  };
}

describe("reading-progress — at-the-top snap on restore", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("local mode: scrollRatio: 0 leaves scrollTop untouched", async () => {
    localStorage.setItem(
      "reading-progress:series-a/story-a",
      JSON.stringify({
        chapterIndex: 3,
        scrollRatio: 0,
        lastReadAt: "2026-05-22T00:00:00Z",
      }),
    );

    const mod = await freshImportForSnap();
    const hooks = createMockHooksForSnap({ enabled: true, storageBackend: "local" });
    mod.register(hooks, {});

    const harness = installScrollHarness(2000, 800);
    const handler = hooks.handlers.get("chapter:dom:ready")![0]!;

    handler({
      series: "series-a",
      story: "story-a",
      chapterIndex: 3,
      container: harness.container,
    });

    expect(harness.writes).toEqual([]);
    expect(harness.getStoredScrollTop()).toBe(0);
  });

  it("local mode: sub-pixel decoded savedTop snaps (no mutation) even with non-zero ratio", async () => {
    // ratio * maxScroll = 0.0005 * (2000 - 800) = 0.6 < 1 → snap branch
    localStorage.setItem(
      "reading-progress:series-a/story-a",
      JSON.stringify({
        chapterIndex: 3,
        scrollRatio: 0.0005,
        lastReadAt: "2026-05-22T00:00:00Z",
      }),
    );

    const mod = await freshImportForSnap();
    const hooks = createMockHooksForSnap({ enabled: true, storageBackend: "local" });
    mod.register(hooks, {});

    const harness = installScrollHarness(2000, 800);
    const handler = hooks.handlers.get("chapter:dom:ready")![0]!;

    handler({
      series: "series-a",
      story: "story-a",
      chapterIndex: 3,
      container: harness.container,
    });

    expect(harness.writes).toEqual([]);
    expect(harness.getStoredScrollTop()).toBe(0);
  });

  it("local mode: scrollRatio that decodes to >= 1 px still restores", async () => {
    // ratio * maxScroll = 0.5 * 1200 = 600 → normal restore
    localStorage.setItem(
      "reading-progress:series-a/story-a",
      JSON.stringify({
        chapterIndex: 3,
        scrollRatio: 0.5,
        lastReadAt: "2026-05-22T00:00:00Z",
      }),
    );

    const mod = await freshImportForSnap();
    const hooks = createMockHooksForSnap({ enabled: true, storageBackend: "local" });
    mod.register(hooks, {});

    const harness = installScrollHarness(2000, 800);
    const handler = hooks.handlers.get("chapter:dom:ready")![0]!;

    handler({
      series: "series-a",
      story: "story-a",
      chapterIndex: 3,
      container: harness.container,
    });

    expect(harness.writes.length).toBe(1);
    expect(harness.writes[0]).toBe(600);
  });

  it("local mode: missing saved progress is a no-op", async () => {
    const mod = await freshImportForSnap();
    const hooks = createMockHooksForSnap({ enabled: true, storageBackend: "local" });
    mod.register(hooks, {});

    const harness = installScrollHarness(2000, 800);
    const handler = hooks.handlers.get("chapter:dom:ready")![0]!;

    handler({
      series: "series-a",
      story: "story-a",
      chapterIndex: 3,
      container: harness.container,
    });

    expect(harness.writes).toEqual([]);
    expect(harness.getStoredScrollTop()).toBe(0);
  });
});
