// Drawer behaviour tests for SettingsLayout: mobile toggle, dialog semantics,
// inert / aria-hidden state, focus management, and router auto-close.
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import SettingsLayout from "@/components/SettingsLayout.vue";

let afterEachCb: (() => void) | null = null;

const mockRouter = {
  push: vi.fn(),
  afterEach: vi.fn((cb: () => void) => {
    afterEachCb = cb;
    return () => {};
  }),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/router", () => ({
  default: { push: vi.fn(), replace: vi.fn() },
  settingsChildren: [
    { path: "prompt-editor", name: "settings-prompt-editor", component: { template: "<div />" }, meta: { title: "編排器" } },
    { path: "llm", name: "settings-llm", component: { template: "<div />" }, meta: { title: "LLM" } },
  ],
}));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve([]) })));

const RouterLinkStub = defineComponent({
  name: "RouterLink",
  props: ["to", "activeClass"],
  template: '<a class="router-link-stub" href="#"><slot /></a>',
});
const RouterViewStub = defineComponent({ name: "RouterView", template: '<div />' });
const AppHeaderStub = defineComponent({
  name: "AppHeader",
  template: '<header class="app-header-stub"><slot name="leading" /></header>',
});

interface MockMql {
  matches: boolean;
  _fire: (m: boolean) => void;
}
function setupMatchMedia(initial: boolean): MockMql {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mql: MockMql = {
    matches: initial,
    _fire(m: boolean) {
      this.matches = m;
      listeners.forEach((cb) => cb({ matches: m }));
    },
  };
  const fn = vi.fn(() => ({
    matches: mql.matches,
    addEventListener: (_e: string, cb: (e: { matches: boolean }) => void) => { listeners.add(cb); },
    removeEventListener: (_e: string, cb: (e: { matches: boolean }) => void) => { listeners.delete(cb); },
  }));
  vi.stubGlobal("matchMedia", fn);
  (window as unknown as { matchMedia: typeof fn }).matchMedia = fn;
  return mql;
}

function mountLayout() {
  return mount(SettingsLayout, {
    attachTo: document.body,
    global: { stubs: { "router-link": RouterLinkStub, "router-view": RouterViewStub, AppHeader: AppHeaderStub } },
  });
}

describe("SettingsLayout drawer", () => {
  beforeEach(() => {
    afterEachCb = null;
    mockRouter.push.mockReset();
    mockRouter.afterEach.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve([]) })));
  });

  it("does NOT render the toggle button on desktop", () => {
    setupMatchMedia(false);
    const wrapper = mountLayout();
    expect(wrapper.find(".drawer-toggle").exists()).toBe(false);
  });

  it("renders the toggle button on mobile with proper ARIA", async () => {
    setupMatchMedia(true);
    const wrapper = mountLayout();
    const toggle = wrapper.find(".drawer-toggle");
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("aria-controls")).toBe("settings-drawer");
    expect(toggle.attributes("aria-expanded")).toBe("false");
    expect(toggle.attributes("aria-label")).toBe("開啟設定選單");
  });

  it("drawer is inert + aria-hidden when closed on mobile, role=dialog set", () => {
    setupMatchMedia(true);
    const wrapper = mountLayout();
    const aside = wrapper.find("#settings-drawer");
    expect(aside.attributes("role")).toBe("dialog");
    expect(aside.attributes("aria-modal")).toBe("true");
    expect(aside.attributes("aria-labelledby")).toBe("settings-drawer-label");
    expect(aside.attributes("aria-hidden")).toBe("true");
    expect(aside.attributes("inert")).toBeDefined();
    expect(wrapper.find("#settings-drawer-label").exists()).toBe(true);
  });

  it("drawer is NOT inert and NOT aria-hidden on desktop", () => {
    setupMatchMedia(false);
    const wrapper = mountLayout();
    const aside = wrapper.find("#settings-drawer");
    expect(aside.attributes("inert")).toBeUndefined();
    expect(aside.attributes("aria-hidden")).toBe("false");
    expect(aside.attributes("role")).toBeUndefined();
    expect(aside.attributes("aria-modal")).toBeUndefined();
    expect(aside.attributes("aria-labelledby")).toBeUndefined();
  });

  it("opens on toggle click, focuses back-to-reader, updates aria-expanded, renders backdrop", async () => {
    setupMatchMedia(true);
    const wrapper = mountLayout();
    await wrapper.find(".drawer-toggle").trigger("click");
    await nextTick();
    const toggle = wrapper.find(".drawer-toggle");
    expect(toggle.attributes("aria-expanded")).toBe("true");
    const aside = wrapper.find("#settings-drawer");
    expect(aside.attributes("aria-hidden")).toBe("false");
    expect(aside.attributes("inert")).toBeUndefined();
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(true);
    const backBtn = wrapper.find(".back-btn").element as HTMLElement;
    expect(document.activeElement).toBe(backBtn);
  });

  it("backdrop click closes the drawer", async () => {
    setupMatchMedia(true);
    const wrapper = mountLayout();
    await wrapper.find(".drawer-toggle").trigger("click");
    await nextTick();
    await wrapper.find(".drawer-backdrop").trigger("click");
    await nextTick();
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(false);
    expect(wrapper.find(".drawer-toggle").attributes("aria-expanded")).toBe("false");
  });

  it("router.afterEach hook auto-closes the drawer on navigation", async () => {
    setupMatchMedia(true);
    const wrapper = mountLayout();
    await wrapper.find(".drawer-toggle").trigger("click");
    await nextTick();
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(true);
    expect(afterEachCb).toBeTypeOf("function");
    afterEachCb!();
    await nextTick();
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(false);
  });

  it("close returns focus to the toggle button", async () => {
    setupMatchMedia(true);
    const wrapper = mountLayout();
    const toggle = wrapper.find(".drawer-toggle").element as HTMLElement;
    await wrapper.find(".drawer-toggle").trigger("click");
    await nextTick();
    await wrapper.find(".drawer-toggle").trigger("click");
    await nextTick();
    expect(document.activeElement).toBe(toggle);
  });
});
