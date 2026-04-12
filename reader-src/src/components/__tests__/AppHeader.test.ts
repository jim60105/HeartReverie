import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import AppHeader from "@/components/AppHeader.vue";

const mockRouter = { push: vi.fn() };

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
  createRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
  })),
  createWebHistory: vi.fn(),
}));

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    currentIndex: { value: 0 },
    totalChapters: { value: 3 },
    isFirst: { value: true },
    isLast: { value: false },
    mode: { value: "backend" },
    folderName: { value: "test-folder" },
    next: vi.fn(),
    previous: vi.fn(),
    loadFromFSA: vi.fn(),
    reloadToLast: vi.fn(),
    getBackendContext: () => ({
      series: "test-series",
      story: "test-story",
      isBackendMode: true,
    }),
  }),
}));

vi.mock("@/composables/useFileReader", () => ({
  useFileReader: () => ({
    isSupported: { value: true },
    openDirectory: vi.fn(),
    directoryHandle: { value: null },
  }),
}));

const StorySelectorStub = defineComponent({
  name: "StorySelector",
  template: "<div>story-selector-stub</div>",
});

function mountHeader() {
  return mount(AppHeader, {
    global: {
      stubs: {
        StorySelector: StorySelectorStub,
      },
    },
  });
}

describe("AppHeader", () => {
  beforeEach(() => {
    mockRouter.push.mockReset();
  });

  it("renders without crashing", () => {
    const wrapper = mountHeader();
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the gear icon settings button in backend mode", () => {
    const wrapper = mountHeader();
    const settingsBtn = wrapper.find(".header-btn--icon");
    expect(settingsBtn.exists()).toBe(true);
    expect(settingsBtn.text()).toContain("⚙️");
  });

  it("navigates to settings-prompt-editor on gear icon click", async () => {
    const wrapper = mountHeader();
    const settingsBtn = wrapper.find(".header-btn--icon");
    await settingsBtn.trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: "settings-prompt-editor",
    });
  });

  it("shows folder name", () => {
    const wrapper = mountHeader();
    expect(wrapper.text()).toContain("test-folder");
  });

  it("renders chapter navigation buttons when chapters exist", () => {
    const wrapper = mountHeader();
    expect(wrapper.text()).toContain("上一章");
    expect(wrapper.text()).toContain("下一章");
  });

  it("shows chapter progress", () => {
    const wrapper = mountHeader();
    expect(wrapper.text()).toContain("1 / 3");
  });
});
