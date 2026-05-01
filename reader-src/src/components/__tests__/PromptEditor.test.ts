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

import { computed, ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import PromptEditor from "@/components/PromptEditor.vue";
import type { MessageCard } from "@/types";

const cards = ref<MessageCard[]>([]);
const rawSource = ref("");
const useRawFallback = ref(false);
const parameters = ref<Array<{ name: string; source: string; type: string }>>([]);
const isDirty = ref(false);
const isCustom = ref(false);
const isSaving = ref(false);
const parseError = ref<string | null>(null);
const topLevelContentDropped = ref(false);
const saveDisabledReasonRef = ref<string | null>(null);

const saveMock = vi.fn().mockResolvedValue(undefined);
const loadTemplateMock = vi.fn().mockResolvedValue(undefined);
const resetTemplateMock = vi.fn().mockResolvedValue(undefined);
const toggleRawFallbackMock = vi.fn(() => {
  useRawFallback.value = !useRawFallback.value;
});
const addCardMock = vi.fn(() => {
  cards.value.push({
    id: `new-${cards.value.length}`,
    role: "system",
    body: "",
  });
});
const deleteCardMock = vi.fn((id: string) => {
  cards.value = cards.value.filter((c) => c.id !== id);
});
const moveCardUpMock = vi.fn();
const moveCardDownMock = vi.fn();
const dismissParseErrorMock = vi.fn(() => {
  parseError.value = null;
});

vi.mock("@/composables/usePromptEditor", () => ({
  usePromptEditor: () => ({
    cards,
    rawSource,
    originalRawSource: ref(""),
    useRawFallback,
    mode: computed(() => (useRawFallback.value ? "raw" : "cards")),
    parameters,
    isDirty,
    isCustom,
    isSaving,
    parseError,
    topLevelContentDropped,
    saveDisabledReason: saveDisabledReasonRef,
    save: saveMock,
    loadTemplate: loadTemplateMock,
    resetTemplate: resetTemplateMock,
    toggleRawFallback: toggleRawFallbackMock,
    addCard: addCardMock,
    deleteCard: deleteCardMock,
    moveCardUp: moveCardUpMock,
    moveCardDown: moveCardDownMock,
    serializeCurrent: () => "",
    dismissParseError: dismissParseErrorMock,
    previewTemplate: vi.fn(),
  }),
}));

beforeEach(() => {
  cards.value = [];
  rawSource.value = "";
  useRawFallback.value = false;
  parameters.value = [];
  isDirty.value = false;
  isCustom.value = false;
  isSaving.value = false;
  parseError.value = null;
  topLevelContentDropped.value = false;
  saveDisabledReasonRef.value = null;
  saveMock.mockClear();
  loadTemplateMock.mockClear();
  resetTemplateMock.mockClear();
  toggleRawFallbackMock.mockClear();
  addCardMock.mockClear();
  deleteCardMock.mockClear();
  moveCardUpMock.mockClear();
  moveCardDownMock.mockClear();
  dismissParseErrorMock.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PromptEditor — lifecycle & basic toolbar", () => {
  it("loads template on mount", async () => {
    mount(PromptEditor);
    await flushPromises();
    expect(loadTemplateMock).toHaveBeenCalledTimes(1);
  });

  it("renders cards mode by default with a 新增訊息 button", () => {
    const w = mount(PromptEditor);
    expect(w.find(".editor-cards-list").exists()).toBe(true);
    expect(w.find(".editor-textarea").exists()).toBe(false);
    expect(w.text()).toContain("新增訊息");
  });

  it("clicking 新增訊息 invokes addCard", async () => {
    const w = mount(PromptEditor);
    const btn = w.findAll("button").find((b) => b.text().includes("新增訊息"));
    await btn!.trigger("click");
    expect(addCardMock).toHaveBeenCalledTimes(1);
  });

  it("emits preview when 預覽 Prompt clicked", async () => {
    const w = mount(PromptEditor);
    const btn = w.findAll("button").find((b) => b.text().includes("預覽"));
    await btn!.trigger("click");
    expect(w.emitted("preview")).toHaveLength(1);
  });

  it("renders empty-state hint when cards mode has no cards", () => {
    const w = mount(PromptEditor);
    expect(w.find(".editor-empty-hint").exists()).toBe(true);
  });
});

describe("PromptEditor — mode toggle", () => {
  it("toggling switches to raw mode and renders .editor-textarea", async () => {
    const w = mount(PromptEditor);
    expect(w.find(".editor-textarea").exists()).toBe(false);
    const checkbox = w.find('input[type="checkbox"]');
    await checkbox.setValue(true);
    expect(toggleRawFallbackMock).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(w.find(".editor-textarea").exists()).toBe(true);
    expect(w.find(".editor-cards-list").exists()).toBe(false);
    // 新增訊息 button hidden in raw mode
    expect(w.text()).not.toContain("新增訊息");
  });

  it("raw-mode textarea is bound to rawSource via v-model", async () => {
    useRawFallback.value = true;
    rawSource.value = "raw-body";
    const w = mount(PromptEditor);
    const ta = w.find("textarea.editor-textarea");
    expect((ta.element as HTMLTextAreaElement).value).toBe("raw-body");
    await ta.setValue("changed");
    expect(rawSource.value).toBe("changed");
  });

  it("raw mode renders a variable pill row when parameters are non-empty", async () => {
    useRawFallback.value = true;
    parameters.value = [
      { name: "user_input", source: "core", type: "string" },
      { name: "story_name", source: "core", type: "string" },
    ];
    const w = mount(PromptEditor);
    const pills = w.findAll(".editor-raw-pill");
    expect(pills.length).toBe(2);
    expect(pills[0]!.text()).toBe("user_input");
  });

  it("clicking a raw-mode pill inserts {{ varName }} at cursor and updates rawSource via v-model", async () => {
    useRawFallback.value = true;
    rawSource.value = "abcXYZ";
    parameters.value = [
      { name: "user_input", source: "core", type: "string" },
    ];
    const w = mount(PromptEditor);
    const ta = w.find("textarea.editor-textarea")
      .element as HTMLTextAreaElement;
    // Place cursor between "abc" and "XYZ".
    ta.focus();
    ta.selectionStart = 3;
    ta.selectionEnd = 3;
    await w.find(".editor-raw-pill").trigger("click");
    await flushPromises();
    expect(rawSource.value).toBe("abc{{ user_input }}XYZ");
  });

  it("cards mode does NOT render the global raw pill row (per-card insertion stays)", async () => {
    parameters.value = [{ name: "user_input", source: "core", type: "string" }];
    const w = mount(PromptEditor);
    expect(w.find(".editor-raw-pill").exists()).toBe(false);
  });
});

describe("PromptEditor — save & reset", () => {
  it("save button is disabled when not dirty", () => {
    const w = mount(PromptEditor);
    expect(w.find(".toolbar-btn--save").attributes("disabled")).toBeDefined();
  });

  it("save button is disabled with tooltip in cards mode when guard reason is set", () => {
    isDirty.value = true;
    saveDisabledReasonRef.value = "請至少包含一則使用者訊息（傳送者：使用者）";
    const w = mount(PromptEditor);
    const btn = w.find(".toolbar-btn--save");
    expect(btn.attributes("disabled")).toBeDefined();
    expect(btn.attributes("title")).toBe(
      "請至少包含一則使用者訊息（傳送者：使用者）",
    );
  });

  it("save button is ENABLED in raw mode even if saveDisabledReason is set (guard exempt)", () => {
    isDirty.value = true;
    useRawFallback.value = true;
    saveDisabledReasonRef.value = "請至少新增一則訊息";
    const w = mount(PromptEditor);
    expect(w.find(".toolbar-btn--save").attributes("disabled")).toBeUndefined();
  });

  it("saves and emits saved event in cards mode (regression guard)", async () => {
    isDirty.value = true;
    cards.value = [{ id: "c1", role: "user", body: "hi" }];
    const w = mount(PromptEditor);
    await w.find(".toolbar-btn--save").trigger("click");
    await flushPromises();
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(w.emitted("saved")).toHaveLength(1);
  });

  it("saves and emits saved event in raw mode (regression guard)", async () => {
    isDirty.value = true;
    useRawFallback.value = true;
    rawSource.value = "x";
    const w = mount(PromptEditor);
    await w.find(".toolbar-btn--save").trigger("click");
    await flushPromises();
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(w.emitted("saved")).toHaveLength(1);
  });

  it("does not emit saved when save() rejects", async () => {
    isDirty.value = true;
    saveMock.mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = mount(PromptEditor);
    await w.find(".toolbar-btn--save").trigger("click");
    await flushPromises();
    expect(w.emitted("saved")).toBeUndefined();
    errSpy.mockRestore();
  });

  it("reset button is enabled when isCustom; clicking calls resetTemplate", async () => {
    isCustom.value = true;
    const w = mount(PromptEditor);
    const reset = w.findAll("button").find((b) => b.text().includes("回復預設"));
    expect(reset!.attributes("disabled")).toBeUndefined();
    await reset!.trigger("click");
    expect(resetTemplateMock).toHaveBeenCalledTimes(1);
  });

  it("shows saving spinner while isSaving", () => {
    isSaving.value = true;
    isDirty.value = true;
    const w = mount(PromptEditor);
    expect(w.text()).toContain("儲存中…");
    expect(w.find(".toolbar-btn--save").attributes("disabled")).toBeDefined();
  });
});

describe("PromptEditor — banners", () => {
  it("dismissible parse-error banner with zh-TW prefix", async () => {
    parseError.value = "missing closer";
    const w = mount(PromptEditor);
    expect(w.find(".editor-banner--error").exists()).toBe(true);
    expect(w.text()).toContain("範本解析失敗，已切換為純文字模式：missing closer");
    await w.find(".banner-dismiss").trigger("click");
    expect(dismissParseErrorMock).toHaveBeenCalledTimes(1);
    await flushPromises();
    expect(w.find(".editor-banner--error").exists()).toBe(false);
  });

  it("persistent strip warning shows in cards mode and exact zh-TW text", () => {
    topLevelContentDropped.value = true;
    const w = mount(PromptEditor);
    const banner = w.find(".editor-banner--warning");
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain(
      "範本中有部分內容（訊息區塊之外的文字）將在儲存時被捨棄",
    );
    expect(banner.text()).toContain("進階：純文字模式");
    expect(banner.find(".banner-dismiss").exists()).toBe(false);
  });

  it("strip warning is hidden in raw mode", () => {
    topLevelContentDropped.value = true;
    useRawFallback.value = true;
    const w = mount(PromptEditor);
    expect(w.find(".editor-banner--warning").exists()).toBe(false);
  });
});

describe("PromptEditor — cards list wiring", () => {
  it("renders one PromptEditorMessageCard per card with correct first/last flags", () => {
    cards.value = [
      { id: "a", role: "system", body: "S" },
      { id: "b", role: "user", body: "U" },
    ];
    const w = mount(PromptEditor);
    const messageCards = w.findAllComponents({ name: "PromptEditorMessageCard" });
    expect(messageCards.length).toBe(2);
    expect(messageCards[0]!.props("isFirst")).toBe(true);
    expect(messageCards[0]!.props("isLast")).toBe(false);
    expect(messageCards[1]!.props("isFirst")).toBe(false);
    expect(messageCards[1]!.props("isLast")).toBe(true);
  });

  it("forwards card events to composable handlers", async () => {
    cards.value = [
      { id: "a", role: "system", body: "S" },
      { id: "b", role: "user", body: "U" },
    ];
    const w = mount(PromptEditor);
    const cardComponents = w.findAllComponents({ name: "PromptEditorMessageCard" });
    cardComponents[0]!.vm.$emit("move-down");
    cardComponents[1]!.vm.$emit("move-up");
    cardComponents[1]!.vm.$emit("delete");
    cardComponents[0]!.vm.$emit("update:role", "assistant");
    cardComponents[0]!.vm.$emit("update:body", "new-body");
    await flushPromises();
    expect(moveCardDownMock).toHaveBeenCalledWith("a");
    expect(moveCardUpMock).toHaveBeenCalledWith("b");
    expect(deleteCardMock).toHaveBeenCalledWith("b");
    expect(cards.value[0]!.role).toBe("assistant");
    expect(cards.value[0]!.body).toBe("new-body");
  });
});
