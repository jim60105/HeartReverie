// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { mount } from "@vue/test-utils";
import { VentoCodeEditorStub } from "./_vento-editor-stub";

vi.mock("@/components/VentoCodeEditor.vue", () => ({ default: VentoCodeEditorStub }));

import PromptEditorMessageCard from "@/components/PromptEditorMessageCard.vue";
import type { MessageCard } from "@/types";

function makeCard(overrides: Partial<MessageCard> = {}): MessageCard {
  return { id: "c1", role: "user", body: "hello", ...overrides };
}

describe("PromptEditorMessageCard", () => {
  it("renders zh-TW role labels and reflects role/body via select + editor", async () => {
    const w = mount(PromptEditorMessageCard, {
      props: { card: makeCard(), isFirst: false, isLast: false },
    });
    const select = w.find("select.card-role-select");
    expect(select.exists()).toBe(true);
    const optionTexts = select.findAll("option").map((o) => o.text());
    expect(optionTexts).toEqual(["系統", "使用者", "助理"]);
    expect((select.element as HTMLSelectElement).value).toBe("user");
    const ta = w.find("textarea.mock-vento-editor");
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
        catalogVariables: [
          { name: "user_input", source: "core", type: "string" },
        ],
      },
      attachTo: document.body,
    });
    const ta = w.find("textarea.mock-vento-editor").element as HTMLTextAreaElement;
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
        catalogVariables: [],
      },
    });
    await w.find("button.card-helper-btn").trigger("click");
    expect(w.text()).toContain("（目前沒有可用的變數）");
  });
});
