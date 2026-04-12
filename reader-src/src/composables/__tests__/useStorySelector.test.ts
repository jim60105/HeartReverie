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

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        headers: new Headers(),
      }),
    ),
  );
}

describe("useStorySelector", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockRouteParams.value = {};
    mockFetch([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getSelector() {
    const mod = await import("@/composables/useStorySelector");
    return mod.useStorySelector();
  }

  it("initial state has empty seriesList and storyList", async () => {
    const selector = await getSelector();
    expect(selector.seriesList.value).toEqual([]);
    expect(selector.storyList.value).toEqual([]);
  });

  it("fetchSeries populates seriesList", async () => {
    mockFetch(["series-a", "series-b"]);
    const selector = await getSelector();
    await selector.fetchSeries();
    expect(fetch).toHaveBeenCalled();
    expect(selector.seriesList.value).toEqual(["series-a", "series-b"]);
  });

  it("fetchStories populates storyList for given series", async () => {
    mockFetch(["story-1", "story-2"]);
    const selector = await getSelector();
    await selector.fetchStories("my-series");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("my-series"),
      expect.any(Object),
    );
    expect(selector.storyList.value).toEqual(["story-1", "story-2"]);
  });

  it("createStory calls API", async () => {
    mockFetch({});
    const selector = await getSelector();
    await selector.createStory("my-series", "new-story");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("new-story"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("fetchSeries includes auth headers in fetch call", async () => {
    mockFetch([]);
    const selector = await getSelector();
    await selector.fetchSeries();
    const fetchCall = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(fetchCall).toBeDefined();
    expect(fetchCall![1]).toHaveProperty("headers");
  });

  it("selectedSeries starts empty", async () => {
    const selector = await getSelector();
    expect(selector.selectedSeries.value).toBe("");
  });

  it("selectedStory starts empty", async () => {
    const selector = await getSelector();
    expect(selector.selectedStory.value).toBe("");
  });

  it("fetchSeries throws on non-ok response", async () => {
    mockFetch("error", 500);
    const selector = await getSelector();
    await expect(selector.fetchSeries()).rejects.toThrow();
  });
});
