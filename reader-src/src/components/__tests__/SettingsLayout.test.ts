import { mount, flushPromises } from "@vue/test-utils";
import { defineComponent, nextTick } from "vue";
import SettingsLayout from "@/components/SettingsLayout.vue";
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";
import type { RouteLocationNormalizedLoaded } from "vue-router";

const mockRouter = {
  push: vi.fn(),
  afterEach: vi.fn(() => () => {}),
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "pp" }),
  }),
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
        AppHeader: defineComponent({ name: "AppHeader", template: '<header class="app-header-stub"><slot name="leading" /></header>' }),
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
  afterEach(() => {
    vi.unstubAllGlobals();
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

  it("renders plugin tabs using displayName (not slug) while routing by slug", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        /\/api\/plugins\/?$/.test(url)
          ? [{ name: "dialogue-colorize", displayName: "對話著色", hasSettings: true }]
          : [],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mountLayout();
    await flushPromises();
    await nextTick();

    // The plugin link is rendered using the zh-TW label, not the slug.
    const links = wrapper.findAllComponents({ name: "RouterLink" });
    const pluginLink = links.find((l) => l.text().includes("對話著色"));
    expect(pluginLink, "plugin tab rendered with displayName").toBeTruthy();
    expect(pluginLink!.text()).toContain("對話著色");
    expect(pluginLink!.text()).not.toContain("dialogue-colorize");

    // Routing target carries the slug (so URLs remain stable), not the label.
    const to = pluginLink!.props("to") as {
      name: string;
      params: { pluginName: string };
    };
    expect(to.name).toBe("settings-plugin");
    expect(to.params.pluginName).toBe("dialogue-colorize");
  });
});
