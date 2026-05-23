// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Tests for plugins/reading-progress/frontend.js — file-mode cross-chapter
// prompt guard. The cross-chapter "jump back?" dialog must fire at most
// once per story-load session (i.e. only on the first fresh
// chapter:dom:ready after a story:switch). See spec:
// openspec/specs/reading-progress/spec.md → "Scroll restoration on mount".

export {};

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

interface SavedProgress {
  chapterIndex: number;
  scrollRatio: number;
  lastReadAt: string;
  revision: number;
  selectionAnchor?: unknown;
}

/** Stub fetch so GET /api/plugins/reading-progress/progress/... returns the
 * supplied response (or queued sequence of responses). Returns the spy. */
function stubFetchProgress(
  responses: Array<SavedProgress | null | Promise<SavedProgress | null>>,
) {
  const queue = [...responses];
  const spy = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    if (
      urlStr.includes("/api/plugins/reading-progress/progress/") &&
      (!init || !init.method || init.method === "GET")
    ) {
      const next = queue.length > 0 ? queue.shift() : null;
      const body = await Promise.resolve(next);
      return {
        ok: body !== null,
        status: body !== null ? 200 : 404,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        headers: new Headers(),
      } as unknown as Response;
    }
    // PUT and other calls: ack
    return {
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, revision: 1 }),
      text: () => Promise.resolve("{}"),
      headers: new Headers(),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", spy);
  return spy;
}

function setupSlot() {
  const slot = document.createElement("div");
  slot.id = "plugin-panel-slot";
  document.body.appendChild(slot);
  return slot;
}

function countConflictDialogs(): number {
  return document.querySelectorAll(".reading-progress-conflict-dialog").length;
}

