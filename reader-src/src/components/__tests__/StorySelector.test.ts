import { ref } from "vue";
import { mount } from "@vue/test-utils";
import StorySelector from "@/components/StorySelector.vue";

const seriesListRef = ref<string[]>(["alpha", "beta"]);
const storyListRef = ref<string[]>(["story-1", "story-2"]);
const selectedSeriesRef = ref("");
const selectedStoryRef = ref("");

vi.mock("@/composables/useStorySelector", () => ({
  useStorySelector: () => ({
    seriesList: seriesListRef,
    storyList: storyListRef,
    selectedSeries: selectedSeriesRef,
    selectedStory: selectedStoryRef,
    fetchSeries: vi.fn().mockResolvedValue(undefined),
    fetchStories: vi.fn().mockResolvedValue(undefined),
    createStory: vi.fn().mockResolvedValue(undefined),
    navigateToStory: vi.fn(),
  }),
}));

const exportStoryMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/composables/useStoryExport", () => ({
  useStoryExport: () => ({ exportStory: exportStoryMock }),
}));

describe("StorySelector — export section", () => {
  beforeEach(() => {
    selectedSeriesRef.value = "";
    selectedStoryRef.value = "";
    exportStoryMock.mockClear();
    exportStoryMock.mockResolvedValue(undefined);
  });

  it("renders the three export buttons", () => {
    const wrapper = mount(StorySelector);
    expect(wrapper.find("[data-testid=\"export-md\"]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=\"export-json\"]").exists()).toBe(true);
    expect(wrapper.find("[data-testid=\"export-txt\"]").exists()).toBe(true);
  });

  it("disables export buttons when no series/story selected", () => {
    const wrapper = mount(StorySelector);
    for (const id of ["export-md", "export-json", "export-txt"]) {
      const btn = wrapper.find(`[data-testid="${id}"]`);
      expect(btn.attributes("disabled")).toBeDefined();
    }
  });

  it("enables export buttons when both series and story selected", async () => {
    selectedSeriesRef.value = "alpha";
    selectedStoryRef.value = "story-1";
    const wrapper = mount(StorySelector);
    await wrapper.vm.$nextTick();
    for (const id of ["export-md", "export-json", "export-txt"]) {
      const btn = wrapper.find(`[data-testid="${id}"]`);
      expect(btn.attributes("disabled")).toBeUndefined();
    }
  });

  it("calls exportStory with the right format when clicking a button", async () => {
    selectedSeriesRef.value = "alpha";
    selectedStoryRef.value = "story-1";
    const wrapper = mount(StorySelector);
    await wrapper.vm.$nextTick();

    await wrapper.find("[data-testid=\"export-json\"]").trigger("click");
    await wrapper.vm.$nextTick();

    expect(exportStoryMock).toHaveBeenCalledWith("alpha", "story-1", "json");
  });

  it("shows a non-blocking error state when export fails", async () => {
    selectedSeriesRef.value = "alpha";
    selectedStoryRef.value = "story-1";
    exportStoryMock.mockRejectedValueOnce(new Error("Export failed with status 404"));

    const wrapper = mount(StorySelector);
    await wrapper.vm.$nextTick();

    await wrapper.find("[data-testid=\"export-md\"]").trigger("click");
    // Wait for microtasks after await in handler.
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();

    const err = wrapper.find(".export-error");
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain("404");
  });
});
