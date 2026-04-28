import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import SettingsLayout from "@/components/SettingsLayout.vue";
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";
import type { RouteLocationNormalizedLoaded } from "vue-router";

const mockRouter = {
  push: vi.fn(),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/router", () => ({
  default: {
    push: vi.fn(),
    replace: vi.fn(),
  },
  settingsChildren: [
    {
      path: "prompt-editor",
      name: "settings-prompt-editor",
      component: { template: "<div>mock</div>" },
      meta: { title: "編排器" },
    },
  ],
}));

const RouterLinkStub = defineComponent({
  name: "RouterLink",
  props: ["to", "activeClass"],
  template: '<a class="router-link-stub"><slot /></a>',
});

const RouterViewStub = defineComponent({
  name: "RouterView",
  template: '<div class="router-view-stub"></div>',
});

function mountLayout() {
  return mount(SettingsLayout, {
    global: {
      stubs: {
        "router-link": RouterLinkStub,
        "router-view": RouterViewStub,
      },
    },
  });
}

function makeRoute(
  partial: Partial<RouteLocationNormalizedLoaded> & { path: string },
): RouteLocationNormalizedLoaded {
  return {
    name: undefined,
    params: {},
    query: {},
    hash: "",
    fullPath: partial.path,
    matched: [],
    meta: {},
    redirectedFrom: undefined,
    ...partial,
  } as RouteLocationNormalizedLoaded;
}

describe("SettingsLayout", () => {
  beforeEach(() => {
    mockRouter.push.mockReset();
    const { clear } = useLastReadingRoute();
    clear();
  });

  it("renders without crashing", () => {
    const wrapper = mountLayout();
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the sidebar with navigation links", () => {
    const wrapper = mountLayout();
    expect(wrapper.find(".settings-sidebar").exists()).toBe(true);
    expect(wrapper.find(".sidebar-nav").exists()).toBe(true);
  });

  it("renders router-view for content area", () => {
    const wrapper = mountLayout();
    expect(wrapper.find(".settings-content").exists()).toBe(true);
    expect(wrapper.find(".router-view-stub").exists()).toBe(true);
  });

  it("renders sidebar links from settingsChildren", () => {
    const wrapper = mountLayout();
    const links = wrapper.findAll(".router-link-stub");
    expect(links.length).toBe(1);
    expect(links[0]!.text()).toContain("編排器");
  });

  it("sidebar links use active-class sidebar-link--active", () => {
    const wrapper = mountLayout();
    const link = wrapper.findComponent({ name: "RouterLink" });
    expect(link.exists()).toBe(true);
    expect(link.props("activeClass")).toBe("sidebar-link--active");
  });

  it("renders back button", () => {
    const wrapper = mountLayout();
    const backBtn = wrapper.find(".back-btn");
    expect(backBtn.exists()).toBe(true);
    expect(backBtn.text()).toContain("返回閱讀");
  });

  it("back button navigates to home when no reading route was recorded", async () => {
    const wrapper = mountLayout();
    await wrapper.find(".back-btn").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({ name: "home" });
  });

  it("back button navigates to the captured chapter route", async () => {
    const { recordReadingRoute } = useLastReadingRoute();
    recordReadingRoute(
      makeRoute({
        path: "/storyA/storyB/chapter/3",
        name: "chapter",
        params: { series: "storyA", story: "storyB", chapter: "3" },
        query: {},
        hash: "",
      }),
    );
    const wrapper = mountLayout();
    await wrapper.find(".back-btn").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "chapter",
      params: { series: "storyA", story: "storyB", chapter: "3" },
      query: {},
      hash: "",
    });
  });

  it("multi-tab scenario: settings tab navigation does not overwrite the reading capture", async () => {
    const { recordReadingRoute } = useLastReadingRoute();
    recordReadingRoute(
      makeRoute({
        path: "/storyA/storyB/chapter/3",
        name: "chapter",
        params: { series: "storyA", story: "storyB", chapter: "3" },
      }),
    );
    recordReadingRoute(
      makeRoute({ path: "/settings/prompt-editor", name: "settings-prompt-editor" }),
    );
    recordReadingRoute(
      makeRoute({ path: "/settings/llm", name: "settings-llm" }),
    );
    const wrapper = mountLayout();
    await wrapper.find(".back-btn").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "chapter",
      params: { series: "storyA", story: "storyB", chapter: "3" },
      query: {},
      hash: "",
    });
  });

  it("re-entry scenario: guard re-captures on returning to a reading route after settings", async () => {
    const { recordReadingRoute } = useLastReadingRoute();
    recordReadingRoute(makeRoute({ path: "/", name: "home" }));
    recordReadingRoute(makeRoute({ path: "/settings/llm", name: "settings-llm" }));
    recordReadingRoute(
      makeRoute({ path: "/storyA", name: "story", params: { series: "storyA" } }),
    );
    recordReadingRoute(makeRoute({ path: "/settings/lore", name: "settings-lore" }));
    const wrapper = mountLayout();
    await wrapper.find(".back-btn").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "story",
      params: { series: "storyA" },
      query: {},
      hash: "",
    });
  });
});
