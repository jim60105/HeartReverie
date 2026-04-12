import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import SettingsLayout from "@/components/SettingsLayout.vue";

const mockRouter = {
  push: vi.fn(),
  back: vi.fn(),
  options: { history: { state: { back: null as string | null } } },
};

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/router", () => ({
  default: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    options: { history: { state: {} } },
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

describe("SettingsLayout", () => {
  beforeEach(() => {
    mockRouter.push.mockReset();
    mockRouter.back.mockReset();
    mockRouter.options.history.state.back = null;
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

  it("back button calls router.back() when history exists", async () => {
    mockRouter.options.history.state.back = "/some-page";
    const wrapper = mountLayout();
    await wrapper.find(".back-btn").trigger("click");
    expect(mockRouter.back).toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
  });

  it("back button navigates to home when no history", async () => {
    mockRouter.options.history.state.back = null;
    const wrapper = mountLayout();
    await wrapper.find(".back-btn").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({ name: "home" });
    expect(mockRouter.back).not.toHaveBeenCalled();
  });
});
