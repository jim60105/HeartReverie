import { mount, flushPromises } from "@vue/test-utils";
import { ref } from "vue";
import LlmSettingsPage from "@/components/LlmSettingsPage.vue";
import type { StoryLlmConfig } from "@/types";

const saveConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadLlmDefaultsMock = vi.fn();
const notifyMock = vi.fn();
const overrides = ref<StoryLlmConfig>({});
const defaultsRef = ref<{
  model: string;
  temperature: number;
  frequencyPenalty: number;
  presencePenalty: number;
  topK: number;
  topP: number;
  repetitionPenalty: number;
  minP: number;
  topA: number;
  reasoningEnabled: boolean;
  reasoningEffort: string;
  maxCompletionTokens: number;
} | null>({
  model: "default-model",
  temperature: 0.1,
  frequencyPenalty: 0.13,
  presencePenalty: 0.52,
  topK: 10,
  topP: 0,
  repetitionPenalty: 1.2,
  minP: 0,
  topA: 1,
  reasoningEnabled: true,
  reasoningEffort: "high",
  maxCompletionTokens: 4096,
});

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
    defaults: defaultsRef,
    defaultsLoading: ref(false),
    defaultsError: ref(null),
    loadConfig: loadConfigMock,
    loadLlmDefaults: loadLlmDefaultsMock,
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
  FIELDS: ReadonlyArray<{ key: keyof StoryLlmConfig }>;
}

function exposed(wrapper: ReturnType<typeof mount>): ExposedInternals {
  return wrapper.vm as unknown as ExposedInternals;
}

describe("LlmSettingsPage", () => {
  beforeEach(() => {
    saveConfigMock.mockReset();
    loadConfigMock.mockReset();
    loadLlmDefaultsMock.mockReset();
    notifyMock.mockReset();
    overrides.value = {};
    saveConfigMock.mockImplementation((_s, _n, payload) => Promise.resolve(payload));
    loadConfigMock.mockResolvedValue(undefined);
    loadLlmDefaultsMock.mockResolvedValue(undefined);
  });

  it("renders field rows and action buttons", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain("LLM 設定");
    expect(wrapper.findAll(".field-row").length).toBe(12);
    expect(wrapper.text()).toContain("儲存");
  });

  // Lock-step guard: the frontend FIELDS list must stay aligned with
  // STORY_LLM_CONFIG_KEYS in writer/lib/story-config.ts. That backend tuple
  // drives both the validator AND the /api/llm-defaults route shape, and the
  // backend lock-step test (tests/writer/lib/story-config_test.ts) freezes
  // its contents. If a key is added or removed there, this mirror must be
  // updated and this test will fail until both sides agree.
  const EXPECTED_BACKEND_KEYS = [
    "model",
    "temperature",
    "frequencyPenalty",
    "presencePenalty",
    "topK",
    "topP",
    "repetitionPenalty",
    "minP",
    "topA",
    "reasoningEnabled",
    "reasoningEffort",
    "maxCompletionTokens",
  ] as const;

  it("FIELDS list mirrors STORY_LLM_CONFIG_KEYS exactly (lock-step)", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    const frontendKeys = x.FIELDS.map((f) => f.key);
    expect(frontendKeys).toEqual([...EXPECTED_BACKEND_KEYS]);
  });

  it("renders dedicated checkbox + select for the two reasoning rows", async () => {
    // Enable both reasoning overrides so the editable controls render
    overrides.value = { reasoningEnabled: true, reasoningEffort: "high" };
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain("推理啟用 (reasoning_enabled)");
    expect(wrapper.text()).toContain("推理強度 (reasoning_effort)");
    // The reasoningEffort row should contain a <select> with all six options.
    const selects = wrapper.findAll("select");
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

  it("save handles number-coerced valueMap entries (Vue v-model on type=number)", async () => {
    // Regression: Vue's v-model on <input type="number"> stores the parsed
    // number — not a string — when the input is parseable. collectPayload
    // must defensively stringify before .trim() to avoid a runtime crash.
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.maxCompletionTokens = true;
    // Simulate the post-v-model state: a number, not a string.
    (x.valueMap as Record<string, unknown>).maxCompletionTokens = 8192;
    await x.handleSave();
    await flushPromises();

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    const payload = saveConfigMock.mock.calls[0]![2] as StoryLlmConfig;
    expect(payload).toEqual({ maxCompletionTokens: 8192 });
  });

  it.each([
    ["1e3", "exponent notation"],
    ["01024", "leading zero"],
    ["1024.5", "decimal"],
    ["0", "zero"],
    ["-5", "negative"],
    ["abc", "non-numeric"],
    [" ", "whitespace"],
  ])("rejects invalid maxCompletionTokens input %j (%s)", async (input) => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.maxCompletionTokens = true;
    x.valueMap.maxCompletionTokens = input;
    await x.handleSave();
    await flushPromises();

    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ level: "error" }),
    );
  });

  it("accepts a valid positive-integer maxCompletionTokens string", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.maxCompletionTokens = true;
    x.valueMap.maxCompletionTokens = "8192";
    await x.handleSave();
    await flushPromises();

    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    const payload = saveConfigMock.mock.calls[0]![2] as StoryLlmConfig;
    expect(payload).toEqual({ maxCompletionTokens: 8192 });
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
    overrides.value = { reasoningEffort: "high" };
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
    // its disabled attribute is bound to !enabledMap.reasoningEffort, which is `true` here.
    expect(effortSelect.attributes("disabled")).toBeUndefined();
    expect(effortSelect.classes()).toContain("muted");
  });

  it("reasoningEffort select is unmuted when reasoning use-default is ON", async () => {
    overrides.value = { reasoningEffort: "high" };
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
    overrides.value = { reasoningEffort: "high" };
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
