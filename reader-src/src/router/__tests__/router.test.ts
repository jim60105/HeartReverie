import { ref } from "vue";

// Mock vue-router
const mockRouteParams = ref<Record<string, string | undefined>>({});
vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: mockRouteParams.value,
  }),
  createRouter: vi.fn(),
  createWebHistory: vi.fn(),
}));

vi.mock("@/router", () => ({
  default: {
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

describe("router integration with useChapterNav", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockRouteParams.value = {};
    const routerMod = await import("@/router");
    vi.mocked(routerMod.default.push).mockReset();
    vi.mocked(routerMod.default.replace).mockReset();
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("router.replace is called on chapter change in backend mode", async () => {
    const routerMod = await import("@/router");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { number: 1, content: "ch1" },
          { number: 2, content: "ch2" },
          { number: 3, content: "ch3" },
        ]),
        headers: new Headers(),
      });
    vi.stubGlobal("fetch", fetchMock);

    const navMod = await import("@/composables/useChapterNav");
    const nav = navMod.useChapterNav();
    await nav.loadFromBackend("s1", "st1");

    // Wait for Vue watchers to flush
    await new Promise((r) => setTimeout(r, 10));

    expect(routerMod.default.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "chapter",
        params: expect.objectContaining({
          series: "s1",
          story: "st1",
          chapter: "1",
        }),
      }),
    );
  });

  it("router is NOT called in FSA mode", async () => {
    const routerMod = await import("@/router");
    const navMod = await import("@/composables/useChapterNav");
    const nav = navMod.useChapterNav();

    // In FSA mode (default), changing currentIndex should not trigger router
    nav.chapters.value = [
      { number: 1, content: "a" },
      { number: 2, content: "b" },
    ];
    nav.currentIndex.value = 1;

    // Wait for watcher to fire
    await new Promise((r) => setTimeout(r, 10));

    expect(routerMod.default.replace).not.toHaveBeenCalled();
  });

  it("loadFromBackend accepts optional startChapter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([
          { number: 1, content: "ch1" },
          { number: 2, content: "ch2" },
          { number: 3, content: "ch3" },
        ]),
        headers: new Headers(),
      });
    vi.stubGlobal("fetch", fetchMock);

    const navMod = await import("@/composables/useChapterNav");
    const nav = navMod.useChapterNav();
    await nav.loadFromBackend("s1", "st1", 3);

    // Should start at chapter 3 (index 2)
    expect(nav.currentIndex.value).toBe(2);
    expect(nav.currentContent.value).toBe("ch3");
  });
});

describe("router integration with useStorySelector", () => {
  beforeEach(async () => {
    vi.resetModules();
    mockRouteParams.value = {};
    const routerMod = await import("@/router");
    vi.mocked(routerMod.default.push).mockReset();
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(() => null),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("navigateToStory calls router.push with correct params", async () => {
    const routerMod = await import("@/router");
    const selMod = await import("@/composables/useStorySelector");
    const sel = selMod.useStorySelector();

    sel.navigateToStory("my-series", "my-story");

    expect(routerMod.default.push).toHaveBeenCalledWith({
      name: "story",
      params: { series: "my-series", story: "my-story" },
    });
  });
});
