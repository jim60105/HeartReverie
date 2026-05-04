import { ref } from "vue";
import { mount } from "@vue/test-utils";
import ChatInput from "@/components/ChatInput.vue";

const isLoadingRef = ref(false);
const errorMessageRef = ref("");
const streamingContentRef = ref("");
const abortCurrentRequestFn = vi.fn();

vi.mock("@/composables/useChatApi", () => ({
  useChatApi: () => ({
    isLoading: isLoadingRef,
    errorMessage: errorMessageRef,
    streamingContent: streamingContentRef,
    sendMessage: vi.fn(),
    resendMessage: vi.fn(),
    continueLastChapter: vi.fn(),
    abortCurrentRequest: abortCurrentRequestFn,
  }),
}));

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    getBackendContext: () => ({
      series: "s",
      story: "t",
      isBackendMode: true,
    }),
  }),
}));

function findContinueBtn(wrapper: ReturnType<typeof mount>) {
  return wrapper.find(".chat-btn-continue");
}

describe("ChatInput — Continue button", () => {
  beforeEach(() => {
    isLoadingRef.value = false;
    errorMessageRef.value = "";
    streamingContentRef.value = "";
    abortCurrentRequestFn.mockClear();
    sessionStorage.clear();
  });

  it("renders when chapters available and last is non-empty (enabled)", () => {
    const wrapper = mount(ChatInput, {
      props: { chapterCount: 2, latestChapterIsEmpty: false },
    });
    const btn = findContinueBtn(wrapper);
    expect(btn.exists()).toBe(true);
    expect((btn.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("disabled when chapterCount === 0", () => {
    const wrapper = mount(ChatInput, {
      props: { chapterCount: 0, latestChapterIsEmpty: true },
    });
    expect((findContinueBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disabled when latestChapterIsEmpty is true", () => {
    const wrapper = mount(ChatInput, {
      props: { chapterCount: 1, latestChapterIsEmpty: true },
    });
    expect((findContinueBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disabled when isLoading is true", () => {
    isLoadingRef.value = true;
    const wrapper = mount(ChatInput, {
      props: { chapterCount: 1, latestChapterIsEmpty: false },
    });
    expect((findContinueBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true);
  });

  it("disabled when disabled prop is true", () => {
    const wrapper = mount(ChatInput, {
      props: { disabled: true, chapterCount: 1, latestChapterIsEmpty: false },
    });
    expect((findContinueBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true);
  });

  it("emits 'continue' on click when enabled", async () => {
    const wrapper = mount(ChatInput, {
      props: { chapterCount: 1, latestChapterIsEmpty: false },
    });
    await findContinueBtn(wrapper).trigger("click");
    expect(wrapper.emitted("continue")).toBeTruthy();
    expect(wrapper.emitted("continue")![0]).toEqual([]);
  });

  it("does NOT clear textarea on click", async () => {
    const wrapper = mount(ChatInput, {
      props: { chapterCount: 1, latestChapterIsEmpty: false },
    });
    await wrapper.find("textarea").setValue("draft text");
    await findContinueBtn(wrapper).trigger("click");
    const ta = wrapper.find("textarea").element as HTMLTextAreaElement;
    expect(ta.value).toBe("draft text");
  });

  it("default props (no chapterCount/latestChapterIsEmpty) → disabled", () => {
    const wrapper = mount(ChatInput);
    expect((findContinueBtn(wrapper).element as HTMLButtonElement).disabled).toBe(true);
  });

  it("tooltip explains why disabled (empty latest)", () => {
    const wrapper = mount(ChatInput, {
      props: { chapterCount: 1, latestChapterIsEmpty: true },
    });
    const btn = findContinueBtn(wrapper);
    expect(btn.attributes("title")).toContain("最後一章");
  });
});
