import { stubSessionStorage } from "@/__tests__/setup";
import { ref } from "vue";

const mockSelectedSeries = ref("");
const mockSelectedStory = ref("");

vi.mock("@/composables/useStorySelector", () => ({
  useStorySelector: () => ({
    selectedSeries: mockSelectedSeries,
    selectedStory: mockSelectedStory,
    seriesList: ref([]),
    storyList: ref([]),
    loadSeries: vi.fn(),
    loadStories: vi.fn(),
  }),
}));

/**
 * Routing fetch mock that handles template and parameter endpoints.
 */
function installFetchMock(
  content = "server template content",
  source: "custom" | "default" = "default",
) {
  const mock = vi.fn(
    (url: string, init?: { method?: string }) => {
      if (typeof url === "string" && url.includes("/api/plugins/parameters")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        });
      }

      const method = init?.method ?? "GET";

      if (method === "PUT" || method === "DELETE") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          headers: new Headers(),
        });
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content, source }),
        headers: new Headers(),
      });
    },
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("usePromptEditor", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    installFetchMock();
    mockSelectedSeries.value = "";
    mockSelectedStory.value = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getEditor() {
    const mod = await import("@/composables/usePromptEditor");
    return mod.usePromptEditor();
  }

  it("templateContent starts as empty string", async () => {
    const editor = await getEditor();
    expect(editor.templateContent.value).toBe("");
  });

  it("loadTemplate fetches from backend", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(fetch).toHaveBeenCalled();
  });

  it("parameters starts as empty array", async () => {
    const editor = await getEditor();
    expect(Array.isArray(editor.parameters.value)).toBe(true);
  });

  it("isDirty is false after loadTemplate", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(editor.isDirty.value).toBe(false);
  });

  it("isDirty is true after modifying templateContent", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "modified content";
    expect(editor.isDirty.value).toBe(true);
  });

  it("save() calls PUT /api/template and resets dirty state", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "modified content";
    expect(editor.isDirty.value).toBe(true);

    await editor.save();

    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
    const putCall = calls.find(
      (c: unknown[]) =>
        (c[1] as { method?: string } | undefined)?.method === "PUT",
    );
    expect(putCall).toBeDefined();
    expect(editor.isDirty.value).toBe(false);
  });

  it("resetTemplate() calls DELETE then re-fetches via GET", async () => {
    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "modified";

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const callsBefore = fetchMock.mock.calls.length;

    await editor.resetTemplate();

    const newCalls = fetchMock.mock.calls.slice(callsBefore);
    const deleteCall = newCalls.find(
      (c: unknown[]) =>
        (c[1] as { method?: string } | undefined)?.method === "DELETE",
    );
    expect(deleteCall).toBeDefined();

    const getCalls = newCalls.filter((c: unknown[]) => {
      const method = (c[1] as { method?: string } | undefined)?.method;
      return (
        typeof c[0] === "string" &&
        (c[0] as string).includes("/api/template") &&
        (!method || method === "GET")
      );
    });
    expect(getCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("isCustom is true when source is 'custom'", async () => {
    installFetchMock("custom content", "custom");
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(editor.isCustom.value).toBe(true);
  });

  it("isCustom is false when source is 'default'", async () => {
    installFetchMock("default content", "default");
    const editor = await getEditor();
    await editor.loadTemplate();
    expect(editor.isCustom.value).toBe(false);
  });

  it("loadParameters includes series/story query params when provided", async () => {
    const fetchMock = installFetchMock();
    await getEditor();

    // Trigger watcher by changing story context
    mockSelectedSeries.value = "my-series";
    mockSelectedStory.value = "my-story";

    // Wait for watcher to trigger (nextTick + async)
    await new Promise((r) => setTimeout(r, 50));

    const paramsCalls = fetchMock.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("/api/plugins/parameters"),
    );

    // Should have at least one call with query params
    const callWithParams = paramsCalls.find((c: unknown[]) =>
      (c[0] as string).includes("series=my-series"),
    );
    expect(callWithParams).toBeDefined();
    expect(callWithParams![0] as string).toContain("story=my-story");
  });

  it("re-fetches parameters when story context changes", async () => {
    const fetchMock = installFetchMock();
    await getEditor();

    const initialCallCount = fetchMock.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("/api/plugins/parameters"),
    ).length;

    // Change story context
    mockSelectedSeries.value = "series-a";
    await new Promise((r) => setTimeout(r, 50));

    const afterChangeCount = fetchMock.mock.calls.filter(
      (c: unknown[]) =>
        typeof c[0] === "string" &&
        (c[0] as string).includes("/api/plugins/parameters"),
    ).length;

    expect(afterChangeCount).toBeGreaterThan(initialCallCount);
  });

  it("does not reference localStorage", async () => {
    const ls = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      length: 0,
      key: vi.fn(),
    };
    vi.stubGlobal("localStorage", ls);

    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "changed";
    await editor.save();
    await editor.resetTemplate();

    expect(ls.getItem).not.toHaveBeenCalled();
    expect(ls.setItem).not.toHaveBeenCalled();
    expect(ls.removeItem).not.toHaveBeenCalled();
  });
});

describe("pill source categorization", () => {
  it("parameters with each source are correctly categorized", () => {
    // Mirrors the :class binding logic in PromptEditor.vue
    const classify = (source: string) => ({
      "pill-core": source === "core",
      "pill-lore": source === "lore",
      "pill-plugin": source !== "core" && source !== "lore",
    });

    expect(classify("core")).toEqual({
      "pill-core": true,
      "pill-lore": false,
      "pill-plugin": false,
    });
    expect(classify("lore")).toEqual({
      "pill-core": false,
      "pill-lore": true,
      "pill-plugin": false,
    });
    expect(classify("my-plugin")).toEqual({
      "pill-core": false,
      "pill-lore": false,
      "pill-plugin": true,
    });
  });
});
