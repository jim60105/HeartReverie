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

describe("PromptEditorMessageCard", () => {
  it("renders zh-TW role labels and reflects role/body via select + textarea", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: { card: makeCard(), isFirst: false, isLast: false },
    });
    const select = w.find("select.card-role-select");
    expect(select.exists()).toBe(true);
    const optionTexts = select.findAll("option").map((o) => o.text());
    expect(optionTexts).toEqual(["系統", "使用者", "助理"]);
    expect((select.element as HTMLSelectElement).value).toBe("user");
    const ta = w.find("textarea.card-body");
    expect((ta.element as HTMLTextAreaElement).value).toBe("hello");
    await select.setValue("assistant");
    expect(w.emitted("update:role")?.[0]).toEqual(["assistant"]);
    await ta.setValue("changed");
    expect(w.emitted("update:body")?.slice(-1)[0]).toEqual(["changed"]);
  });

  it("disables ↑ on first and ↓ on last; emits move events otherwise", async () => {
    const first = mount(PromptEditorMessageCard, {
      props: { card: makeCard(), isFirst: true, isLast: false },
    });
    const upBtnFirst = first.findAll("button.card-action-btn")[0]!;
    expect((upBtnFirst.element as HTMLButtonElement).disabled).toBe(true);

    const last = mount(PromptEditorMessageCard, {
      props: { card: makeCard(), isFirst: false, isLast: true },
    });
    const downBtnLast = last.findAll("button.card-action-btn")[1]!;
    expect((downBtnLast.element as HTMLButtonElement).disabled).toBe(true);

    const mid = mount(PromptEditorMessageCard, {
      props: { card: makeCard(), isFirst: false, isLast: false },
    });
    const [up, down] = mid.findAll("button.card-action-btn");
    await up!.trigger("click");
    await down!.trigger("click");
    expect(mid.emitted("move-up")).toHaveLength(1);
    expect(mid.emitted("move-down")).toHaveLength(1);
  });

  it("delete button shows inline confirmation; confirming emits delete; cancelling does not", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: { card: makeCard(), isFirst: false, isLast: false },
    });
    expect(w.find(".card-confirm").exists()).toBe(false);
    const buttons = w.findAll("button.card-action-btn");
    const delBtn = buttons[buttons.length - 1]!;
    await delBtn.trigger("click");
    expect(w.find(".card-confirm").exists()).toBe(true);
    expect(w.text()).toContain("確定刪除這則訊息？");
    await w.find(".card-confirm-cancel").trigger("click");
    expect(w.find(".card-confirm").exists()).toBe(false);
    expect(w.emitted("delete")).toBeUndefined();

    await delBtn.trigger("click");
    await w.find(".card-confirm-confirm").trigger("click");
    expect(w.emitted("delete")).toHaveLength(1);
  });

  it("insert-variable inserts {{ name }} at the cursor and emits update:body", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: {
        card: makeCard({ body: "ABCD" }),
        isFirst: false,
        isLast: false,
        availableVariables: [
          { name: "user_input", source: "core", type: "string" },
        ],
      },
      attachTo: document.body,
    });
    const ta = w.find("textarea.card-body").element as HTMLTextAreaElement;
    ta.focus();
    ta.selectionStart = 2;
    ta.selectionEnd = 2;
    await w.find("button.card-helper-btn").trigger("click");
    await w.find("button.card-variable-item").trigger("click");
    const last = w.emitted("update:body")?.slice(-1)[0]?.[0];
    expect(last).toBe("AB{{ user_input }}CD");
    w.unmount();
  });

  it("renders empty-state hint when no variables available", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: {
        card: makeCard(),
        isFirst: false,
        isLast: false,
        availableVariables: [],
      },
    });
    await w.find("button.card-helper-btn").trigger("click");
    expect(w.text()).toContain("（目前沒有可用的變數）");
  });

  describe("auto-resize", () => {
    function flushFrame() {
      return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }

    it("grows the textarea past the three-line floor when the body is long", async () => {
      const w = mount(PromptEditorMessageCard, {
        props: { card: makeCard({ body: "hi" }), isFirst: false, isLast: false },
        attachTo: document.body,
      });
      const ta = w.find("textarea.card-body").element as HTMLTextAreaElement;
      // Force scrollHeight (happy-dom does not lay text out).
      let scrollH = 30;
      Object.defineProperty(ta, "scrollHeight", {
        configurable: true,
        get: () => scrollH,
      });
      await flushFrame();
      const floor = parseFloat(ta.style.height);
      expect(floor).toBeGreaterThan(0);

      // Now grow the body and assert the textarea grows past the floor.
      scrollH = 800;
      await w.setProps({ card: makeCard({ body: "x".repeat(400) }) });
      await w.vm.$nextTick();
      await flushFrame();
      expect(parseFloat(ta.style.height)).toBeGreaterThan(floor);
      w.unmount();
    });

    it("shrinks back to the floor when a long body is replaced with a short one", async () => {
      // Force a known scrollHeight + line metrics so we can assert the exact floor.
      const realScrollHeight = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "scrollHeight",
      );
      let sh = 800;
      Object.defineProperty(HTMLTextAreaElement.prototype, "scrollHeight", {
        configurable: true,
        get() {
          return sh;
        },
      });
      const w = mount(PromptEditorMessageCard, {
        props: {
          card: makeCard({ body: "L".repeat(800) }),
          isFirst: false,
          isLast: false,
        },
        attachTo: document.body,
      });
      const ta = w.find("textarea.card-body").element as HTMLTextAreaElement;
      // Force computed line metrics to known values so the floor is predictable.
      ta.style.lineHeight = "20px";
      ta.style.paddingTop = "0px";
      ta.style.paddingBottom = "0px";
      ta.style.borderTopWidth = "0px";
      ta.style.borderBottomWidth = "0px";
      ta.style.borderTopStyle = "solid";
      ta.style.borderBottomStyle = "solid";
      ta.style.boxSizing = "border-box";
      await flushFrame();
      const tall = parseFloat(ta.style.height);
      expect(tall).toBeGreaterThanOrEqual(800);

      sh = 10;
      await w.setProps({ card: makeCard({ body: "hi" }) });
      await w.vm.$nextTick();
      await flushFrame();
      // 3-line floor with 20px line-height = 60px; ±1px tolerance.
      expect(parseFloat(ta.style.height)).toBe(60);
      w.unmount();
      if (realScrollHeight) {
        Object.defineProperty(
          HTMLTextAreaElement.prototype,
          "scrollHeight",
          realScrollHeight,
        );
      }
    });
  });
});
