import { ref } from "vue";
import { stubSessionStorage } from "@/__tests__/setup";

const selectedSeries = ref("");
const selectedStory = ref("");

vi.mock("@/composables/useStorySelector", () => ({
  useStorySelector: () => ({
    selectedSeries,
    selectedStory,
    seriesList: ref([]),
    storyList: ref([]),
    fetchSeries: vi.fn(),
    fetchStories: vi.fn(),
    createStory: vi.fn(),
    navigateToStory: vi.fn(),
  }),
}));

describe("usePromptEditor preview and error paths", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    selectedSeries.value = "";
    selectedStory.value = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getEditor() {
    const { usePromptEditor } = await import("@/composables/usePromptEditor");
    return usePromptEditor();
  }

  it("save throws fallback error detail when backend json parse fails", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/plugins/parameters")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), headers: new Headers() });
      }
      if (init?.method === "PUT") {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.reject(new Error("invalid")), headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: "base", source: "default" }),
        headers: new Headers(),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "dirty";

    await expect(editor.save()).rejects.toThrow("Failed to save template");
  });

  it("previewTemplate uses fallback preview message and includes template when dirty", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/plugins/parameters")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), headers: new Headers() });
      }
      if (url.includes("/preview-prompt")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ prompt: "ok" }), headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: "saved", source: "default" }),
        headers: new Headers(),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "unsaved template";

    const result = await editor.previewTemplate("s", "t", "");
    expect(result).toEqual({ prompt: "ok" });

    const previewCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/preview-prompt"));
    const body = JSON.parse((previewCall?.[1] as RequestInit).body as string);
    expect(body.message).toBe("(preview)");
    expect(body.template).toBe("unsaved template");
  });

  it("previewTemplate throws backend message/detail on failure", async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes("/api/plugins/parameters")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), headers: new Headers() });
      }
      if (url.includes("/preview-prompt")) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () => Promise.resolve({ message: "bad preview" }),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: "saved", source: "default" }),
        headers: new Headers(),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const editor = await getEditor();
    await expect(editor.previewTemplate("s", "t", "msg")).rejects.toThrow("bad preview");
  });
});
