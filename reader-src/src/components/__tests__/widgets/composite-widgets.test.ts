// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { mountWidget } from "./_mount-widget";
import TagsWidget from "@/components/widgets/TagsWidget.vue";
import MaskedSecretWidget from "@/components/widgets/MaskedSecretWidget.vue";
import PathPickerWidget from "@/components/widgets/PathPickerWidget.vue";
import ObjectFieldsetWidget from "@/components/widgets/ObjectFieldsetWidget.vue";
import RepeaterWidget from "@/components/widgets/RepeaterWidget.vue";

describe("TagsWidget", () => {
  it("adds a tag on Enter and removes on click", async () => {
    const { wrapper, emitted } = mountWidget(TagsWidget, {
      schema: { type: "array", items: { type: "string" } },
      modelValue: ["a"],
    });
    const input = wrapper.find("input.tag-input");
    await input.setValue("b");
    await input.trigger("keydown", { key: "Enter" });
    const last = emitted()?.at(-1) as [string[]];
    expect(last[0]).toEqual(["a", "b"]);
  });
});

describe("MaskedSecretWidget", () => {
  it("shows '已儲存' hint when value is null", () => {
    const { wrapper } = mountWidget(MaskedSecretWidget, {
      schema: { type: "string", writeOnly: true },
      modelValue: null,
    });
    expect(wrapper.text()).toContain("已儲存");
    expect(wrapper.find("input").attributes("type")).toBe("password");
  });

  it("emits '' on clear button", async () => {
    const { wrapper, emitted } = mountWidget(MaskedSecretWidget, {
      schema: { type: "string", writeOnly: true },
      modelValue: null,
    });
    await wrapper.find("button.clear-btn").trigger("click");
    const last = emitted()?.at(-1) as [string];
    expect(last[0]).toBe("");
  });

  it("toggles visibility between password and text", async () => {
    const { wrapper } = mountWidget(MaskedSecretWidget, {
      schema: { type: "string", writeOnly: true },
      modelValue: "",
    });
    expect(wrapper.find("input").attributes("type")).toBe("password");
    await wrapper.find("button.toggle-btn").trigger("click");
    expect(wrapper.find("input").attributes("type")).toBe("text");
  });

  it("emits typed value as string", async () => {
    const { wrapper, emitted } = mountWidget(MaskedSecretWidget, {
      schema: { type: "string", writeOnly: true },
      modelValue: "",
    });
    await wrapper.find("input").setValue("new-secret");
    const last = emitted()?.at(-1) as [string];
    expect(last[0]).toBe("new-secret");
  });
});

describe("PathPickerWidget", () => {
  it("uses intersection of schemaMeta.pathRoots and x-path-roots", () => {
    const { wrapper } = mountWidget(PathPickerWidget, {
      schema: {
        type: "string",
        format: "path",
        "x-path-roots": ["playground/lore/"],
      },
      modelValue: "playground/lore/foo.md",
      schemaMeta: {
        schemaVersion: 1,
        pathRoots: ["playground/lore/", "playground/chapters/"],
        formats: ["path"],
      },
    });
    const opts = wrapper.findAll("select.path-root option");
    expect(opts.length).toBe(1);
    expect(opts[0]!.attributes("value")).toBe("playground/lore/");
  });

  it("uses all schemaMeta roots when x-path-roots is absent", () => {
    const { wrapper } = mountWidget(PathPickerWidget, {
      schema: { type: "string", format: "path" },
      modelValue: "",
      schemaMeta: {
        schemaVersion: 1,
        pathRoots: ["playground/lore/", "playground/chapters/"],
        formats: ["path"],
      },
    });
    expect(wrapper.findAll("select.path-root option").length).toBe(2);
  });

  it("emits root+suffix on rest input", async () => {
    const { wrapper, emitted } = mountWidget(PathPickerWidget, {
      schema: { type: "string", format: "path" },
      modelValue: "playground/lore/",
    });
    await wrapper.find("input.path-rest").setValue("intro.md");
    const last = emitted()?.at(-1) as [string];
    expect(last[0]).toBe("playground/lore/intro.md");
  });
});

describe("ObjectFieldsetWidget", () => {
  it("renders one SchemaField per property and forwards updates", () => {
    const { wrapper } = mountWidget(ObjectFieldsetWidget, {
      schema: {
        type: "object",
        properties: {
          a: { type: "string", title: "A" },
          b: { type: "string", title: "B" },
        },
      },
      modelValue: { a: "1", b: "2" },
    });
    expect(wrapper.text()).toContain("A");
    expect(wrapper.text()).toContain("B");
    expect(wrapper.findAll("input[type='text']").length).toBe(2);
  });
});

describe("RepeaterWidget", () => {
  it("adds and removes rows", async () => {
    const { wrapper, emitted } = mountWidget(RepeaterWidget, {
      schema: {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" } } },
      },
      modelValue: [{ name: "one" }],
    });
    await wrapper.find("button.repeater-add").trigger("click");
    const last = emitted()?.at(-1) as [unknown[]];
    expect(last[0].length).toBe(2);

    // delete button on first row
    await wrapper.find("button.row-delete").trigger("click");
    const last2 = emitted()?.at(-1) as [unknown[]];
    expect(last2[0].length).toBe(0);
  });
});
