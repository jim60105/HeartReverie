// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Regression tests for the story:switch race condition.
// Bug: When two concurrent loadFromBackend calls happen (e.g. route watcher + handleUnlocked),
// the first call pre-sets currentSeries then gets stale-guarded, but the second call would
// see isTransition=false because currentSeries was already set — causing story:switch to never fire.
// Fix: Use previousSeries/previousStory (only updated after successful dispatch) for the transition check.

import { stubSessionStorage } from "@/__tests__/setup";
import { ref } from "vue";
import type { StorySwitchContext } from "@/types";

const mockRouteParams = ref<Record<string, string | undefined>>({});
vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: mockRouteParams.value,
  }),
}));

vi.mock("@/router", () => ({
  default: {
    push: vi.fn(),
    replace: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockWsIsConnected = ref(false);
vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: mockWsIsConnected,
    isAuthenticated: ref(true),
    send: vi.fn(),
    onMessage: vi.fn(() => vi.fn()),
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe("useChapterNav — story:switch race condition regression", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockRouteParams.value = {};
    mockWsIsConnected.value = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function load() {
    const { useChapterNav } = await import("@/composables/useChapterNav");
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    return { nav: useChapterNav(), hooks: frontendHooks };
  }

  it("story:switch fires even when two concurrent loads race (stale-guard scenario)", async () => {
    // Simulate the race: first fetch resolves slowly, second resolves first.
    // The stale-guard discards the first call, but story:switch must still fire from the second.
    let resolveFirst: (v: unknown) => void;
    const firstPromise = new Promise((r) => { resolveFirst = r; });
    let callCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        if (callCount === 1) {
          // First call — delayed (will be stale-guarded)
          return firstPromise.then(() => ({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ number: 1, content: "c1" }]),
            headers: new Headers(),
          }));
        }
        // Second call — resolves immediately
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ number: 1, content: "c1" }]),
          headers: new Headers(),
        });
      }),
    );

    const events: StorySwitchContext[] = [];
    const { nav, hooks } = await load();
    hooks.register("story:switch", (ctx) => events.push({ ...ctx }));

    // Start two concurrent loads to same story (simulates route watcher + handleUnlocked)
    const p1 = nav.loadFromBackend("A", "X");
    const p2 = nav.loadFromBackend("A", "X");

    // Let second complete first
    await p2;

    // story:switch MUST have fired (the bug was that it did NOT fire here)
    expect(events.length).toBe(1);
    expect(events[0]!.series).toBe("A");
    expect(events[0]!.story).toBe("X");
    expect(events[0]!.previousSeries).toBeNull();
    expect(events[0]!.previousStory).toBeNull();

    // Now resolve the first (stale) call — it should be discarded
    resolveFirst!(undefined);
    await p1;

    // No duplicate story:switch dispatch
    expect(events.length).toBe(1);
  });

  it("previousSeries/previousStory only update after successful dispatch, not from stale loads", async () => {
    let resolveFirst: (v: unknown) => void;
    const firstPromise = new Promise((r) => { resolveFirst = r; });
    let callCount = 0;

    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        callCount++;
        if (callCount <= 2) {
          // First two calls: first=stale, second=resolves
          if (callCount === 1) {
            return firstPromise.then(() => ({
              ok: true,
              status: 200,
              json: () => Promise.resolve([{ number: 1, content: "c1" }]),
              headers: new Headers(),
            }));
          }
          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve([{ number: 1, content: "c1" }]),
            headers: new Headers(),
          });
        }
        // Third call: new story
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ number: 2, content: "c2" }]),
          headers: new Headers(),
        });
      }),
    );

    const events: StorySwitchContext[] = [];
    const { nav, hooks } = await load();
    hooks.register("story:switch", (ctx) => events.push({ ...ctx }));

    // Race for story A/X
    const p1 = nav.loadFromBackend("A", "X");
    const p2 = nav.loadFromBackend("A", "X");
    await p2;
    resolveFirst!(undefined);
    await p1;

    expect(events.length).toBe(1);
    expect(events[0]!.previousSeries).toBeNull();

    // Now switch to a different story — previousSeries should be "A"
    await nav.loadFromBackend("B", "Y");

    expect(events.length).toBe(2);
    expect(events[1]!.previousSeries).toBe("A");
    expect(events[1]!.previousStory).toBe("X");
    expect(events[1]!.series).toBe("B");
    expect(events[1]!.story).toBe("Y");
  });
});
