import { mount } from "@vue/test-utils";
import PromptEditorPage from "@/components/PromptEditorPage.vue";

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    getBackendContext: () => ({
      series: "test-series",
      story: "test-story",
      isBackendMode: true,
    }),
  }),
}));

vi.mock("@/composables/usePromptEditor", () => ({
  usePromptEditor: () => ({
    cards: { value: [] },
    rawSource: { value: "" },
    originalRawSource: { value: "" },
    useRawFallback: { value: false },
    mode: { value: "cards" },
    parameters: { value: [] },
    isDirty: { value: false },
    isCustom: { value: false },
    isSaving: { value: false },
    parseError: { value: null },
    topLevelContentDropped: { value: false },
    saveDisabledReason: { value: null },
    save: vi.fn(),
    loadTemplate: vi.fn(() => Promise.resolve()),
    resetTemplate: vi.fn(),
    toggleRawFallback: vi.fn(),
    addCard: vi.fn(),
    deleteCard: vi.fn(),
    moveCardUp: vi.fn(),
    moveCardDown: vi.fn(),
    serializeCurrent: vi.fn(() => ""),
    dismissParseError: vi.fn(),
    previewTemplate: vi.fn(),
  }),
}));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({}),
  }),
}));

describe("PromptEditorPage", () => {
  it("renders without crashing", () => {
    const wrapper = mount(PromptEditorPage);
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the editor page layout", () => {
    const wrapper = mount(PromptEditorPage);
    expect(wrapper.find(".editor-page").exists()).toBe(true);
    expect(wrapper.find(".editor-page-main").exists()).toBe(true);
  });

  it("renders PromptEditor component", () => {
    const wrapper = mount(PromptEditorPage);
    // PromptEditor renders toolbar with variable pills and action buttons
    expect(wrapper.find(".editor-root").exists()).toBe(true);
    expect(wrapper.text()).toContain("預覽 Prompt");
  });

  it("does not show preview by default", () => {
    const wrapper = mount(PromptEditorPage);
    expect(wrapper.find(".editor-page-preview").exists()).toBe(false);
  });

  it("toggles preview when PromptEditor emits preview event", async () => {
    const wrapper = mount(PromptEditorPage);

    // Find the "預覽 Prompt" button inside PromptEditor and click it
    const previewBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("預覽"));
    expect(previewBtn).toBeDefined();

    await previewBtn!.trigger("click");
    expect(wrapper.find(".editor-page-preview").exists()).toBe(true);

    // Click again to hide
    await previewBtn!.trigger("click");
    expect(wrapper.find(".editor-page-preview").exists()).toBe(false);
  });
});
