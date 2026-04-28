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
  booleanMap: Record<string, boolean>;
  reasoningEffortMuted: boolean;
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
    expect(wrapper.findAll(".field-row").length).toBe(11);
    expect(wrapper.text()).toContain("儲存");
  });

  it("renders dedicated checkbox + select for the two reasoning rows", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain("推理啟用 (reasoning_enabled)");
    expect(wrapper.text()).toContain("推理強度 (reasoning_effort)");
    // The reasoningEffort row should contain a <select> with all six options.
    const selects = wrapper.findAll("select");
    // selects: series, story, plus reasoningEffort
    const effortSelect = selects.find((s) =>
      s.findAll("option").some((o) => o.attributes("value") === "xhigh"),
    );
    expect(effortSelect).toBeDefined();
    const optionValues = effortSelect!.findAll("option").map((o) => o.attributes("value"));
    expect(optionValues).toEqual(["none", "minimal", "low", "medium", "high", "xhigh"]);
    // The reasoningEnabled row should contain a value-control checkbox in addition to the toggle.
    expect(wrapper.findAll(".field-checkbox").length).toBe(1);
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

  it("save payload includes reasoning fields with real boolean (not string)", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.reasoningEnabled = true;
    x.booleanMap.reasoningEnabled = false;
    x.enabledMap.reasoningEffort = true;
    x.valueMap.reasoningEffort = "low";
    await x.handleSave();
    await flushPromises();

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    const payload = saveConfigMock.mock.calls[0]![2] as StoryLlmConfig;
    expect(payload).toEqual({ reasoningEnabled: false, reasoningEffort: "low" });
    expect(typeof payload.reasoningEnabled).toBe("boolean");
    expect(payload.reasoningEnabled).not.toBe("false");
  });

  it("toggling 'use default' ON for both reasoning fields removes them from the payload", async () => {
    overrides.value = { reasoningEnabled: false, reasoningEffort: "low" };
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    expect(x.enabledMap.reasoningEnabled).toBe(true);
    expect(x.enabledMap.reasoningEffort).toBe(true);
    x.enabledMap.reasoningEnabled = false;
    x.enabledMap.reasoningEffort = false;
    await x.handleSave();
    await flushPromises();

    const payload = saveConfigMock.mock.calls[0]![2] as StoryLlmConfig;
    expect(payload).toEqual({});
  });

  it("reasoningEffort select gains the muted class when reasoning is explicitly off and remains interactive", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.reasoningEnabled = true;
    x.booleanMap.reasoningEnabled = false;
    await flushPromises();
    expect(x.reasoningEffortMuted).toBe(true);
    const effortSelect = wrapper
      .findAll("select")
      .find((s) => s.findAll("option").some((o) => o.attributes("value") === "xhigh"))!;
    expect(effortSelect.classes()).toContain("muted");
    // It must NOT carry the HTML disabled attribute as a result of the muted state alone:
    // its disabled attribute is bound to !enabledMap.reasoningEffort, which is `true` (still
    // disabled here). To verify the muted state isn't gated on disabled, flip the toggle on:
    x.enabledMap.reasoningEffort = true;
    await flushPromises();
    expect(effortSelect.attributes("disabled")).toBeUndefined();
    expect(effortSelect.classes()).toContain("muted");
  });

  it("reasoningEffort select is unmuted when reasoning use-default is ON", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.reasoningEnabled = false;
    x.booleanMap.reasoningEnabled = false;
    await flushPromises();
    expect(x.reasoningEffortMuted).toBe(false);
    const effortSelect = wrapper
      .findAll("select")
      .find((s) => s.findAll("option").some((o) => o.attributes("value") === "xhigh"))!;
    expect(effortSelect.classes()).not.toContain("muted");
  });

  it("reasoningEffort select is unmuted when checkbox is checked", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.reasoningEnabled = true;
    x.booleanMap.reasoningEnabled = true;
    await flushPromises();
    expect(x.reasoningEffortMuted).toBe(false);
    const effortSelect = wrapper
      .findAll("select")
      .find((s) => s.findAll("option").some((o) => o.attributes("value") === "xhigh"))!;
    expect(effortSelect.classes()).not.toContain("muted");
  });
});
