import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import AppHeader from "@/components/AppHeader.vue";

const mockRouter = { push: vi.fn() };
const currentIndexRef = ref(0);
const totalChaptersRef = ref(3);
const isFirstRef = ref(true);
const isLastRef = ref(false);
const modeRef = ref<"fsa" | "backend">("backend");
const folderNameRef = ref("test-folder");
const isSupportedRef = ref(true);
const directoryHandleRef = ref<FileSystemDirectoryHandle | null>(null);
const backendContextRef = ref({
  series: "test-series" as string | null,
  story: "test-story" as string | null,
  isBackendMode: true,
});

const nextMock = vi.fn();
const previousMock = vi.fn();
const loadFromFSAMock = vi.fn().mockResolvedValue(undefined);
const reloadToLastMock = vi.fn().mockResolvedValue(undefined);
const openDirectoryMock = vi.fn().mockResolvedValue(undefined);

vi.mock("vue-router", () => ({
  useRouter: () => mockRouter,
}));

vi.mock("@/composables/useChapterNav", () => ({
  useChapterNav: () => ({
    currentIndex: currentIndexRef,
    totalChapters: totalChaptersRef,
    isFirst: isFirstRef,
    isLast: isLastRef,
    mode: modeRef,
    folderName: folderNameRef,
    next: nextMock,
    previous: previousMock,
    loadFromFSA: loadFromFSAMock,
    reloadToLast: reloadToLastMock,
    getBackendContext: () => backendContextRef.value,
  }),
}));

vi.mock("@/composables/useFileReader", () => ({
  useFileReader: () => ({
    isSupported: isSupportedRef,
    openDirectory: openDirectoryMock,
    directoryHandle: directoryHandleRef,
  }),
}));

vi.mock("@/components/StorySelector.vue", () => ({
  default: { template: "<div class='story-selector-stub'></div>" },
}));

describe("AppHeader", () => {
  beforeEach(() => {
    currentIndexRef.value = 0;
    totalChaptersRef.value = 3;
    isFirstRef.value = true;
    isLastRef.value = false;
    modeRef.value = "backend";
    folderNameRef.value = "test-folder";
    isSupportedRef.value = true;
    directoryHandleRef.value = null;
    backendContextRef.value = {
      series: "test-series",
      story: "test-story",
      isBackendMode: true,
    };
    mockRouter.push.mockReset();
    nextMock.mockReset();
    previousMock.mockReset();
    loadFromFSAMock.mockReset();
    reloadToLastMock.mockReset();
    openDirectoryMock.mockReset();
  });

  it("shows controls and navigates to settings in backend mode", async () => {
    const wrapper = mount(AppHeader);
    expect(wrapper.find(".header-btn--icon").exists()).toBe(true);
    expect(wrapper.text()).toContain("1 / 3");

    await wrapper.find(".header-btn--icon").trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({ name: "settings-prompt-editor" });
  });

  it("loads selected folder and chapter list", async () => {
    const handle = { name: "dir" } as unknown as FileSystemDirectoryHandle;
    openDirectoryMock.mockImplementationOnce(async () => {
      directoryHandleRef.value = handle;
    });

    const wrapper = mount(AppHeader);
    await wrapper.findAll("button")[0]!.trigger("click");
    await flushPromises();

    expect(openDirectoryMock).toHaveBeenCalledTimes(1);
    expect(loadFromFSAMock).toHaveBeenCalledWith(handle);
  });

  it("reloads from FSA or backend based on mode", async () => {
    const wrapper = mount(AppHeader);
    const reloadBtn = wrapper.find(".header-btn--reload");

    modeRef.value = "fsa";
    directoryHandleRef.value = { name: "dir" } as unknown as FileSystemDirectoryHandle;
    await reloadBtn.trigger("click");
    expect(loadFromFSAMock).toHaveBeenCalledTimes(1);

    modeRef.value = "backend";
    await reloadBtn.trigger("click");
    expect(reloadToLastMock).toHaveBeenCalledTimes(1);
  });

  it("hides context-sensitive controls in fallback states", () => {
    isSupportedRef.value = false;
    totalChaptersRef.value = 0;
    backendContextRef.value = { series: null, story: null, isBackendMode: false };

    const wrapper = mount(AppHeader);
    expect(wrapper.find(".header-btn--icon").exists()).toBe(false);
    expect(wrapper.find(".header-btn--reload").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("上一章");
    expect(wrapper.text()).not.toContain("下一章");
  });

  it("triggers previous/next navigation buttons", async () => {
    isFirstRef.value = false;
    isLastRef.value = false;
    const wrapper = mount(AppHeader);

    await wrapper.findAll("button").find((b) => b.text().includes("上一章"))!.trigger("click");
    await wrapper.findAll("button").find((b) => b.text().includes("下一章"))!.trigger("click");

    expect(previousMock).toHaveBeenCalledTimes(1);
    expect(nextMock).toHaveBeenCalledTimes(1);
  });
});
