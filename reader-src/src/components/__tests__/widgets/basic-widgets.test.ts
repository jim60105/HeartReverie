// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { mountWidget } from "./_mount-widget";
import TextWidget from "@/components/widgets/TextWidget.vue";
import NumberWidget from "@/components/widgets/NumberWidget.vue";
import CheckboxWidget from "@/components/widgets/CheckboxWidget.vue";
import ColorWidget from "@/components/widgets/ColorWidget.vue";
import RangeNumberWidget from "@/components/widgets/RangeNumberWidget.vue";

describe("TextWidget", () => {
  it("renders existing value and emits on input", async () => {
    const { wrapper, emitted } = mountWidget(TextWidget, {
      schema: { type: "string" },
      modelValue: "hello",
    });
    expect((wrapper.find("input").element as HTMLInputElement).value).toBe("hello");
    await wrapper.find("input").setValue("world");
    expect(emitted()?.[0]).toEqual(["world"]);
  });

  it("displays error messages", () => {
    const { wrapper } = mountWidget(TextWidget, {
      schema: { type: "string" },
      modelValue: "",
      errors: [{ path: "", keyword: "minLength", messageKey: "minLength", params: { minLength: 3 } }],
    });
    expect(wrapper.find(".widget-error").exists()).toBe(true);
    expect(wrapper.text()).toContain("不可少於 3");
  });
});

describe("NumberWidget", () => {
  it("emits parsed integer for type=integer", async () => {
    const { wrapper, emitted } = mountWidget(NumberWidget, {
      schema: { type: "integer" },
      modelValue: 5,
    });
    await wrapper.find("input").setValue("42");
    expect(emitted()?.[0]).toEqual([42]);
  });

  it("emits null on empty input", async () => {
    const { wrapper, emitted } = mountWidget(NumberWidget, {
      schema: { type: "number" },
      modelValue: 1.5,
    });
    await wrapper.find("input").setValue("");
    expect(emitted()?.[0]).toEqual([null]);
  });
});

describe("CheckboxWidget", () => {
  it("emits boolean on toggle", async () => {
    const { wrapper, emitted } = mountWidget(CheckboxWidget, {
      schema: { type: "boolean" },
      modelValue: false,
    });
    await wrapper.find("input").setValue(true);
    expect(emitted()?.[0]).toEqual([true]);
  });
});

describe("ColorWidget", () => {
  it("renders both color input and text input", () => {
    const { wrapper } = mountWidget(ColorWidget, {
      schema: { type: "string", format: "color" },
      modelValue: "#ff8800",
    });
    expect(wrapper.find("input[type='color']").exists()).toBe(true);
    expect(wrapper.find("input.color-text").exists()).toBe(true);
  });
});

describe("RangeNumberWidget", () => {
  it("clamps emitted value to schema bounds", async () => {
    const { wrapper, emitted } = mountWidget(RangeNumberWidget, {
      schema: { type: "integer", minimum: 0, maximum: 10 },
      modelValue: 5,
    });
    const numberInput = wrapper.findAll("input").find((w) => w.attributes("type") === "number")!;
    await numberInput.setValue("100");
    expect(emitted()?.[0]).toEqual([10]);
  });
});
