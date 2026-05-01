// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { ref } from "vue";
import { mount } from "@vue/test-utils";

const actionButtonsRef = ref<
  Array<{
    id: string;
    label: string;
    icon?: string;
    tooltip?: string;
    pluginName: string;
    declarationOrder: number;
  }>
>([]);
const pendingKeyRef = ref<string | null>(null);
const clickButtonMock = vi.fn();

vi.mock("@/composables/usePluginActions", () => ({
  usePluginActions: () => ({
    actionButtons: actionButtonsRef,
    pendingKey: pendingKeyRef,
    clickButton: clickButtonMock,
  }),
}));

import PluginActionBar from "@/components/PluginActionBar.vue";

describe("PluginActionBar", () => {
  beforeEach(() => {
    actionButtonsRef.value = [];
    pendingKeyRef.value = null;
    clickButtonMock.mockClear();
  });

  it("renders no DOM when no descriptors are visible", () => {
    const wrapper = mount(PluginActionBar);
    expect(wrapper.find(".plugin-action-bar").exists()).toBe(false);
    expect(wrapper.html().trim()).toBe("<!--v-if-->");
  });

  it("renders one button per visible descriptor", () => {
    actionButtonsRef.value = [
      {
        id: "recompute-state",
        label: "🧮 重算狀態",
        pluginName: "state",
        declarationOrder: 0,
      },
      {
        id: "regenerate-options",
        label: "🎲 重生選項",
        pluginName: "options",
        declarationOrder: 0,
      },
    ];
    const wrapper = mount(PluginActionBar);
    const btns = wrapper.findAll("button");
    expect(btns).toHaveLength(2);
    expect(btns[0]!.text()).toContain("重算狀態");
    expect(btns[1]!.text()).toContain("重生選項");
  });

  it("disables the clicked button while pendingKey matches", async () => {
    actionButtonsRef.value = [
      {
        id: "x",
        label: "X",
        pluginName: "p",
        declarationOrder: 0,
      },
    ];
    pendingKeyRef.value = "p:x";
    const wrapper = mount(PluginActionBar);
    const btn = wrapper.find("button");
    expect((btn.element as HTMLButtonElement).disabled).toBe(true);
  });

  it("only disables the matching pending button (qualified key)", async () => {
    actionButtonsRef.value = [
      { id: "x", label: "X", pluginName: "p", declarationOrder: 0 },
      { id: "y", label: "Y", pluginName: "q", declarationOrder: 0 },
    ];
    pendingKeyRef.value = "p:x";
    const wrapper = mount(PluginActionBar);
    const btns = wrapper.findAll("button");
    expect((btns[0]!.element as HTMLButtonElement).disabled).toBe(true);
    expect((btns[1]!.element as HTMLButtonElement).disabled).toBe(false);
  });

  it("invokes clickButton with id and pluginName", async () => {
    actionButtonsRef.value = [
      {
        id: "recompute-state",
        label: "🧮",
        pluginName: "state",
        declarationOrder: 0,
      },
    ];
    const wrapper = mount(PluginActionBar);
    await wrapper.find("button").trigger("click");
    expect(clickButtonMock).toHaveBeenCalledWith("recompute-state", "state");
  });
});
