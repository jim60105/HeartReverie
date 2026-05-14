// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Sidebar grouping test for SettingsLayout: ensures meta.category buckets
// route children into "General" and "Developer Tools" groups in that order.

import { describe, expect, it, vi } from "vitest";
import { defineComponent, nextTick } from "vue";
import { mount } from "@vue/test-utils";

vi.mock("vue-router", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

vi.mock("@/router", () => ({
  default: { push: vi.fn(), replace: vi.fn() },
  settingsChildren: [
    {
      path: "prompt-editor",
      name: "settings-prompt-editor",
      component: { template: "<div />" },
      meta: { title: "編排器", category: "general" },
    },
    {
      path: "llm",
      name: "settings-llm",
      component: { template: "<div />" },
      meta: { title: "LLM 設定", category: "general" },
    },
    {
      path: "hook-inspector",
      name: "settings-hook-inspector",
      component: { template: "<div />" },
      meta: { title: "Hook 檢視", category: "developer-tools" },
    },
  ],
}));

vi.stubGlobal(
  "fetch",
  vi.fn().mockResolvedValue({ ok: true, json: async () => [] }),
);

const RouterLinkStub = defineComponent({
  name: "RouterLink",
  props: ["to", "activeClass"],
  template: '<a class="router-link-stub"><slot /></a>',
});
const RouterViewStub = defineComponent({
  name: "RouterView",
  template: '<div />',
});

describe("SettingsLayout — sidebar grouping by meta.category", () => {
  it("renders general links before the developer-tools divider; hook-inspector lives in developer-tools", async () => {
    const SettingsLayout = (await import("@/components/SettingsLayout.vue")).default;
    const wrapper = mount(SettingsLayout, {
      global: { stubs: { "router-link": RouterLinkStub, "router-view": RouterViewStub } },
    });
    await nextTick();
    await new Promise((r) => setTimeout(r, 5));
    await nextTick();

    const html = wrapper.html();
    expect(html).toContain("開發者工具");
    expect(html).toContain("Hook 檢視");

    const llmIdx = html.indexOf("LLM 設定");
    const devDividerIdx = html.indexOf("開發者工具");
    const hookIdx = html.indexOf("Hook 檢視");

    expect(llmIdx).toBeGreaterThan(-1);
    expect(devDividerIdx).toBeGreaterThan(llmIdx);
    expect(hookIdx).toBeGreaterThan(devDividerIdx);
  });
});
