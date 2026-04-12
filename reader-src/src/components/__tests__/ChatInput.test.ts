import { ref } from "vue";
import { mount } from "@vue/test-utils";
import ChatInput from "@/components/ChatInput.vue";

const isLoadingRef = ref(false);
const errorMessageRef = ref("");

vi.mock("@/composables/useChatApi", () => ({
  useChatApi: () => ({
    isLoading: isLoadingRef,
    errorMessage: errorMessageRef,
    sendMessage: vi.fn(),
    resendMessage: vi.fn(),
  }),
}));

describe("ChatInput", () => {
  beforeEach(() => {
    isLoadingRef.value = false;
    errorMessageRef.value = "";
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
});
