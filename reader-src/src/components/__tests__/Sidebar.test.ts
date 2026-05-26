import { nextTick, ref } from "vue";
import { mount } from "@vue/test-utils";
import Sidebar from "@/components/Sidebar.vue";

const isLoadingRef = ref(false);

vi.mock("@/composables/useChatApi", () => ({
  useChatApi: () => ({
    isLoading: isLoadingRef,
  }),
}));

describe("Sidebar", () => {
  beforeEach(() => {
    isLoadingRef.value = false;
  });

  it("renders <aside class='sidebar'> with slot content", () => {
    const wrapper = mount(Sidebar, {
      slots: { default: "<div data-testid='child'>x</div>" },
    });
    const aside = wrapper.find("aside.sidebar");
    expect(aside.exists()).toBe(true);
    expect(aside.find("[data-testid='child']").exists()).toBe(true);
  });

  it("starts visible on fresh mount (isLoading defaults to false)", () => {
    const wrapper = mount(Sidebar);
    expect(wrapper.classes("sidebar--hidden-during-stream")).toBe(false);
  });

  it("adds the hidden-during-stream class while isLoading is true", async () => {
    const wrapper = mount(Sidebar);
    expect(wrapper.classes("sidebar--hidden-during-stream")).toBe(false);
    isLoadingRef.value = true;
    await nextTick();
    expect(wrapper.classes("sidebar--hidden-during-stream")).toBe(true);
  });

  it("removes the hidden-during-stream class when isLoading flips to false", async () => {
    isLoadingRef.value = true;
    const wrapper = mount(Sidebar);
    expect(wrapper.classes("sidebar--hidden-during-stream")).toBe(true);
    isLoadingRef.value = false;
    await nextTick();
    expect(wrapper.classes("sidebar--hidden-during-stream")).toBe(false);
  });

  it("preserves slot DOM nodes across hide/show toggles (no unmount)", async () => {
    const wrapper = mount(Sidebar, {
      slots: { default: "<div data-testid='child'>x</div>" },
    });
    const child = wrapper.find("[data-testid='child']").element;

    isLoadingRef.value = true;
    await nextTick();
    expect(wrapper.find("[data-testid='child']").element).toBe(child);

    isLoadingRef.value = false;
    await nextTick();
    expect(wrapper.find("[data-testid='child']").element).toBe(child);

    isLoadingRef.value = true;
    await nextTick();
    expect(wrapper.find("[data-testid='child']").element).toBe(child);
  });
});
