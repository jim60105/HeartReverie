import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import StorySelector from "@/components/StorySelector.vue";

const seriesListRef = ref<string[]>(["alpha", "beta"]);
const storyListRef = ref<string[]>(["story-1", "story-2"]);
const selectedSeriesRef = ref("");
const selectedStoryRef = ref("");

const fetchSeriesMock = vi.fn().mockResolvedValue(undefined);
const createStoryMock = vi.fn().mockResolvedValue(undefined);
const navigateToStoryMock = vi.fn();
const exportStoryMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/composables/useStorySelector", () => ({
  useStorySelector: () => ({
    seriesList: seriesListRef,
    storyList: storyListRef,
    selectedSeries: selectedSeriesRef,
    selectedStory: selectedStoryRef,
    fetchSeries: fetchSeriesMock,
    createStory: createStoryMock,
    navigateToStory: navigateToStoryMock,
  }),
}));

vi.mock("@/composables/useStoryExport", () => ({
  useStoryExport: () => ({ exportStory: exportStoryMock }),
}));

describe("StorySelector", () => {
  beforeEach(() => {
    selectedSeriesRef.value = "";
    selectedStoryRef.value = "";
    fetchSeriesMock.mockClear();
    createStoryMock.mockClear();
    navigateToStoryMock.mockClear();
    exportStoryMock.mockClear();
    exportStoryMock.mockResolvedValue(undefined);
  });

  it("fetches series on mount and renders export buttons", async () => {
    const wrapper = mount(StorySelector);
    await flushPromises();
    expect(fetchSeriesMock).toHaveBeenCalledTimes(1);
    expect(wrapper.find("[data-testid=\"export-md\"]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=\"export-json\"]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=\"export-txt\"]").exists()).toBe(true);
  });

  it("creates a story using trimmed name then navigates", async () => {
    selectedSeriesRef.value = "alpha";
    const wrapper = mount(StorySelector);

    await wrapper.find(".selector-input").setValue("  new-story  ");
    await wrapper.findAll(".action-btn")[0]!.trigger("click");

    expect(createStoryMock).toHaveBeenCalledWith("alpha", "new-story");
    expect(selectedStoryRef.value).toBe("new-story");
    expect(navigateToStoryMock).toHaveBeenCalledWith("alpha", "new-story");
  });

  it("loads selected story and skips load when selection is incomplete", async () => {
    const wrapper = mount(StorySelector);
    await wrapper.findAll(".action-btn")[1]!.trigger("click");
    expect(navigateToStoryMock).not.toHaveBeenCalled();

    selectedSeriesRef.value = "alpha";
    selectedStoryRef.value = "story-1";
    await wrapper.findAll(".action-btn")[1]!.trigger("click");
    expect(navigateToStoryMock).toHaveBeenCalledWith("alpha", "story-1");
  });

  it("disables export buttons without selection and calls export with format", async () => {
    const wrapper = mount(StorySelector);
    expect(wrapper.find("[data-testid=\"export-md\"]").attributes("disabled")).toBeDefined();

    selectedSeriesRef.value = "alpha";
    selectedStoryRef.value = "story-1";
    await flushPromises();
    await wrapper.find("[data-testid=\"export-json\"]").trigger("click");

    expect(exportStoryMock).toHaveBeenCalledWith("alpha", "story-1", "json");
  });

  it("shows export fallback error and locks buttons while exporting", async () => {
    selectedSeriesRef.value = "alpha";
    selectedStoryRef.value = "story-1";
    let resolveExport: (() => void) | undefined;
    exportStoryMock.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolveExport = resolve;
    }));

    const wrapper = mount(StorySelector);
    await wrapper.find("[data-testid=\"export-md\"]").trigger("click");
    await flushPromises();
    expect(wrapper.find("[data-testid=\"export-json\"]").attributes("disabled")).toBeDefined();

    resolveExport?.();
    await flushPromises();

    exportStoryMock.mockRejectedValueOnce("x");
    await wrapper.find("[data-testid=\"export-txt\"]").trigger("click");
    await flushPromises();
    expect(wrapper.find(".export-error").text()).toContain("匯出失敗");
  });
});
