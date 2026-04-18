import { stubSessionStorage } from "@/__tests__/setup";
import { ref } from "vue";

// Mock vue-router's useRoute to return a reactive route-like object
const mockRouteParams = ref<Record<string, string | undefined>>({});
vi.mock("vue-router", () => ({
  useRoute: () => ({
    params: mockRouteParams.value,
  }),
}));

// Mock the router module
vi.mock("@/router", () => ({
  default: {
    push: vi.fn(),
    replace: vi.fn(),
  },
}));

// Mock useWebSocket
const mockWsIsConnected = ref(false);
const mockWsSend = vi.fn();
const mockWsOnMessage = vi.fn(() => vi.fn());

vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: mockWsIsConnected,
    isAuthenticated: ref(true),
    send: mockWsSend,
    onMessage: mockWsOnMessage,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

describe("useChapterNav", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockRouteParams.value = {};
    mockWsIsConnected.value = false;
    mockWsSend.mockClear();
    mockWsOnMessage.mockClear();
    mockWsOnMessage.mockImplementation(() => vi.fn());
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

  async function getNav() {
    // useChapterNav depends on useAuth & useFileReader (module-level singletons)
    const mod = await import("@/composables/useChapterNav");
    return mod.useChapterNav();
  }

  it("initial state has zero chapters", async () => {
    const nav = await getNav();
    expect(nav.totalChapters.value).toBe(0);
    expect(nav.currentIndex.value).toBe(0);
  });

  it("totalChapters is computed from chapters length", async () => {
    const nav = await getNav();
    nav.chapters.value = [
      { number: 1, content: "a" },
      { number: 2, content: "b" },
      { number: 3, content: "c" },
    ];
    expect(nav.totalChapters.value).toBe(3);
  });

  it("isFirst is true when currentIndex is 0", async () => {
    const nav = await getNav();
    nav.chapters.value = [{ number: 1, content: "a" }];
    nav.currentIndex.value = 0;
    expect(nav.isFirst.value).toBe(true);
  });

  it("isLast is true when currentIndex is at last chapter", async () => {
    const nav = await getNav();
    nav.chapters.value = [
      { number: 1, content: "a" },
      { number: 2, content: "b" },
    ];
    nav.currentIndex.value = 1;
    expect(nav.isLast.value).toBe(true);
  });

  it("isLast is false when not at last chapter", async () => {
    const nav = await getNav();
    nav.chapters.value = [
      { number: 1, content: "a" },
      { number: 2, content: "b" },
    ];
    nav.currentIndex.value = 0;
    expect(nav.isLast.value).toBe(false);
  });

  it("isLastChapter correctly identifies last chapter", async () => {
    const nav = await getNav();
    nav.chapters.value = [
      { number: 1, content: "a" },
      { number: 2, content: "b" },
    ];
    nav.currentIndex.value = 1;
    expect(nav.isLastChapter.value).toBe(true);
    nav.currentIndex.value = 0;
    expect(nav.isLastChapter.value).toBe(false);
  });

  it("isLastChapter is false when no chapters", async () => {
    const nav = await getNav();
    expect(nav.isLastChapter.value).toBe(false);
  });

  it("mode defaults to fsa", async () => {
    const nav = await getNav();
    expect(nav.mode.value).toBe("fsa");
  });

  it("mode can be switched to backend", async () => {
    const nav = await getNav();
    nav.mode.value = "backend";
    expect(nav.mode.value).toBe("backend");
  });

  it("loadFromBackend calls fetch and sets mode", async () => {
    // Mock fetch to return batch chapter response
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve([{ number: 1, content: "chapter 1 text" }]),
        headers: new Headers(),
      });
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series1", "story1");
    expect(fetchMock).toHaveBeenCalled();
    expect(nav.mode.value).toBe("backend");
  });

  it("getBackendContext returns current state", async () => {
    const nav = await getNav();
    const ctx = nav.getBackendContext();
    expect(ctx).toHaveProperty("series");
    expect(ctx).toHaveProperty("story");
    expect(ctx).toHaveProperty("isBackendMode");
  });

  it("folderName is initially empty", async () => {
    const nav = await getNav();
    expect(nav.folderName.value).toBe("");
  });

  describe("WebSocket integration", () => {
    it("subscribe on loadFromBackend when WS connected", async () => {
      mockWsIsConnected.value = true;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ number: 1, content: "ch1" }]),
          headers: new Headers(),
        });
      vi.stubGlobal("fetch", fetchMock);

      const nav = await getNav();
      await nav.loadFromBackend("series1", "story1");

      expect(mockWsSend).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "subscribe",
          series: "series1",
          story: "story1",
        }),
      );
    });

    it("polling does not start when WS is connected", async () => {
      mockWsIsConnected.value = true;
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ number: 1, content: "ch1" }]),
          headers: new Headers(),
        });
      vi.stubGlobal("fetch", fetchMock);

      const nav = await getNav();
      await nav.loadFromBackend("series1", "story1");

      // After loadFromBackend, the fetch count should be 1 (batch request).
      // If polling started, additional fetches would be queued.
      // Wait a tick to ensure no immediate polling.
      await new Promise((r) => setTimeout(r, 0));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
