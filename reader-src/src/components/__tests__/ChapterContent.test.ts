import { flushPromises, mount } from "@vue/test-utils";
import ChapterContent from "@/components/ChapterContent.vue";

const mockState = vi.hoisted(() => ({
  chaptersRef: { value: [{ number: 2, stateDiff: { hp: "+1" } }] },
  currentIndexRef: { value: 0 },
  modeRef: { value: "backend" as "fsa" | "backend" },
  backendContextRef: { value: {
    series: "series-a" as string | null,
    story: "story-a" as string | null,
    isBackendMode: true,
  } },
  reloadToLastMock: vi.fn().mockResolvedValue(undefined),
  loadFromBackendMock: vi.fn().mockResolvedValue(undefined),
  editChapterMock: vi.fn().mockResolvedValue(undefined),
  rewindAfterMock: vi.fn().mockResolvedValue(undefined),
  branchFromMock: vi.fn().mockResolvedValue({ series: "next-s", name: "next-n" }),
  routerPushMock: vi.fn(() => Promise.resolve()),
  renderChapterMock: vi.fn(() => [
    { type: "html", content: "<p>rendered</p>" },
    { type: "vento-error", data: { title: "錯誤", detail: "bad" } },
  ]),
}));

vi.mock("@/composables/useMarkdownRenderer", () => ({
  useMarkdownRenderer: () => ({ renderChapter: mockState.renderChapterMock }),
}));

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    chapters: mockState.chaptersRef,
    currentIndex: mockState.currentIndexRef,
    mode: mockState.modeRef,
    getBackendContext: () => mockState.backendContextRef.value,
    reloadToLast: mockState.reloadToLastMock,
    loadFromBackend: mockState.loadFromBackendMock,
  }),
}));

vi.mock("@/composables/useChapterActions", () => ({
  useChapterActions: () => ({
    editChapter: mockState.editChapterMock,
    rewindAfter: mockState.rewindAfterMock,
    branchFrom: mockState.branchFromMock,
  }),
}));

vi.mock("@/router", () => ({
  default: { push: mockState.routerPushMock },
}));

describe("ChapterContent", () => {
  beforeEach(() => {
    mockState.modeRef.value = "backend";
    mockState.currentIndexRef.value = 0;
    mockState.backendContextRef.value = { series: "series-a", story: "story-a", isBackendMode: true };
    mockState.chaptersRef.value = [{ number: 2, stateDiff: { hp: "+1" } }];
    mockState.renderChapterMock.mockClear();
    mockState.editChapterMock.mockClear();
    mockState.rewindAfterMock.mockClear();
    mockState.branchFromMock.mockClear();
    mockState.reloadToLastMock.mockClear();
    mockState.loadFromBackendMock.mockClear();
    mockState.routerPushMock.mockClear();
    vi.stubGlobal("confirm", vi.fn(() => true));
    vi.stubGlobal("prompt", vi.fn(() => "new-branch"));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountComponent() {
    return mount(ChapterContent, {
      props: { rawMarkdown: "raw content", isLastChapter: true },
      global: {
        stubs: {
          VentoErrorCard: {
            template: "<div class='vento-error-stub'></div>",
          },
        },
      },
    });
  }

  it("renders markdown tokens and toolbar in backend mode", () => {
    const wrapper = mountComponent();
    expect(wrapper.find(".chapter-toolbar").exists()).toBe(true);
    expect(wrapper.html()).toContain("<p>rendered</p>");
    expect(wrapper.find(".vento-error-stub").exists()).toBe(true);
    expect(mockState.renderChapterMock).toHaveBeenCalledWith("raw content", {
      isLastChapter: true,
      stateDiff: { hp: "+1" },
    });
  });

  it("hides toolbar in fsa mode", () => {
    mockState.modeRef.value = "fsa";
    const wrapper = mountComponent();
    expect(wrapper.find(".chapter-toolbar").exists()).toBe(false);
  });

  it("saves edited content and reloads latest chapter", async () => {
    const wrapper = mountComponent();
    await wrapper.findAll("button")[0]!.trigger("click");
    const editor = wrapper.find("textarea.chapter-editor");
    await editor.setValue("updated chapter");

    await wrapper.findAll("button")[0]!.trigger("click");
    await flushPromises();

    expect(mockState.editChapterMock).toHaveBeenCalledWith("series-a", "story-a", 2, "updated chapter");
    expect(mockState.reloadToLastMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find("textarea.chapter-editor").exists()).toBe(false);
  });

  it("asks confirmation before rewind and aborts on cancel", async () => {
    vi.stubGlobal("confirm", vi.fn(() => false));
    const wrapper = mountComponent();

    await wrapper.findAll("button")[1]!.trigger("click");
    await flushPromises();

    expect(mockState.rewindAfterMock).not.toHaveBeenCalled();
  });

  it("branches from current chapter and navigates to new story", async () => {
    const wrapper = mountComponent();

    await wrapper.findAll("button")[2]!.trigger("click");
    await flushPromises();

    expect(mockState.branchFromMock).toHaveBeenCalledWith("series-a", "story-a", 2, "new-branch");
    expect(mockState.loadFromBackendMock).toHaveBeenCalledWith("next-s", "next-n", 2);
    expect(mockState.routerPushMock).toHaveBeenCalledWith({
      name: "chapter",
      params: { series: "next-s", story: "next-n", chapter: "2" },
    });
  });

  it("shows fallback error messages for non-Error failures", async () => {
    mockState.rewindAfterMock.mockRejectedValueOnce("x");
    mockState.branchFromMock.mockRejectedValueOnce("x");
    vi.stubGlobal("prompt", vi.fn(() => " "));

    const wrapper = mountComponent();
    await wrapper.findAll("button")[1]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".toolbar-error").text()).toContain("倒回失敗");

    await wrapper.findAll("button")[2]!.trigger("click");
    await flushPromises();
    expect(wrapper.find(".toolbar-error").text()).toContain("分支失敗");
    expect(mockState.branchFromMock).toHaveBeenCalledWith("series-a", "story-a", 2, undefined);
  });
});
