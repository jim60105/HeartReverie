import { ref, computed } from "vue";
import { mount, flushPromises } from "@vue/test-utils";
import PassphraseGate from "@/components/PassphraseGate.vue";

const verifyMock = vi.fn();
const passphraseRef = ref("");
const isAuthenticatedRef = ref(false);

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    passphrase: passphraseRef,
    isAuthenticated: isAuthenticatedRef,
    verify: verifyMock,
  }),
}));

describe("PassphraseGate", () => {
  beforeEach(() => {
    verifyMock.mockReset();
    verifyMock.mockResolvedValue(false);
    passphraseRef.value = "";
    isAuthenticatedRef.value = false;
  });

  it("shows gate overlay when not authenticated", () => {
    const wrapper = mount(PassphraseGate);
    expect(wrapper.find(".gate-overlay").exists()).toBe(true);
    expect(wrapper.text()).toContain("通行密語");
  });

  it("shows password input", () => {
    const wrapper = mount(PassphraseGate);
    const input = wrapper.find("input[type='password']");
    expect(input.exists()).toBe(true);
  });

  it("shows error when submitting empty", async () => {
    const wrapper = mount(PassphraseGate);
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("請輸入通行密語");
  });

  it("calls verify with input value on submit", async () => {
    const wrapper = mount(PassphraseGate);
    await wrapper.find("input[type='password']").setValue("secret");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(verifyMock).toHaveBeenCalledWith("secret");
  });

  it("shows error on failed verification", async () => {
    verifyMock.mockResolvedValue(false);
    const wrapper = mount(PassphraseGate);
    await wrapper.find("input[type='password']").setValue("wrong");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("通行密語錯誤");
  });

  it("emits unlocked on successful verification", async () => {
    verifyMock.mockResolvedValue(true);
    const wrapper = mount(PassphraseGate);
    await wrapper.find("input[type='password']").setValue("correct");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.emitted("unlocked")).toBeTruthy();
  });

  it("auto-verifies on mount and emits unlocked if session valid", async () => {
    verifyMock.mockResolvedValue(true);
    const wrapper = mount(PassphraseGate);
    await flushPromises();
    expect(verifyMock).toHaveBeenCalled();
    expect(wrapper.emitted("unlocked")).toBeTruthy();
  });

  it("disables input and button while submitting", async () => {
    let resolveVerify: (v: boolean) => void;
    verifyMock.mockImplementation(
      () => new Promise<boolean>((r) => (resolveVerify = r)),
    );
    const wrapper = mount(PassphraseGate);
    await wrapper.find("input[type='password']").setValue("test");
    wrapper.find("form").trigger("submit");
    await wrapper.vm.$nextTick();

    const input = wrapper.find("input[type='password']")
      .element as HTMLInputElement;
    const btn = wrapper.find("button[type='submit']")
      .element as HTMLButtonElement;
    expect(input.disabled).toBe(true);
    expect(btn.disabled).toBe(true);
    expect(wrapper.text()).toContain("驗證中…");

    resolveVerify!(false);
    await flushPromises();
  });
});
