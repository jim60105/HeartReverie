import { nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import MainLayout from "@/components/MainLayout.vue";
import ChatInput from "@/components/ChatInput.vue";

const isLastChapterRef = ref(false);
const chaptersRef = ref([{ number: 1 }]);
const backendContext = {
  series: "series-a",
  story: "story-a",
  isBackendMode: true,
};

const reloadToLastMock = vi.fn().mockResolvedValue(undefined);
const sendMessageMock = vi.fn().mockResolvedValue(true);
const resendMessageMock = vi.fn().mockResolvedValue(true);
const abortCurrentRequestMock = vi.fn();
const isLoadingRef = ref(false);
const errorMessageRef = ref("");
const streamingContentRef = ref("");

vi.mock("vue-router", async (importOriginal) => {
  const actual = await importOriginal<typeof import("vue-router")>();
  return {
    ...actual,
    useRoute: () => ({
      params: {
        series: "series-a",
        story: "story-a",
      },
    }),
  };
});

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    isLastChapter: isLastChapterRef,
    chapters: chaptersRef,
    getBackendContext: () => backendContext,
    reloadToLast: reloadToLastMock,
  }),
}));

vi.mock("@/composables/useChatApi", () => ({
  useChatApi: () => ({
    isLoading: isLoadingRef,
    errorMessage: errorMessageRef,
    streamingContent: streamingContentRef,
    abortCurrentRequest: abortCurrentRequestMock,
    sendMessage: sendMessageMock,
    resendMessage: resendMessageMock,
  }),
}));

describe("MainLayout", () => {
  function mountMainLayout() {
    return mount(MainLayout, {
      global: {
        stubs: {
          AppHeader: { template: "<div class='app-header-stub'></div>" },
          ContentArea: { template: "<div class='content-area-stub'></div>" },
          UsagePanel: { template: "<div class='usage-panel-stub'></div>" },
        },
      },
    });
  }

  beforeEach(() => {
    isLastChapterRef.value = false;
    chaptersRef.value = [{ number: 1 }];
    backendContext.series = "series-a";
    backendContext.story = "story-a";
    backendContext.isBackendMode = true;
    isLoadingRef.value = false;
    errorMessageRef.value = "";
    streamingContentRef.value = "";
    sessionStorage.clear();
    sendMessageMock.mockClear();
    resendMessageMock.mockClear();
    reloadToLastMock.mockClear();
  });

  it("WHEN backend mode is active but chapter is not last THEN ChatInput is hidden", () => {
    const wrapper = mountMainLayout();
    expect(wrapper.findComponent(ChatInput).exists()).toBe(false);
  });

  it("WHEN backend mode is active and current chapter is last THEN ChatInput is shown", async () => {
    isLastChapterRef.value = true;
    const wrapper = mountMainLayout();
    await nextTick();
    expect(wrapper.findComponent(ChatInput).exists()).toBe(true);
  });

  it("WHEN backend mode has no chapters THEN ChatInput is shown as fallback", async () => {
    chaptersRef.value = [];
    const wrapper = mountMainLayout();
    await nextTick();
    expect(wrapper.findComponent(ChatInput).exists()).toBe(true);
  });

  it("WHEN ChatInput emits send and request succeeds THEN it reloads to last chapter", async () => {
    isLastChapterRef.value = true;
    sendMessageMock.mockResolvedValueOnce(true);
    const wrapper = mountMainLayout();
    await nextTick();

    wrapper.findComponent(ChatInput).vm.$emit("send", "hello");
    await Promise.resolve();

    expect(sendMessageMock).toHaveBeenCalledWith("series-a", "story-a", "hello");
    expect(reloadToLastMock).toHaveBeenCalledTimes(1);
  });

  it("WHEN backend context is incomplete THEN send/resend exits without API call", async () => {
    isLastChapterRef.value = true;
    backendContext.series = "";
    backendContext.story = "";
    const wrapper = mountMainLayout();
    await nextTick();

    wrapper.findComponent(ChatInput).vm.$emit("send", "hello");
    wrapper.findComponent(ChatInput).vm.$emit("resend", "retry");
    await Promise.resolve();

    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(resendMessageMock).not.toHaveBeenCalled();
    expect(reloadToLastMock).not.toHaveBeenCalled();
  });

  it("WHEN resend request fails THEN it does not reload chapters", async () => {
    isLastChapterRef.value = true;
    resendMessageMock.mockResolvedValueOnce(false);
    const wrapper = mountMainLayout();
    await nextTick();

    wrapper.findComponent(ChatInput).vm.$emit("resend", "retry");
    await Promise.resolve();

    expect(resendMessageMock).toHaveBeenCalledWith("series-a", "story-a", "retry");
    expect(reloadToLastMock).not.toHaveBeenCalled();
  });

  it("WHEN option-selected event is dispatched THEN selected text is appended to ChatInput", async () => {
    isLastChapterRef.value = true;
    const wrapper = mountMainLayout();
    await nextTick();

    document.dispatchEvent(new CustomEvent("option-selected", {
      detail: { text: "新的選項" },
    }));
    await nextTick();

    const textarea = wrapper.find("textarea").element as HTMLTextAreaElement;
    expect(textarea.value).toContain("新的選項");
  });
});
