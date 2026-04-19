import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import LlmSettingsPage from "@/components/LlmSettingsPage.vue";
import type { StoryLlmConfig } from "@/types";

const saveConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const notifyMock = vi.fn();
const overrides = ref<StoryLlmConfig>({});

vi.mock("@/composables/useStorySelector", () => ({
  useStorySelector: () => ({
    seriesList: ref(["s1"]),
    storyList: ref(["n1"]),
    selectedSeries: ref("s1"),
    selectedStory: ref("n1"),
    fetchSeries: vi.fn(() => Promise.resolve()),
    fetchStories: vi.fn(() => Promise.resolve()),
    createStory: vi.fn(),
    navigateToStory: vi.fn(),
  }),
}));

vi.mock("@/composables/useStoryLlmConfig", () => ({
  useStoryLlmConfig: () => ({
    overrides,
    loading: ref(false),
    saving: ref(false),
    error: ref(null),
    loadConfig: loadConfigMock,
    saveConfig: saveConfigMock,
    reset: vi.fn(),
  }),
}));

vi.mock("@/composables/useNotification", () => ({
  useNotification: () => ({
    notify: notifyMock,
    toasts: ref([]),
    dismiss: vi.fn(),
    requestPermission: vi.fn(),
    permissionState: ref("granted"),
  }),
}));

interface ExposedInternals {
  handleSave: () => Promise<void>;
  handleReset: () => void;
  enabledMap: Record<keyof StoryLlmConfig, boolean>;
  valueMap: Record<keyof StoryLlmConfig, string>;
}

function exposed(wrapper: ReturnType<typeof mount>): ExposedInternals {
  return wrapper.vm as unknown as ExposedInternals;
}

describe("LlmSettingsPage", () => {
  beforeEach(() => {
    saveConfigMock.mockReset();
    loadConfigMock.mockReset();
    notifyMock.mockReset();
    overrides.value = {};
    saveConfigMock.mockImplementation((_s, _n, payload) => Promise.resolve(payload));
    loadConfigMock.mockResolvedValue(undefined);
  });

  it("renders field rows and action buttons", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain("LLM 設定");
    expect(wrapper.findAll(".field-row").length).toBe(9);
    expect(wrapper.text()).toContain("儲存");
  });

  it("seeds toggles from existing overrides", async () => {
    overrides.value = { temperature: 0.7 };
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    expect(x.enabledMap.temperature).toBe(true);
    expect(x.valueMap.temperature).toBe("0.7");
    expect(x.enabledMap.topK).toBe(false);
  });

  it("save payload only contains fields whose override toggle is enabled", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.temperature = true;
    x.valueMap.temperature = "0.9";
    // topK stays disabled → must NOT appear
    await x.handleSave();
    await flushPromises();

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    const payload = saveConfigMock.mock.calls[0]![2] as StoryLlmConfig;
    expect(payload).toEqual({ temperature: 0.9 });
    expect(payload.topK).toBeUndefined();
    expect(payload.model).toBeUndefined();
  });

  it("notifies validation error when a number field is empty while enabled", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.temperature = true;
    x.valueMap.temperature = "";
    await x.handleSave();
    await flushPromises();

    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error" }),
    );
  });

  it("notifies validation error when string model field is empty while enabled", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.model = true;
    x.valueMap.model = "   ";
    await x.handleSave();
    await flushPromises();

    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error" }),
    );
  });

  it("empty object is saved when no fields are enabled (clears overrides)", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    await x.handleSave();
    await flushPromises();

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    expect(saveConfigMock.mock.calls[0]![2]).toEqual({});
  });

  it("shows a success toast after save", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    await x.handleSave();
    await flushPromises();

    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: "success" }),
    );
  });
});
