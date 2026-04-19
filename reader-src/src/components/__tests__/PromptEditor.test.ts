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

import { ref } from "vue";
import { flushPromises, mount } from "@vue/test-utils";
import PromptEditor from "@/components/PromptEditor.vue";

const templateContentRef = ref("line");
const parametersRef = ref([
  { name: "core_var", source: "core", type: "string" },
  { name: "lore_var", source: "lore", type: "string" },
  { name: "plugin_var", source: "plugin", type: "string" },
]);
const isDirtyRef = ref(false);
const isCustomRef = ref(false);
const isSavingRef = ref(false);

const saveMock = vi.fn().mockResolvedValue(undefined);
const loadTemplateMock = vi.fn().mockResolvedValue(undefined);
const resetTemplateMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/composables/usePromptEditor", () => ({
  usePromptEditor: () => ({
    templateContent: templateContentRef,
    parameters: parametersRef,
    isDirty: isDirtyRef,
    isCustom: isCustomRef,
    isSaving: isSavingRef,
    save: saveMock,
    loadTemplate: loadTemplateMock,
    resetTemplate: resetTemplateMock,
  }),
}));

describe("PromptEditor", () => {
  beforeEach(() => {
    templateContentRef.value = "line";
    isDirtyRef.value = false;
    isCustomRef.value = false;
    isSavingRef.value = false;
    saveMock.mockClear();
    loadTemplateMock.mockClear();
    resetTemplateMock.mockClear();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads template on mount and renders variable pills", async () => {
    const wrapper = mount(PromptEditor);
    await flushPromises();

    expect(loadTemplateMock).toHaveBeenCalledTimes(1);
    expect(wrapper.findAll(".variable-pill")).toHaveLength(3);
    expect(wrapper.findAll(".pill-core")).toHaveLength(1);
    expect(wrapper.findAll(".pill-lore")).toHaveLength(1);
    expect(wrapper.findAll(".pill-plugin")).toHaveLength(1);
  });

  it("inserts selected variable at cursor", async () => {
    const wrapper = mount(PromptEditor);
    const ta = wrapper.find("textarea").element as HTMLTextAreaElement;
    ta.selectionStart = 1;
    ta.selectionEnd = 2;
    const setSelectionRangeSpy = vi.spyOn(ta, "setSelectionRange");

    await wrapper.findAll(".variable-pill")[0]!.trigger("click");

    expect(templateContentRef.value).toBe("l{{ core_var }}ne");
    expect(setSelectionRangeSpy).toHaveBeenCalled();
  });

  it("saves, resets, and emits preview/saved events", async () => {
    isDirtyRef.value = true;
    isCustomRef.value = true;
    const wrapper = mount(PromptEditor);

    await wrapper.find(".toolbar-btn--save").trigger("click");
    await flushPromises();
    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(wrapper.emitted("saved")).toHaveLength(1);

    await wrapper.findAll(".toolbar-btn")[0]!.trigger("click");
    expect(resetTemplateMock).toHaveBeenCalledTimes(1);

    await wrapper.find(".toolbar-btn--primary").trigger("click");
    expect(wrapper.emitted("preview")).toHaveLength(1);
  });

  it("shows saving state and disabled flags", () => {
    isDirtyRef.value = false;
    isCustomRef.value = false;
    isSavingRef.value = true;

    const wrapper = mount(PromptEditor);

    expect(wrapper.find(".toolbar-btn--save").attributes("disabled")).toBeDefined();
    expect(wrapper.find(".toolbar-btn").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("儲存中…");
  });
});
