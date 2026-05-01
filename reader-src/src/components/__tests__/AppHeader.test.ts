import { ref } from "vue";
import { mount } from "@vue/test-utils";
import AppHeader from "@/components/AppHeader.vue";

const mockRouter = { push: vi.fn() };
const currentIndexRef = ref(0);
const totalChaptersRef = ref(3);
const isFirstRef = ref(true);
const isLastRef = ref(false);
const modeRef = ref<"fsa" | "backend">("backend");
const folderNameRef = ref("test-folder");
const directoryHandleRef = ref<FileSystemDirectoryHandle | null>(null);
const backendContextRef = ref({
  series: "test-series" as string | null,
  story: "test-story" as string | null,
  isBackendMode: true,
});

const nextMock = vi.fn();
const previousMock = vi.fn();
const goToFirstMock = vi.fn();
const goToLastMock = vi.fn();
const loadFromFSAMock = vi.fn().mockResolvedValue(undefined);
const reloadToLastMock = vi.fn().mockResolvedValue(undefined);

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
    goToFirst: goToFirstMock,
    goToLast: goToLastMock,
    loadFromFSA: loadFromFSAMock,
    reloadToLast: reloadToLastMock,
    getBackendContext: () => backendContextRef.value,
  }),
}));

vi.mock("@/composables/useFileReader", () => ({
  useFileReader: () => ({
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
    directoryHandleRef.value = null;
    backendContextRef.value = {
      series: "test-series",
      story: "test-story",
      isBackendMode: true,
    };
    mockRouter.push.mockReset();
    nextMock.mockReset();
    previousMock.mockReset();
    goToFirstMock.mockReset();
    goToLastMock.mockReset();
    loadFromFSAMock.mockReset();
    reloadToLastMock.mockReset();
  });

  it("does NOT render any 選擇資料夾 / folder-picker button", () => {
    const wrapper = mount(AppHeader);
    expect(wrapper.text()).not.toContain("選擇資料夾");
    expect(wrapper.text()).not.toContain("📂");
  });

  it("shows controls and navigates to settings in backend mode", async () => {
    const wrapper = mount(AppHeader);
    expect(wrapper.text()).toContain("1 / 3");

    const settingsBtn = wrapper.findAll("button").find((b) => b.text() === "⚙️");
    expect(settingsBtn).toBeTruthy();
    await settingsBtn!.trigger("click");
    expect(mockRouter.push).toHaveBeenCalledWith({ name: "settings-prompt-editor" });
  });

  it("reloads from FSA or backend based on mode", async () => {
    const wrapper = mount(AppHeader);
    const reloadBtn = wrapper.findAll("button").find((b) => b.text() === "🔄");
    expect(reloadBtn).toBeTruthy();

    modeRef.value = "fsa";
    directoryHandleRef.value = { name: "dir" } as unknown as FileSystemDirectoryHandle;
    await reloadBtn!.trigger("click");
    expect(loadFromFSAMock).toHaveBeenCalledTimes(1);

    modeRef.value = "backend";
    await reloadBtn!.trigger("click");
    expect(reloadToLastMock).toHaveBeenCalledTimes(1);
  });

  it("hides nav cluster when no chapters are loaded", () => {
    totalChaptersRef.value = 0;
    backendContextRef.value = { series: null, story: null, isBackendMode: false };

    const wrapper = mount(AppHeader);
    expect(wrapper.findAll("button").find((b) => b.text() === "🔄")).toBeUndefined();
    expect(wrapper.text()).not.toContain("上一章");
    expect(wrapper.text()).not.toContain("下一章");
    expect(wrapper.text()).not.toContain("⇇");
    expect(wrapper.text()).not.toContain("⇉");
  });

  it("renders ⇇ and ⇉ jump buttons with correct tooltips and aria-labels", () => {
    isFirstRef.value = false;
    isLastRef.value = false;
    const wrapper = mount(AppHeader);

    const firstBtn = wrapper.findAll("button").find((b) => b.text() === "⇇");
    const lastBtn = wrapper.findAll("button").find((b) => b.text() === "⇉");
    expect(firstBtn).toBeTruthy();
    expect(lastBtn).toBeTruthy();
    expect(firstBtn!.attributes("title")).toBe("第一章");
    expect(firstBtn!.attributes("aria-label")).toBe("第一章");
    expect(lastBtn!.attributes("title")).toBe("最後一章");
    expect(lastBtn!.attributes("aria-label")).toBe("最後一章");
  });

  it("invokes goToFirst when ⇇ is clicked and goToLast when ⇉ is clicked", async () => {
    isFirstRef.value = false;
    isLastRef.value = false;
    const wrapper = mount(AppHeader);

    await wrapper.findAll("button").find((b) => b.text() === "⇇")!.trigger("click");
    await wrapper.findAll("button").find((b) => b.text() === "⇉")!.trigger("click");

    expect(goToFirstMock).toHaveBeenCalledTimes(1);
    expect(goToLastMock).toHaveBeenCalledTimes(1);
  });

  it("disables ⇇ when isFirst is true and ⇉ when isLast is true", async () => {
    isFirstRef.value = true;
    isLastRef.value = false;
    let wrapper = mount(AppHeader);
    let firstBtn = wrapper.findAll("button").find((b) => b.text() === "⇇");
    expect(firstBtn!.attributes("disabled")).toBeDefined();
    await firstBtn!.trigger("click");
    expect(goToFirstMock).not.toHaveBeenCalled();

    isFirstRef.value = false;
    isLastRef.value = true;
    wrapper = mount(AppHeader);
    const lastBtn = wrapper.findAll("button").find((b) => b.text() === "⇉");
    expect(lastBtn!.attributes("disabled")).toBeDefined();
    await lastBtn!.trigger("click");
    expect(goToLastMock).not.toHaveBeenCalled();
  });

  it("renders both ⇇ and ⇉ disabled when story has exactly 1 chapter", () => {
    totalChaptersRef.value = 1;
    currentIndexRef.value = 0;
    isFirstRef.value = true;
    isLastRef.value = true;
    const wrapper = mount(AppHeader);
    const firstBtn = wrapper.findAll("button").find((b) => b.text() === "⇇");
    const lastBtn = wrapper.findAll("button").find((b) => b.text() === "⇉");
    expect(firstBtn).toBeTruthy();
    expect(lastBtn).toBeTruthy();
    expect(firstBtn!.attributes("disabled")).toBeDefined();
    expect(lastBtn!.attributes("disabled")).toBeDefined();
  });

  it("renders the navigation cluster in fixed left-to-right order", () => {
    isFirstRef.value = false;
    isLastRef.value = false;
    const wrapper = mount(AppHeader);
    const navTexts = wrapper
      .findAll("button")
      .map((b) => b.text())
      .filter((t) => ["⇇", "← 上一章", "下一章 →", "⇉"].includes(t));
    expect(navTexts).toEqual(["⇇", "← 上一章", "下一章 →", "⇉"]);
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
