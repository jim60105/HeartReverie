import { defineComponent, h, nextTick } from "vue";
import { mount } from "@vue/test-utils";
import { useSidebarDrawer } from "@/composables/useSidebarDrawer";

type ChangeListener = (event: { matches: boolean }) => void;

interface MockMql {
  matches: boolean;
  addEventListener: (_e: string, cb: ChangeListener) => void;
  removeEventListener: (_e: string, cb: ChangeListener) => void;
  _fire: (matches: boolean) => void;
}

function createMockMql(initial: boolean): MockMql {
  const listeners = new Set<ChangeListener>();
  return {
    matches: initial,
    addEventListener: (_e, cb) => { listeners.add(cb); },
    removeEventListener: (_e, cb) => { listeners.delete(cb); },
    _fire(matches: boolean) {
      this.matches = matches;
      for (const cb of listeners) cb({ matches });
    },
  };
}

let afterEachCb: (() => void) | null = null;
const afterEachUnregister = vi.fn();
const mockRouter = {
  afterEach: vi.fn((cb: () => void) => {
    afterEachCb = cb;
    return afterEachUnregister;
  }),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

describe("useSidebarDrawer", () => {
  let mql: MockMql;

  beforeEach(() => {
    afterEachCb = null;
    afterEachUnregister.mockReset();
    mockRouter.afterEach.mockClear();
    mql = createMockMql(true); // start mobile
    vi.stubGlobal("matchMedia", vi.fn(() => mql));
    (window as unknown as { matchMedia: () => MockMql }).matchMedia = () => mql;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountHarness() {
    let api: ReturnType<typeof useSidebarDrawer> | null = null;
    const Test = defineComponent({
      setup() {
        api = useSidebarDrawer();
        return () =>
          h("div", [
            h("button", { ref: (el) => { api!.triggerRef.value = el as HTMLElement; }, class: "trigger" }, "toggle"),
            h(
              "aside",
              { ref: (el) => { api!.drawerRef.value = el as HTMLElement; }, class: "drawer", onKeydown: api!.onKeydownTrap },
              [
                h("button", { class: "back-btn" }, "back"),
                h("a", { href: "#a", class: "link-a" }, "A"),
                h("a", { href: "#b", class: "link-b" }, "B"),
              ],
            ),
          ]);
      },
    });
    const wrapper = mount(Test, { attachTo: document.body });
    return { wrapper, get api() { return api!; } };
  }

  it("starts closed and exposes open/close/toggle", async () => {
    const { api } = mountHarness();
    expect(api.isOpen.value).toBe(false);
    api.open();
    expect(api.isOpen.value).toBe(true);
    api.close();
    expect(api.isOpen.value).toBe(false);
    api.toggle();
    expect(api.isOpen.value).toBe(true);
    api.toggle();
    expect(api.isOpen.value).toBe(false);
  });

  it("isMobile reflects matchMedia and flips on change events", async () => {
    const { api } = mountHarness();
    expect(api.isMobile.value).toBe(true);
    mql._fire(false);
    await nextTick();
    expect(api.isMobile.value).toBe(false);
    mql._fire(true);
    await nextTick();
    expect(api.isMobile.value).toBe(true);
  });

  it("Escape closes the drawer when open && mobile", async () => {
    const { api } = mountHarness();
    api.open();
    await nextTick();
    expect(api.isOpen.value).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(api.isOpen.value).toBe(false);
  });

  it("Escape does NOT close when !isMobile", async () => {
    mql._fire(false); // desktop
    const { api } = mountHarness();
    await nextTick();
    api.isOpen.value = true;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(api.isOpen.value).toBe(true);
  });

  it("router.afterEach hook closes the drawer", async () => {
    const { api } = mountHarness();
    api.open();
    await nextTick();
    expect(api.isOpen.value).toBe(true);
    expect(afterEachCb).toBeTypeOf("function");
    afterEachCb!();
    expect(api.isOpen.value).toBe(false);
  });

  it("focuses first focusable inside drawer on open", async () => {
    const { wrapper, api } = mountHarness();
    api.open();
    await nextTick();
    const backBtn = wrapper.find(".back-btn").element as HTMLElement;
    expect(document.activeElement).toBe(backBtn);
  });

  it("returns focus to the trigger element on close", async () => {
    const { wrapper, api } = mountHarness();
    api.open();
    await nextTick();
    api.close();
    await nextTick();
    const trigger = wrapper.find(".trigger").element as HTMLElement;
    expect(document.activeElement).toBe(trigger);
  });

  it("Tab from last focusable wraps to first; Shift+Tab from first wraps to last", async () => {
    const { wrapper, api } = mountHarness();
    api.open();
    await nextTick();
    const back = wrapper.find(".back-btn").element as HTMLElement;
    const linkB = wrapper.find(".link-b").element as HTMLElement;
    const drawer = wrapper.find(".drawer").element as HTMLElement;

    linkB.focus();
    const ev1 = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
    drawer.dispatchEvent(ev1);
    expect(document.activeElement).toBe(back);

    back.focus();
    const ev2 = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
    drawer.dispatchEvent(ev2);
    expect(document.activeElement).toBe(linkB);
  });

  it("unregisters listeners and afterEach on unmount", () => {
    const { wrapper } = mountHarness();
    wrapper.unmount();
    expect(afterEachUnregister).toHaveBeenCalledTimes(1);
  });
});
