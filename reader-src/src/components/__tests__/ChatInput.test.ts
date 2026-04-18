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
    abortCurrentRequest: abortCurrentRequestFn,
  }),
}));

let mockSeries = "test-series";
let mockStory = "test-story";

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    getBackendContext: () => ({
      series: mockSeries,
      story: mockStory,
      isBackendMode: true,
    }),
  }),
}));

describe("ChatInput", () => {
  beforeEach(() => {
    isLoadingRef.value = false;
    errorMessageRef.value = "";
    streamingContentRef.value = "";
    abortCurrentRequestFn.mockClear();
    sessionStorage.clear();
    mockSeries = "test-series";
    mockStory = "test-story";
  });

  it("renders textarea and buttons", () => {
    const wrapper = mount(ChatInput);
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(wrapper.findAll("button").length).toBeGreaterThanOrEqual(2);
  });

  it("emits 'send' on send button click with textarea content", async () => {
    const wrapper = mount(ChatInput);
    await wrapper.find("textarea").setValue("hello");
    // Send button is the last .chat-btn
    const buttons = wrapper.findAll(".chat-btn");
    await buttons[buttons.length - 1]!.trigger("click");
    expect(wrapper.emitted("send")).toBeTruthy();
    expect(wrapper.emitted("send")![0]).toEqual(["hello"]);
  });

  it("emits 'resend' on resend button click", async () => {
    const wrapper = mount(ChatInput);
    await wrapper.find("textarea").setValue("resend this");
    // Resend button is the second-to-last .chat-btn
    const buttons = wrapper.findAll(".chat-btn");
    await buttons[buttons.length - 2]!.trigger("click");
    expect(wrapper.emitted("resend")).toBeTruthy();
    expect(wrapper.emitted("resend")![0]).toEqual(["resend this"]);
  });

  it("Enter key triggers send, not inserting newline", async () => {
    const wrapper = mount(ChatInput);
    await wrapper.find("textarea").setValue("enter test");
    await wrapper.find("textarea").trigger("keydown", {
      key: "Enter",
      shiftKey: false,
    });
    expect(wrapper.emitted("send")).toBeTruthy();
  });

  it("Shift+Enter does not trigger send", async () => {
    const wrapper = mount(ChatInput);
    await wrapper.find("textarea").setValue("shift enter test");
    await wrapper.find("textarea").trigger("keydown", {
      key: "Enter",
      shiftKey: true,
    });
    expect(wrapper.emitted("send")).toBeFalsy();
  });

  it("appendText via defineExpose adds text", async () => {
    const wrapper = mount(ChatInput);
    (wrapper.vm as unknown as { appendText: (t: string) => void }).appendText(
      "appended",
    );
    await wrapper.vm.$nextTick();
    const ta = wrapper.find("textarea").element as HTMLTextAreaElement;
    expect(ta.value).toContain("appended");
  });

  it("does not emit send with empty textarea", async () => {
    const wrapper = mount(ChatInput);
    const buttons = wrapper.findAll(".chat-btn");
    await buttons[buttons.length - 1]!.trigger("click");
    expect(wrapper.emitted("send")).toBeFalsy();
  });

  it("shows error message for empty submit", async () => {
    const wrapper = mount(ChatInput);
    const buttons = wrapper.findAll(".chat-btn");
    await buttons[buttons.length - 1]!.trigger("click");
    expect(errorMessageRef.value).toBe("請輸入故事指令");
  });

  it("disables textarea when disabled prop is true", () => {
    const wrapper = mount(ChatInput, { props: { disabled: true } });
    expect(
      (wrapper.find("textarea").element as HTMLTextAreaElement).disabled,
    ).toBe(true);
  });

  it("streaming preview appears when isLoading and streamingContent has content", async () => {
    isLoadingRef.value = true;
    streamingContentRef.value = "Generating response...";
    const wrapper = mount(ChatInput);
    await wrapper.vm.$nextTick();
    const preview = wrapper.find(".streaming-preview");
    expect(preview.exists()).toBe(true);
    expect(preview.text()).toBe("Generating response...");
  });

  it("no streaming preview when not loading", async () => {
    isLoadingRef.value = false;
    streamingContentRef.value = "Some leftover content";
    const wrapper = mount(ChatInput);
    await wrapper.vm.$nextTick();
    expect(wrapper.find(".streaming-preview").exists()).toBe(false);
  });

  describe("Stop button", () => {
    it("shows Stop button and hides Send button when loading", async () => {
      isLoadingRef.value = true;
      const wrapper = mount(ChatInput);
      await wrapper.vm.$nextTick();
      const stopBtn = wrapper.find(".chat-btn-stop");
      expect(stopBtn.exists()).toBe(true);
      expect(stopBtn.text()).toContain("停止");
      // Send button should not exist (v-if/v-else)
      const buttons = wrapper.findAll(".chat-btn");
      const sendBtn = buttons.find((b) => b.text().includes("發送"));
      expect(sendBtn).toBeUndefined();
    });

    it("shows Send button and hides Stop button when not loading", () => {
      isLoadingRef.value = false;
      const wrapper = mount(ChatInput);
      const stopBtn = wrapper.find(".chat-btn-stop");
      expect(stopBtn.exists()).toBe(false);
      const buttons = wrapper.findAll(".chat-btn");
      const sendBtn = buttons.find((b) => b.text().includes("發送"));
      expect(sendBtn).toBeTruthy();
    });

    it("calls abortCurrentRequest when Stop button clicked", async () => {
      isLoadingRef.value = true;
      const wrapper = mount(ChatInput);
      await wrapper.vm.$nextTick();
      const stopBtn = wrapper.find(".chat-btn-stop");
      await stopBtn.trigger("click");
      expect(abortCurrentRequestFn).toHaveBeenCalledTimes(1);
    });

    it("Send button reappears after loading ends", async () => {
      isLoadingRef.value = true;
      const wrapper = mount(ChatInput);
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".chat-btn-stop").exists()).toBe(true);

      isLoadingRef.value = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".chat-btn-stop").exists()).toBe(false);
      const buttons = wrapper.findAll(".chat-btn");
      const sendBtn = buttons.find((b) => b.text().includes("發送"));
      expect(sendBtn).toBeTruthy();
    });
  });

  describe("sessionStorage persistence", () => {
    const storageKey = "heartreverie:chat-input:test-series:test-story";

    it("saves text to sessionStorage on send", async () => {
      const wrapper = mount(ChatInput);
      await wrapper.find("textarea").setValue("hello world");
      const buttons = wrapper.findAll(".chat-btn");
      await buttons[buttons.length - 1]!.trigger("click");
      expect(sessionStorage.getItem(storageKey)).toBe("hello world");
    });

    it("saves text to sessionStorage on resend", async () => {
      const wrapper = mount(ChatInput);
      await wrapper.find("textarea").setValue("resend text");
      const buttons = wrapper.findAll(".chat-btn");
      await buttons[buttons.length - 2]!.trigger("click");
      expect(sessionStorage.getItem(storageKey)).toBe("resend text");
    });

    it("restores text from sessionStorage on mount", () => {
      sessionStorage.setItem(storageKey, "restored text");
      const wrapper = mount(ChatInput);
      const ta = wrapper.find("textarea").element as HTMLTextAreaElement;
      expect(ta.value).toBe("restored text");
    });

    it("defaults to empty string when no stored value", () => {
      const wrapper = mount(ChatInput);
      const ta = wrapper.find("textarea").element as HTMLTextAreaElement;
      expect(ta.value).toBe("");
    });

    it("text survives component remount", async () => {
      const wrapper = mount(ChatInput);
      await wrapper.find("textarea").setValue("persist me");
      const buttons = wrapper.findAll(".chat-btn");
      await buttons[buttons.length - 1]!.trigger("click");
      wrapper.unmount();

      const wrapper2 = mount(ChatInput);
      const ta = wrapper2.find("textarea").element as HTMLTextAreaElement;
      expect(ta.value).toBe("persist me");
    });

    it("isolates storage per story", async () => {
      const wrapper = mount(ChatInput);
      await wrapper.find("textarea").setValue("story A text");
      const buttons = wrapper.findAll(".chat-btn");
      await buttons[buttons.length - 1]!.trigger("click");
      wrapper.unmount();

      mockSeries = "other-series";
      mockStory = "other-story";
      const wrapper2 = mount(ChatInput);
      const ta = wrapper2.find("textarea").element as HTMLTextAreaElement;
      expect(ta.value).toBe("");
    });

    it("handles sessionStorage errors gracefully", () => {
      const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError");
      });
      const wrapper = mount(ChatInput);
      const ta = wrapper.find("textarea").element as HTMLTextAreaElement;
      expect(ta.value).toBe("");
      getItemSpy.mockRestore();
    });

    it("handles sessionStorage setItem errors gracefully", async () => {
      const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      const wrapper = mount(ChatInput);
      await wrapper.find("textarea").setValue("text");
      const buttons = wrapper.findAll(".chat-btn");
      // Should not throw
      await buttons[buttons.length - 1]!.trigger("click");
      expect(wrapper.emitted("send")).toBeTruthy();
      setItemSpy.mockRestore();
    });
  });
});
