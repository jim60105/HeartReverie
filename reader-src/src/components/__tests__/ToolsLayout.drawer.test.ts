// Drawer behaviour parity test for ToolsLayout.
import { mount } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import ToolsLayout from "@/components/ToolsLayout.vue";

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
  toolsChildren: [
    { path: "new-series", name: "tools-new-series", component: { template: "<div />" }, meta: { title: "新增系列" } },
    { path: "lore-import", name: "tools-lore-import", component: { template: "<div />" }, meta: { title: "匯入" } },
  ],
}));

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

function setupMatchMedia(initial: boolean) {
  const fn = vi.fn(() => ({
    matches: initial,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal("matchMedia", fn);
  (window as unknown as { matchMedia: typeof fn }).matchMedia = fn;
}

function mountLayout() {
  return mount(ToolsLayout, {
    attachTo: document.body,
    global: { stubs: { "router-link": RouterLinkStub, "router-view": RouterViewStub, AppHeader: AppHeaderStub } },
  });
}

describe("ToolsLayout drawer", () => {
  beforeEach(() => {
    afterEachCb = null;
    mockRouter.push.mockReset();
    mockRouter.afterEach.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hides drawer-toggle and omits dialog semantics on desktop", () => {
    setupMatchMedia(false);
    const wrapper = mountLayout();
    expect(wrapper.find(".drawer-toggle").exists()).toBe(false);
    const aside = wrapper.find("#tools-drawer");
    expect(aside.attributes("role")).toBeUndefined();
    expect(aside.attributes("aria-modal")).toBeUndefined();
    expect(aside.attributes("aria-labelledby")).toBeUndefined();
  });

  it("renders toggle + drawer dialog semantics on mobile", async () => {
    setupMatchMedia(true);
    const wrapper = mountLayout();
    const toggle = wrapper.find(".drawer-toggle");
    expect(toggle.exists()).toBe(true);
    expect(toggle.attributes("aria-controls")).toBe("tools-drawer");
    expect(toggle.attributes("aria-label")).toBe("開啟工具選單");
    const aside = wrapper.find("#tools-drawer");
    expect(aside.attributes("role")).toBe("dialog");
    expect(aside.attributes("aria-modal")).toBe("true");
    expect(aside.attributes("aria-labelledby")).toBe("tools-drawer-label");
    expect(aside.attributes("inert")).toBeDefined();
    expect(aside.attributes("aria-hidden")).toBe("true");
  });

  it("opens drawer, focuses back-to-reader, auto-closes on route nav", async () => {
    setupMatchMedia(true);
    const wrapper = mountLayout();
    await wrapper.find(".drawer-toggle").trigger("click");
    await nextTick();
    const backBtn = wrapper.find(".back-btn").element as HTMLElement;
    expect(document.activeElement).toBe(backBtn);
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(true);
    afterEachCb!();
    await nextTick();
    expect(wrapper.find(".drawer-backdrop").exists()).toBe(false);
  });
});
