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

import { mount } from "@vue/test-utils";
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
        availableVariables: [{ name: "foo", source: "core", type: "string" }],
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
        availableVariables: [{
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

  it("uses fallback insertion path when setRangeText is unavailable", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: {
        card: makeCard({ body: "ABCD" }),
        isFirst: false,
        isLast: false,
        availableVariables: [{
          name: "scene",
          source: "plugin",
          type: "string",
        }],
      },
      attachTo: document.body,
    });
    const ta = w.find("textarea.card-body").element as HTMLTextAreaElement;
    // Simulate an environment without setRangeText (e.g., older jsdom).
    Object.defineProperty(ta, "setRangeText", {
      configurable: true,
      value: undefined,
    });
    ta.focus();
    ta.selectionStart = 1;
    ta.selectionEnd = 3;
    await w.find("button.card-helper-btn").trigger("click");
    await w.find("button.card-variable-item").trigger("click");
    const last = w.emitted("update:body")?.slice(-1)[0]?.[0];
    expect(last).toBe("A{{ scene }}D");
    w.unmount();
  });

  it("renders pill-plugin / pill-core / pill-lore classes per source", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: {
        card: makeCard(),
        isFirst: false,
        isLast: false,
        availableVariables: [
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
