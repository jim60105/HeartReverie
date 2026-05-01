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

  it("shows full label and no aria-label when no story is selected", () => {
    selectedStoryRef.value = "";
    const wrapper = mount(StorySelector);
    const summary = wrapper.find("summary");
    expect(summary.text()).toContain("📖");
    expect(summary.text()).toContain("故事選擇");
    expect(summary.attributes("aria-label")).toBeUndefined();
  });

  it("collapses to glyph-only with aria-label on summary when a story is selected", async () => {
    selectedStoryRef.value = "my-story";
    const wrapper = mount(StorySelector);
    const summary = wrapper.find("summary");
    expect(summary.text().trim()).toBe("📖");
    expect(summary.attributes("aria-label")).toBe("故事選擇");
  });

  it("restores full label when selectedStory is cleared", async () => {
    selectedStoryRef.value = "my-story";
    const wrapper = mount(StorySelector);
    expect(wrapper.find("summary").attributes("aria-label")).toBe("故事選擇");

    selectedStoryRef.value = "";
    await flushPromises();
    const summary = wrapper.find("summary");
    expect(summary.text()).toContain("故事選擇");
    expect(summary.attributes("aria-label")).toBeUndefined();
  });
});