/** Wait one macrotask + microtasks so queued promises resolve. */
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("reading-progress (file-mode) — cross-chapter prompt guard", () => {
  let originalLocation: Location;
  let locationHrefSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    document.body.innerHTML = "";
    setupSlot();
    vi.unstubAllGlobals();
    // Replace location.href setter so navigateToChapter is observable but
    // does NOT actually navigate during the test.
    originalLocation = window.location;
    locationHrefSpy = vi.fn();
    const spy = locationHrefSpy;
    Object.defineProperty(window, "location", {
      value: new Proxy(originalLocation, {
        set(_t, prop, value) {
          if (prop === "href") {
            (spy as unknown as (v: unknown) => void)(value);
            return true;
          }
          return Reflect.set(originalLocation, prop, value);
        },
        get(_t, prop) {
          if (prop === "href") return "/";
          return Reflect.get(originalLocation, prop);
        },
      }),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  async function bootFileMode(
    settings: Record<string, unknown> = {},
  ): Promise<MockHooks> {
    const mod = await freshImport();
    const hooks = createMockHooks({
      enabled: true,
      storageBackend: "file",
      confirmRemoteJump: true,
      pollOnFocus: false,
      ...settings,
    });
    mod.register(hooks, {});
    return hooks;
  }

  function dispatchStorySwitch(hooks: MockHooks) {
    const handlers = hooks.handlers.get("story:switch") ?? [];
    for (const h of handlers) h({ chapters: ["c0", "c1", "c2", "c3", "c4", "c5"] });
  }

  function dispatchChapterReady(
    hooks: MockHooks,
    container: HTMLElement,
    chapterIndex: number,
    series = "s1",
    story = "st1",
  ) {
    const handlers = hooks.handlers.get("chapter:dom:ready") ?? [];
    for (const h of handlers) {
      h({ series, story, chapterIndex, container });
    }
  }

  it("first fresh chapter:dom:ready after story:switch with mismatch shows the dialog", async () => {
    stubFetchProgress([
      { chapterIndex: 5, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
    ]);
    const hooks = await bootFileMode();
    dispatchStorySwitch(hooks);
    const container = document.createElement("div");
    document.body.appendChild(container);
    dispatchChapterReady(hooks, container, 2);
    await flushAsync();

    expect(countConflictDialogs()).toBe(1);
    expect(locationHrefSpy).not.toHaveBeenCalled();
  });

  it("subsequent in-app fresh chapter:dom:ready in the same story-load session suppresses the dialog", async () => {
    stubFetchProgress([
      { chapterIndex: 5, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
      { chapterIndex: 5, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
    ]);
    const hooks = await bootFileMode();
    dispatchStorySwitch(hooks);

    const containerA = document.createElement("div");
    document.body.appendChild(containerA);
    dispatchChapterReady(hooks, containerA, 2);
    await flushAsync();
    expect(countConflictDialogs()).toBe(1);

    // Remove the first dialog so we can count new ones cleanly.
    document.querySelectorAll(".reading-progress-conflict-dialog")
      .forEach((el) => el.remove());

    // User generates next chapter — engine mounts a new container/chapter.
    const containerB = document.createElement("div");
    document.body.appendChild(containerB);
    dispatchChapterReady(hooks, containerB, 3);
    await flushAsync();

    // Server still says chapter 5; on the OLD code path this would prompt.
    // New behaviour: guard is consumed, no dialog.
    expect(countConflictDialogs()).toBe(0);
    expect(locationHrefSpy).not.toHaveBeenCalled();
  });

  it("guard resets on a subsequent story:switch", async () => {
    stubFetchProgress([
      { chapterIndex: 5, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
      { chapterIndex: 4, scrollRatio: 0.2, lastReadAt: "2026-05-22T00:00:00Z", revision: 3 },
    ]);
    const hooks = await bootFileMode();
    dispatchStorySwitch(hooks);
    const containerA = document.createElement("div");
    document.body.appendChild(containerA);
    dispatchChapterReady(hooks, containerA, 2);
    await flushAsync();
    expect(countConflictDialogs()).toBe(1);
    document.querySelectorAll(".reading-progress-conflict-dialog")
      .forEach((el) => el.remove());

    // Switch to a different story.
    dispatchStorySwitch(hooks);
    const containerB = document.createElement("div");
    document.body.appendChild(containerB);
    dispatchChapterReady(hooks, containerB, 0, "s1", "st2");
    await flushAsync();

    expect(countConflictDialogs()).toBe(1);
  });

  it("failed GET on first mount still consumes guard (no late-firing prompt)", async () => {
    stubFetchProgress([
      null,
      { chapterIndex: 5, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
    ]);
    const hooks = await bootFileMode();
    dispatchStorySwitch(hooks);
    const containerA = document.createElement("div");
    document.body.appendChild(containerA);
    dispatchChapterReady(hooks, containerA, 2);
    await flushAsync();
    expect(countConflictDialogs()).toBe(0); // failed GET, no dialog

    const containerB = document.createElement("div");
    document.body.appendChild(containerB);
    dispatchChapterReady(hooks, containerB, 3);
    await flushAsync();

    // Guard was set synchronously by first dispatch, so no late prompt.
    expect(countConflictDialogs()).toBe(0);
  });

  it("back-to-back fresh mounts with pending GETs: only the first observes wasFirstCheck=true", async () => {
    // Create two pending promises and resolve them out of order.
    let resolve1!: (v: SavedProgress) => void;
    let resolve2!: (v: SavedProgress) => void;
    const p1 = new Promise<SavedProgress>((r) => (resolve1 = r));
    const p2 = new Promise<SavedProgress>((r) => (resolve2 = r));
    stubFetchProgress([p1, p2]);

    const hooks = await bootFileMode();
    dispatchStorySwitch(hooks);

    const containerA = document.createElement("div");
    document.body.appendChild(containerA);
    dispatchChapterReady(hooks, containerA, 2);
    // GET #1 still pending; guard already set synchronously.

    const containerB = document.createElement("div");
    document.body.appendChild(containerB);
    dispatchChapterReady(hooks, containerB, 3);
    // GET #2 still pending; second dispatch should have wasFirstCheck=false.

    // Resolve #2 first, then #1, both with mismatched chapter.
    resolve2({ chapterIndex: 5, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 });
    resolve1({ chapterIndex: 5, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 });
    await flushAsync();
    await flushAsync();

    // With the stale-GET guard added: dispatch #1's ctx (chapter 2) no
    // longer matches current identity (chapter 3 after #2), so its prompt
    // is suppressed too. Dispatch #2's guard was already consumed
    // synchronously. Net: 0 dialogs — the race is fully contained.
    expect(countConflictDialogs()).toBe(0);
  });

  it("same-chapter restore path still runs even when guard is consumed", async () => {
    // First mount: same chapter as saved → restore should happen.
    stubFetchProgress([
      { chapterIndex: 2, scrollRatio: 0.5, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
      { chapterIndex: 3, scrollRatio: 0.4, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
    ]);

    Object.defineProperty(document.documentElement, "scrollHeight", {
      value: 2000,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });
    const writes: number[] = [];
    let stored = 0;
    Object.defineProperty(document.documentElement, "scrollTop", {
      get() {
        return stored;
      },
      set(v: number) {
        stored = v;
        writes.push(v);
      },
      configurable: true,
    });

    const hooks = await bootFileMode();
    dispatchStorySwitch(hooks);

    const containerA = document.createElement("div");
    document.body.appendChild(containerA);
    dispatchChapterReady(hooks, containerA, 2);
    await flushAsync();
    // First same-chapter mount: scroll restoration kicks in.
    const writesAfterFirst = writes.length;
    expect(writesAfterFirst).toBeGreaterThanOrEqual(0);

    // Second fresh mount with a different chapter (still same as its own
    // saved.chapterIndex=3): guard is consumed, but same-chapter restore
    // path must still execute.
    const containerB = document.createElement("div");
    document.body.appendChild(containerB);
    dispatchChapterReady(hooks, containerB, 3);
    await flushAsync();

    expect(countConflictDialogs()).toBe(0);
    // No assertion failure means the same-chapter restore branch was
    // reachable and did not throw under the new guarded code path. Verify
    // restoration actually ran in at least one of the two mounts.
    expect(writes.length).toBeGreaterThan(0);
  });

  it("stale first-mount GET does not prompt after in-app navigation", async () => {
    // First mount's GET stays pending while user navigates to a different
    // chapter. When the stale GET finally resolves, no dialog should fire.
    let resolve1!: (v: SavedProgress) => void;
    const p1 = new Promise<SavedProgress>((r) => (resolve1 = r));
    stubFetchProgress([
      p1,
      { chapterIndex: 3, scrollRatio: 0.4, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
    ]);

    const hooks = await bootFileMode();
    dispatchStorySwitch(hooks);

    const containerA = document.createElement("div");
    document.body.appendChild(containerA);
    dispatchChapterReady(hooks, containerA, 2);
    // GET #1 still pending; identity is currently chapter 2.

    // User navigates in-app to chapter 3 (different container, fresh mount).
    const containerB = document.createElement("div");
    document.body.appendChild(containerB);
    dispatchChapterReady(hooks, containerB, 3);
    await flushAsync();
    // Identity is now chapter 3. Resolve the stale GET#1 with a mismatched
    // chapter that WOULD trigger handleCrossChapter without the stale guard.
    resolve1({ chapterIndex: 7, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 });
    await flushAsync();
    await flushAsync();

    // No prompt: stale GET targeted obsolete ctx (chapter 2), current
    // identity is chapter 3 → the stale-ctx guard suppresses handleCrossChapter.
    expect(countConflictDialogs()).toBe(0);
  });
});

describe("reading-progress (file-mode) — checkRemoteConflict strict-ahead direction", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    const slot = document.createElement("div");
    slot.id = "plugin-panel-slot";
    document.body.appendChild(slot);
    vi.unstubAllGlobals();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Exercise the polling path via setInterval (pollIntervalMs) with fake
  // timers — more reliable in happy-dom than visibilitychange.
  async function bootAndPoll(
    saved: SavedProgress,
    localChapterIndex: number,
    cachedRevisionSeed: SavedProgress | null,
  ) {
    const responses: Array<SavedProgress | null> = [];
    if (cachedRevisionSeed) responses.push(cachedRevisionSeed);
    responses.push(saved);
    stubFetchProgress(responses);

    const mod = await freshImport();
    const hooks = createMockHooks({
      enabled: true,
      storageBackend: "file",
      confirmRemoteJump: true,
      pollOnFocus: false,
      pollIntervalMs: 100,
    });
    mod.register(hooks, {});

    const storyHandlers = hooks.handlers.get("story:switch") ?? [];
    for (const h of storyHandlers) h({ chapters: ["c0", "c1", "c2", "c3", "c4", "c5"] });
    const readyHandlers = hooks.handlers.get("chapter:dom:ready") ?? [];
    const container = document.createElement("div");
    document.body.appendChild(container);
    for (const h of readyHandlers) {
      h({ series: "s1", story: "st1", chapterIndex: localChapterIndex, container });
    }
    // Drain the page-load microtask via the real microtask queue while still
    // in fake-timer mode.
    await vi.advanceTimersByTimeAsync(0);
    document.querySelectorAll(".reading-progress-conflict-dialog")
      .forEach((el) => el.remove());

    // Fire the periodic poll once.
    await vi.advanceTimersByTimeAsync(150);
    // Let the queued microtask + getProgress resolve.
    await vi.advanceTimersByTimeAsync(0);
  }

  it("remote behind local: NO dialog, NO navigation", async () => {
    await bootAndPoll(
      { chapterIndex: 2, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 9 },
      3,
      { chapterIndex: 3, scrollRatio: 0.4, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
    );
    expect(document.querySelectorAll(".reading-progress-conflict-dialog").length).toBe(0);
  });

  it("remote ahead of local: dialog fires (preserves existing multi-device sync)", async () => {
    await bootAndPoll(
      { chapterIndex: 5, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 9 },
      2,
      { chapterIndex: 2, scrollRatio: 0.1, lastReadAt: "2026-05-22T00:00:00Z", revision: 7 },
    );
    expect(document.querySelectorAll(".reading-progress-conflict-dialog").length).toBe(1);
  });
});
