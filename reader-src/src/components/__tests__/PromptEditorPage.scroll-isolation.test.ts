// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Scroll-isolation behaviour test for the prompt-editor page.
 *
 * Mounts PromptEditorPage with both PromptEditor and PromptPreview rendered,
 * mutates one container's scrollTop, and asserts the other's scrollTop is
 * untouched.
 *
 * Scope: this test narrowly proves "no JS scroll-sync handler exists between
 * the textarea and the preview". It does NOT prove the panes are real scroll
 * containers in a real browser — that requires layout, which Happy DOM does
 * not provide. Real-layout behaviour is verified by manual browser smoke
 * (see openspec design.md Decision 6).
 */
import { flushPromises, mount } from "@vue/test-utils";
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
    rawSource: { value: "x".repeat(10000) },
    originalRawSource: { value: "" },
    useRawFallback: { value: true },
    mode: { value: "raw" },
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

// PromptPreview's previewContent comes from a fetch-driven composable;
// we don't need a real preview body for scroll-isolation — just enough
// to render the pane. Stub the global fetch so the component mounts cleanly.
beforeEach(() => {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      content: "preview\n".repeat(5000),
      parameters: [],
    }),
  } as unknown as Response);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PromptEditorPage — independent scroll positions (no JS sync)", () => {
  it("mutating the textarea scrollTop does not change the preview scrollTop", async () => {
    const wrapper = mount(PromptEditorPage, {
      attachTo: document.body,
    });

    // Open preview pane.
    const previewBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("預覽"));
    expect(previewBtn).toBeDefined();
    await previewBtn!.trigger("click");
    await flushPromises();

    const textarea = wrapper.find<HTMLTextAreaElement>(".editor-textarea");
    const previewContent = wrapper.find<HTMLPreElement>(".preview-content");
    expect(textarea.exists()).toBe(true);
    expect(previewContent.exists()).toBe(true);

    const previewBefore = previewContent.element.scrollTop;
    textarea.element.scrollTop = 500;
    textarea.element.dispatchEvent(new Event("scroll"));
    await flushPromises();

    expect(previewContent.element.scrollTop).toBe(previewBefore);
    wrapper.unmount();
  });

  it("mutating the preview scrollTop does not change the textarea scrollTop", async () => {
    const wrapper = mount(PromptEditorPage, {
      attachTo: document.body,
    });

    const previewBtn = wrapper
      .findAll("button")
      .find((b) => b.text().includes("預覽"));
    await previewBtn!.trigger("click");
    await flushPromises();

    const textarea = wrapper.find<HTMLTextAreaElement>(".editor-textarea");
    const previewContent = wrapper.find<HTMLPreElement>(".preview-content");
    const textareaBefore = textarea.element.scrollTop;

    previewContent.element.scrollTop = 500;
    previewContent.element.dispatchEvent(new Event("scroll"));
    await flushPromises();

    expect(textarea.element.scrollTop).toBe(textareaBefore);
    wrapper.unmount();
  });
});
