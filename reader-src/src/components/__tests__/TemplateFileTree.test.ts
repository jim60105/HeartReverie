// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { mount, flushPromises } from "@vue/test-utils";
import TemplateFileTree from "@/components/TemplateFileTree.vue";
import type { TemplateRef } from "@/lib/template-api";

const entries: TemplateRef[] = [
  { id: "system.md", label: "system.md", path: "system.md", templatePath: "system.md", kind: "system", editable: true, sizeBytes: 0 },
  { id: "plugin:thinking:fragments/think.md", label: "thinking", path: "fragments/think.md", templatePath: "plugin:thinking:fragments/think.md", kind: "plugin-fragment", pluginName: "thinking", editable: false, sizeBytes: 0 },
  { id: "lore:global:world.md", label: "global", path: "world.md", templatePath: "lore:global:world.md", kind: "lore", loreScope: "global", editable: true, sizeBytes: 0 },
  { id: "lore:series:demo:cast.md", label: "series", path: "cast.md", templatePath: "lore:series:demo:cast.md", kind: "lore", loreScope: "series", editable: true, sizeBytes: 0 },
  { id: "lore:story:demo:ch01:scene.md", label: "story", path: "scene.md", templatePath: "lore:story:demo:ch01:scene.md", kind: "lore", loreScope: "story", editable: true, sizeBytes: 0 },
];

describe("TemplateFileTree", () => {
  it("renders three lore sub-headers", () => {
    const w = mount(TemplateFileTree, { props: { entries, selected: null } });
    expect(w.text()).toContain("全域 (global)");
    expect(w.text()).toContain("系列 (series)");
    expect(w.text()).toContain("章節 (story)");
  });

  it("groups lore items by scope and shows leaves", () => {
    const w = mount(TemplateFileTree, { props: { entries, selected: null } });
    const text = w.text();
    expect(text).toContain("world.md");
    expect(text).toContain("cast.md");
    expect(text).toContain("scene.md");
  });

  it("renders plugin fragments with 唯讀 badge and no save button", () => {
    const w = mount(TemplateFileTree, { props: { entries, selected: null } });
    expect(w.text()).toContain("唯讀");
    // No save button anywhere in the tree.
    const saveBtns = w.findAll("button").filter((b) => b.text().includes("儲存"));
    expect(saveBtns.length).toBe(0);
  });

  it("emits select on leaf click", async () => {
    const w = mount(TemplateFileTree, { props: { entries, selected: null } });
    const leaf = w.findAll("button").find((b) => b.text().includes("world.md"));
    expect(leaf).toBeDefined();
    await leaf!.trigger("click");
    await flushPromises();
    const emitted = w.emitted("select");
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual(["lore:global:world.md"]);
  });

  it("marks selected leaf", () => {
    const w = mount(TemplateFileTree, { props: { entries, selected: "system.md" } });
    const leaf = w.findAll("button").find((b) => b.text().includes("system.md"));
    expect(leaf?.classes()).toContain("is-selected");
  });
});
