// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { ref } from "vue";
import LlmSettingsPage from "@/components/LlmSettingsPage.vue";
import type { LlmDefaultsResponse, StoryLlmConfig } from "@/types";

const saveConfigMock = vi.fn();
const loadConfigMock = vi.fn();
const loadLlmDefaultsMock = vi.fn();
const fetchSeriesMock = vi.fn();
const fetchStoriesMock = vi.fn();
const notifyMock = vi.fn();

const overrides = ref<StoryLlmConfig>({});
const defaultsRef = ref<LlmDefaultsResponse | null>({
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
const defaultsErrorRef = ref<string | null>(null);
const errorRef = ref<string | null>(null);
const selectedSeries = ref("s1");
const selectedStory = ref("n1");

vi.mock("@/composables/useStorySelector", () => ({
  useStorySelector: () => ({
    seriesList: ref(["s1", "s2"]),
    storyList: ref(["n1", "n2"]),
    selectedSeries,
    selectedStory,
    fetchSeries: fetchSeriesMock,
    fetchStories: fetchStoriesMock,
    createStory: vi.fn(),
    navigateToStory: vi.fn(),
  }),
}));

vi.mock("@/composables/useStoryLlmConfig", () => ({
  useStoryLlmConfig: () => ({
    overrides,
    loading: ref(false),
    saving: ref(false),
    error: errorRef,
    defaults: defaultsRef,
    defaultsLoading: ref(false),
    defaultsError: defaultsErrorRef,
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
  handleReset: () => Promise<void>;
  enabledMap: Record<keyof StoryLlmConfig, boolean>;
  valueMap: Record<keyof StoryLlmConfig, string>;
  booleanMap: Record<string, boolean>;
  reasoningEffortMuted: boolean;
  defaults: { value: LlmDefaultsResponse | null };
  displayValueMap: Record<string, string>;
  FIELDS: ReadonlyArray<{ key: keyof StoryLlmConfig; type: string }>;
}

function exposed(wrapper: ReturnType<typeof mount>): ExposedInternals {
  return wrapper.vm as unknown as ExposedInternals;
}

function resetMocks() {
  saveConfigMock.mockReset();
  loadConfigMock.mockReset();
  loadLlmDefaultsMock.mockReset();
  fetchSeriesMock.mockReset();
  fetchStoriesMock.mockReset();
  notifyMock.mockReset();
  saveConfigMock.mockImplementation((_s, _n, payload) =>
    Promise.resolve(payload)
  );
  loadConfigMock.mockResolvedValue(undefined);
  loadLlmDefaultsMock.mockResolvedValue(undefined);
  fetchSeriesMock.mockResolvedValue(undefined);
  fetchStoriesMock.mockResolvedValue(undefined);
  overrides.value = {};
  defaultsErrorRef.value = null;
  errorRef.value = null;
  selectedSeries.value = "s1";
  selectedStory.value = "n1";
  defaultsRef.value = {
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
  };
}

describe("LlmSettingsPage — extra coverage", () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    resetMocks();
  });

  it("toggling override ON seeds string field from server defaults", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    expect(x.enabledMap.model).toBe(false);
    const checkbox = wrapper
      .findAll("input[type=checkbox]")
      .find((el) => {
        const sib = el.element.parentElement?.textContent ?? "";
        return sib.includes("model");
      });
    expect(checkbox).toBeDefined();
    await checkbox!.setValue(true);
    expect(x.enabledMap.model).toBe(true);
    expect(x.valueMap.model).toBe("default-model");
  });

  it("toggling override ON seeds number field from server defaults", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    const cbs = wrapper.findAll("input[type=checkbox]");
    // Find temperature row toggle — the toggle is the first checkbox in its row
    const tempToggle = cbs.find((el) => {
      const txt = el.element.parentElement?.textContent ?? "";
      return txt.includes("temperature");
    })!;
    await tempToggle.setValue(true);
    expect(x.enabledMap.temperature).toBe(true);
    expect(x.valueMap.temperature).toBe("0.1");
  });

  it("toggling override ON seeds boolean reasoningEnabled from defaults", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    const cbs = wrapper.findAll("input[type=checkbox]");
    const toggle = cbs.find((el) => {
      const txt = el.element.parentElement?.textContent ?? "";
      return txt.includes("reasoning_enabled");
    })!;
    await toggle.setValue(true);
    expect(x.enabledMap.reasoningEnabled).toBe(true);
    expect(x.booleanMap.reasoningEnabled).toBe(true);
  });

  it("toggling override ON seeds enum reasoningEffort from defaults", async () => {
    defaultsRef.value!.reasoningEffort = "medium";
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    const cbs = wrapper.findAll("input[type=checkbox]");
    const toggle = cbs.find((el) => {
      const txt = el.element.parentElement?.textContent ?? "";
      return txt.includes("reasoning_effort");
    })!;
    await toggle.setValue(true);
    expect(x.enabledMap.reasoningEffort).toBe(true);
    expect(x.valueMap.reasoningEffort).toBe("medium");
  });

  it("toggling override ON does NOT overwrite a value already loaded from overrides", async () => {
    overrides.value = { temperature: 0.7 };
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    // Disable then re-enable — must not be re-seeded from defaults because the
    // key was loaded.
    x.enabledMap.temperature = false;
    await flushPromises();
    const cbs = wrapper.findAll("input[type=checkbox]");
    const toggle = cbs.find((el) => {
      const txt = el.element.parentElement?.textContent ?? "";
      return txt.includes("temperature");
    })!;
    await toggle.setValue(true);
    // The post-toggle value should remain "0.7" (was loaded), not "0.1".
    expect(x.valueMap.temperature).toBe("0.7");
  });

  it("does not seed when defaults are null", async () => {
    defaultsRef.value = null;
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    const cbs = wrapper.findAll("input[type=checkbox]");
    const toggle = cbs.find((el) => {
      const txt = el.element.parentElement?.textContent ?? "";
      return txt.includes("temperature");
    })!;
    await toggle.setValue(true);
    expect(x.enabledMap.temperature).toBe(true);
    expect(x.valueMap.temperature).toBe("");
  });

  it("displayValueMap shows server defaults for disabled fields and 'true'/'false' for booleans", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    expect(x.displayValueMap.model).toBe("default-model");
    expect(x.displayValueMap.temperature).toBe("0.1");
    expect(x.displayValueMap.reasoningEnabled).toBe("true");
    defaultsRef.value!.reasoningEnabled = false;
    await flushPromises();
    expect(x.displayValueMap.reasoningEnabled).toBe("false");
  });

  it("displayValueMap is empty for fields missing from defaults / when defaults is null", async () => {
    defaultsRef.value = null;
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    expect(x.displayValueMap.model).toBe("");
    expect(x.displayValueMap.temperature).toBe("");
    // The default-display input should fall back to the placeholder for null defaults.
    const inputs = wrapper.findAll("input.default-display.field-input");
    const placeholders = inputs.map((i) => i.attributes("placeholder"));
    expect(placeholders.some((p) => p === "預設值載入失敗")).toBe(true);
  });

  it("renders the placeholder '使用預設值' when defaults are present but field missing", async () => {
    // Strip a single key from defaults to exercise the formatDefault undefined path.
    const trimmed = { ...defaultsRef.value! } as Record<string, unknown>;
    delete trimmed.model;
    defaultsRef.value = trimmed as unknown as LlmDefaultsResponse;
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    // The model row's read-only input should show empty value + placeholder.
    const modelRow = wrapper.findAll(".field-row").find((r) =>
      r.text().includes("model")
    )!;
    const input = modelRow.find("input.default-display.field-input");
    expect(input.attributes("placeholder")).toBe("使用預設值");
    expect((input.element as HTMLInputElement).value).toBe("");
  });

  it("save error path notifies with the error message", async () => {
    saveConfigMock.mockRejectedValueOnce(new Error("HTTP 404 — story missing"));
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.temperature = true;
    x.valueMap.temperature = "0.5";
    await x.handleSave();
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "儲存失敗",
        body: "HTTP 404 — story missing",
        level: "error",
      }),
    );
  });

  it("save error path with non-Error rejection falls back to '未知錯誤'", async () => {
    saveConfigMock.mockRejectedValueOnce("opaque-string");
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.temperature = true;
    x.valueMap.temperature = "0.5";
    await x.handleSave();
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "儲存失敗",
        body: "未知錯誤",
        level: "error",
      }),
    );
  });

  it("handleReset re-fetches config + defaults when story is selected", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    loadConfigMock.mockClear();
    loadLlmDefaultsMock.mockClear();
    const x = exposed(wrapper);
    await x.handleReset();
    await flushPromises();
    expect(loadConfigMock).toHaveBeenCalledWith("s1", "n1");
    expect(loadLlmDefaultsMock).toHaveBeenCalled();
  });

  it("handleReset without selected story just snaps to cached overrides", async () => {
    selectedStory.value = "";
    overrides.value = {};
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    loadConfigMock.mockClear();
    loadLlmDefaultsMock.mockClear();
    const x = exposed(wrapper);
    await x.handleReset();
    await flushPromises();
    expect(loadConfigMock).not.toHaveBeenCalled();
    expect(loadLlmDefaultsMock).not.toHaveBeenCalled();
  });

  it("handleReset surfaces a warning when the defaults fetch rejects", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    notifyMock.mockClear();
    loadLlmDefaultsMock.mockRejectedValueOnce(new Error("net down"));
    const x = exposed(wrapper);
    await x.handleReset();
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "預設值載入失敗", level: "warning" }),
    );
  });

  it("handleReset surfaces a warning when defaults resolve but defaults remain null + defaultsError set", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    notifyMock.mockClear();
    loadLlmDefaultsMock.mockImplementationOnce(async () => {
      defaultsRef.value = null;
      defaultsErrorRef.value = "schema mismatch";
    });
    const x = exposed(wrapper);
    await x.handleReset();
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "預設值載入失敗",
        body: "schema mismatch",
        level: "warning",
      }),
    );
  });

  it("onMounted surfaces a warning when initial defaults fetch rejects", async () => {
    loadLlmDefaultsMock.mockReset();
    loadLlmDefaultsMock.mockRejectedValueOnce(new Error("boom"));
    notifyMock.mockClear();
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "預設值載入失敗",
        level: "warning",
      }),
    );
    wrapper.unmount();
  });

  it("onMounted surfaces a warning when defaults resolve to null with defaultsError", async () => {
    loadLlmDefaultsMock.mockReset();
    loadLlmDefaultsMock.mockImplementationOnce(async () => {
      defaultsRef.value = null;
      defaultsErrorRef.value = "validation failure";
    });
    notifyMock.mockClear();
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    await flushPromises();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "預設值載入失敗",
        body: "validation failure",
      }),
    );
    wrapper.unmount();
  });

  it("renders the read-only checkbox reflecting defaults.reasoningEnabled when override is off", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    // Find the disabled default-display checkbox in the reasoning_enabled row
    const row = wrapper
      .findAll(".field-row")
      .find((r) => r.text().includes("reasoning_enabled"))!;
    const cb = row.find("input.default-display");
    expect(cb.attributes("disabled")).toBeDefined();
    expect((cb.element as HTMLInputElement).checked).toBe(true);
    defaultsRef.value!.reasoningEnabled = false;
    await flushPromises();
    expect((cb.element as HTMLInputElement).checked).toBe(false);
  });

  it("error banner renders when error ref is non-null", async () => {
    errorRef.value = "load failed";
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain("讀取失敗：load failed");
    errorRef.value = null;
  });

  it("defaults-error banner renders when defaultsError is non-null", async () => {
    defaultsErrorRef.value = "schema X";
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain("預設值無法取得：schema X");
    defaultsErrorRef.value = null;
  });

  it("changing the story-picker triggers a fresh handleLoad via the watch", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    loadConfigMock.mockClear();
    fetchStoriesMock.mockClear();
    selectedSeries.value = "s2";
    selectedStory.value = "n2";
    await flushPromises();
    await flushPromises();
    expect(fetchStoriesMock).toHaveBeenCalledWith("s2");
    expect(loadConfigMock).toHaveBeenCalledWith("s2", "n2");
    wrapper.unmount();
  });

  it("renders the empty-state hint when no story is selected", async () => {
    selectedStory.value = "";
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    expect(wrapper.text()).toContain("請先選擇系列與故事");
    expect(wrapper.findAll(".field-row").length).toBe(0);
  });

  it("typing into the model text input updates valueMap and saves the trimmed value", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.model = true;
    await flushPromises();
    // Find the editable model row's text input (v-model'd against valueMap.model).
    const modelRow = wrapper.findAll(".field-row").find((r) =>
      r.text().includes("model")
    )!;
    const inputs = modelRow.findAll("input.field-input");
    const editable = inputs.find((i) => !i.attributes("disabled"))!;
    await editable.setValue("custom-model-x");
    expect(x.valueMap.model).toBe("custom-model-x");
    await x.handleSave();
    await flushPromises();
    expect(saveConfigMock).toHaveBeenCalledTimes(1);
    expect(saveConfigMock.mock.calls[0]![2]).toEqual({
      model: "custom-model-x",
    });
  });

  it("typing into a number input fires @input handler and updates valueMap", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.temperature = true;
    await flushPromises();
    const tempRow = wrapper
      .findAll(".field-row")
      .find((r) => r.text().includes("temperature"))!;
    const editable = tempRow
      .findAll("input.field-input")
      .find((i) => !i.attributes("disabled"))!;
    await editable.setValue("0.42");
    expect(x.valueMap.temperature).toBe("0.42");
  });

  it("toggling the inner reasoningEnabled checkbox flips booleanMap", async () => {
    overrides.value = { reasoningEnabled: true };
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    expect(x.booleanMap.reasoningEnabled).toBe(true);
    const innerCb = wrapper.find("input.field-checkbox");
    expect(innerCb.exists()).toBe(true);
    await innerCb.setValue(false);
    expect(x.booleanMap.reasoningEnabled).toBe(false);
  });

  it("changing the reasoningEffort select via UI fires @change and updates valueMap", async () => {
    overrides.value = { reasoningEffort: "high" };
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    const effortSelect = wrapper
      .findAll("select")
      .find((s) =>
        s.findAll("option").some((o) => o.attributes("value") === "xhigh")
      )!;
    await effortSelect.setValue("medium");
    expect(x.valueMap.reasoningEffort).toBe("medium");
  });

  it("changing the series picker via UI triggers fetchStories", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    fetchStoriesMock.mockClear();
    const seriesSelect = wrapper.findAll("select")[0]!;
    await seriesSelect.setValue("s2");
    await flushPromises();
    expect(fetchStoriesMock).toHaveBeenCalledWith("s2");
    wrapper.unmount();
  });

  it("changing the story picker via UI triggers handleLoad", async () => {
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    loadConfigMock.mockClear();
    const storySelect = wrapper.findAll("select")[1]!;
    await storySelect.setValue("n2");
    await flushPromises();
    expect(loadConfigMock).toHaveBeenCalledWith("s1", "n2");
    wrapper.unmount();
  });

  it("rejects an enum value not in REASONING_EFFORTS via direct manipulation", async () => {
    // A defensive guard exercised when collectPayload sees an out-of-enum
    // valueMap entry (would normally be impossible via the <select>, but the
    // template binding could be bypassed by tooling).
    const wrapper = mount(LlmSettingsPage);
    await flushPromises();
    const x = exposed(wrapper);
    x.enabledMap.reasoningEffort = true;
    (x.valueMap as Record<string, string>).reasoningEffort = "ultra";
    await x.handleSave();
    await flushPromises();
    expect(saveConfigMock).not.toHaveBeenCalled();
    expect(notifyMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: "欄位錯誤", level: "error" }),
    );
  });
});
