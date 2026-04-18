import { stubSessionStorage } from "@/__tests__/setup";
import { ref } from "vue";
import type {
  StorySwitchContext,
  ChapterChangeContext,
} from "@/types";

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

describe("useChapterNav — story:switch and chapter:change hooks", () => {
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

  it("story:switch fires on first backend load with previousSeries/Story = null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ number: 1, content: "c1" }]),
          headers: new Headers(),
        }),
      ),
    );

    const events: StorySwitchContext[] = [];
    const chapterEvents: ChapterChangeContext[] = [];
    const { nav, hooks } = await load();
    hooks.register("story:switch", (ctx) => events.push({ ...ctx }));
    hooks.register("chapter:change", (ctx) => chapterEvents.push({ ...ctx }));

    await nav.loadFromBackend("A", "X");

    expect(events.length).toBe(1);
    expect(events[0]!.previousSeries).toBeNull();
    expect(events[0]!.previousStory).toBeNull();
    expect(events[0]!.series).toBe("A");
    expect(events[0]!.story).toBe("X");
    expect(events[0]!.mode).toBe("backend");

    expect(chapterEvents.length).toBe(1);
    expect(chapterEvents[0]!.previousIndex).toBeNull();
    expect(chapterEvents[0]!.index).toBe(0);
  });

  it("story:switch fires on backend → backend transition with correct previous values", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ number: 1, content: "c1" }]),
          headers: new Headers(),
        }),
      ),
    );

    const events: StorySwitchContext[] = [];
    const { nav, hooks } = await load();
    hooks.register("story:switch", (ctx) => events.push({ ...ctx }));

    await nav.loadFromBackend("A", "X");
    await nav.loadFromBackend("B", "Y");

    expect(events.length).toBe(2);
    expect(events[1]!.previousSeries).toBe("A");
    expect(events[1]!.previousStory).toBe("X");
    expect(events[1]!.series).toBe("B");
    expect(events[1]!.story).toBe("Y");
  });

  it("story:switch does NOT fire on reloadToLast for the same story", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve([
              { number: 1, content: "c1" },
              { number: 2, content: "c2" },
            ]),
          headers: new Headers(),
        }),
      ),
    );

    const events: StorySwitchContext[] = [];
    const { nav, hooks } = await load();
    hooks.register("story:switch", (ctx) => events.push({ ...ctx }));

    await nav.loadFromBackend("A", "X");
    expect(events.length).toBe(1);

    await nav.reloadToLast();
    expect(events.length).toBe(1); // no new story:switch
  });

  it("chapter:change fires again with correct previousIndex/index on next()", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve([
              { number: 1, content: "c1" },
              { number: 2, content: "c2" },
              { number: 3, content: "c3" },
            ]),
          headers: new Headers(),
        }),
      ),
    );

    const events: ChapterChangeContext[] = [];
    const { nav, hooks } = await load();
    hooks.register("chapter:change", (ctx) => events.push({ ...ctx }));

    await nav.loadFromBackend("A", "X");
    // initial dispatch: previousIndex null → 0
    expect(events.length).toBe(1);
    expect(events[0]!.previousIndex).toBeNull();

    nav.next();
    expect(events.length).toBe(2);
    expect(events[1]!.previousIndex).toBe(0);
    expect(events[1]!.index).toBe(1);
    expect(events[1]!.mode).toBe("backend");
  });

  it("chapter:change does NOT fire for no-op navigation to same index", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ number: 1, content: "c1" }]),
          headers: new Headers(),
        }),
      ),
    );

    const events: ChapterChangeContext[] = [];
    const { nav, hooks } = await load();
    hooks.register("chapter:change", (ctx) => events.push({ ...ctx }));

    await nav.loadFromBackend("A", "X");
    const initialCount = events.length;

    // Already at index 0, navigating there again should be a no-op.
    nav.chapters.value = [{ number: 1, content: "c1" }];
    // previous() at first chapter is guarded by isFirst; use direct no-op via next() past end
    nav.next(); // out-of-range, no change
    expect(events.length).toBe(initialCount);
  });
});
