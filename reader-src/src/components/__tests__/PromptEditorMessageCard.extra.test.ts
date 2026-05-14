// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { mount } from "@vue/test-utils";
import { VentoCodeEditorStub } from "./_vento-editor-stub";

vi.mock("@/components/VentoCodeEditor.vue", () => ({ default: VentoCodeEditorStub }));

import PromptEditorMessageCard from "@/components/PromptEditorMessageCard.vue";
import type { MessageCard } from "@/types";

function makeCard(overrides: Partial<MessageCard> = {}): MessageCard {
  return { id: "c1", role: "user", body: "hello", ...overrides };
}

describe("PromptEditorMessageCard — extra coverage", () => {
  it("toggling helper button twice opens then closes the variable menu", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: {
        card: makeCard(),
        isFirst: false,
        isLast: false,
        catalogVariables: [{ name: "foo", source: "core", type: "string" }],
      },
    });
    expect(w.find(".card-variable-menu").exists()).toBe(false);
    await w.find("button.card-helper-btn").trigger("click");
    expect(w.find(".card-variable-menu").exists()).toBe(true);
    await w.find("button.card-helper-btn").trigger("click");
    expect(w.find(".card-variable-menu").exists()).toBe(false);
  });

  it("inserting a variable closes the variable menu", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: {
        card: makeCard({ body: "" }),
        isFirst: false,
        isLast: false,
        catalogVariables: [{
          name: "lore_all",
          source: "lore",
          type: "string",
        }],
      },
      attachTo: document.body,
    });
    await w.find("button.card-helper-btn").trigger("click");
    expect(w.find(".card-variable-menu").exists()).toBe(true);
    await w.find("button.card-variable-item").trigger("click");
    expect(w.find(".card-variable-menu").exists()).toBe(false);
    expect(w.emitted("update:body")?.slice(-1)[0]?.[0]).toBe("{{ lore_all }}");
    w.unmount();
  });

  it("renders pill-plugin / pill-core / pill-lore classes per source", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: {
        card: makeCard(),
        isFirst: false,
        isLast: false,
        catalogVariables: [
          { name: "core_var", source: "core", type: "string" },
          { name: "lore_var", source: "lore", type: "string" },
          { name: "plug_var", source: "thinking", type: "string" },
        ],
      },
    });
    await w.find("button.card-helper-btn").trigger("click");
    const items = w.findAll("button.card-variable-item");
    expect(items[0]!.classes()).toContain("pill-core");
    expect(items[1]!.classes()).toContain("pill-lore");
    expect(items[2]!.classes()).toContain("pill-plugin");
  });

  it("delete confirmation hides body wrap while pending", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: { card: makeCard(), isFirst: false, isLast: false },
    });
    expect(w.find(".card-body-wrap").exists()).toBe(true);
    const buttons = w.findAll("button.card-action-btn");
    await buttons[buttons.length - 1]!.trigger("click");
    expect(w.find(".card-body-wrap").exists()).toBe(false);
    expect(w.find(".card-confirm").exists()).toBe(true);
    await w.find(".card-confirm-cancel").trigger("click");
    expect(w.find(".card-body-wrap").exists()).toBe(true);
  });
});
