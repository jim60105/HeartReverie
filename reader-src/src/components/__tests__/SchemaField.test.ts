// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { mount } from "@vue/test-utils";
import { defineComponent, h, reactive } from "vue";
import SchemaField from "@/components/SchemaField.vue";
import {
  createDefaultWidgetRegistry,
  FormContextKey,
  type FormContextValue,
} from "@/lib/widget-registry";
import type { ValidationError } from "@/lib/validation-i18n";

function mountWithContext(opts: {
  schema: Record<string, unknown>;
  modelValue: unknown;
  errors?: ValidationError[];
  rootModel?: Record<string, unknown>;
  path?: string;
  propertyName?: string;
}) {
  const registry = createDefaultWidgetRegistry();
  const errors = opts.errors ?? [];
  const rootModel = opts.rootModel ?? (opts.modelValue as Record<string, unknown>) ?? {};
  const context: FormContextValue = reactive({
    registry,
    errors,
    schemaMeta: {
      schemaVersion: 1,
      pathRoots: ["playground/lore/", "playground/chapters/"],
      formats: ["path", "color", "url", "email", "uuid"],
    },
    basePath: "",
    getAuthHeaders: () => ({}),
    rootModel,
  }) as unknown as FormContextValue;

  const Host = defineComponent({
    props: ["schema", "modelValue", "path", "propertyName"],
    emits: ["update:modelValue"],
    setup(p, { emit, expose }) {
      const update = (v: unknown) => emit("update:modelValue", v);
      expose({ update });
      return () =>
        h(SchemaField, {
          schema: p.schema as Record<string, unknown>,
          path: (p.path as string) ?? "",
          modelValue: p.modelValue,
          propertyName: p.propertyName as string | undefined,
          "onUpdate:modelValue": update,
        });
    },
  });

  const wrapper = mount(Host, {
    global: {
      provide: { [FormContextKey as symbol]: context },
    },
    props: {
      schema: opts.schema,
      modelValue: opts.modelValue,
      path: opts.path ?? "",
      propertyName: opts.propertyName,
    },
  });
  return { wrapper, context, registry };
}

describe("SchemaField", () => {
  it("renders a text input for type=string", () => {
    const { wrapper } = mountWithContext({
      schema: { type: "string", title: "Name" },
      modelValue: "alice",
      propertyName: "name",
    });
    const input = wrapper.find("input[type='text']");
    expect(input.exists()).toBe(true);
    expect((input.element as HTMLInputElement).value).toBe("alice");
    expect(wrapper.text()).toContain("Name");
  });

  it("emits update:modelValue when child widget edits the value", async () => {
    const { wrapper } = mountWithContext({
      schema: { type: "string" },
      modelValue: "old",
    });
    await wrapper.find("input[type='text']").setValue("new");
    expect(wrapper.emitted("update:modelValue")?.[0]).toEqual(["new"]);
  });

  it("renders nested fieldset for nested objects", () => {
    const { wrapper } = mountWithContext({
      schema: {
        type: "object",
        properties: {
          outer: {
            type: "object",
            title: "Outer",
            properties: { inner: { type: "string", title: "Inner" } },
          },
        },
      },
      modelValue: { outer: { inner: "hi" } },
    });
    expect(wrapper.findAll("fieldset").length).toBeGreaterThanOrEqual(2);
    expect(wrapper.text()).toContain("Outer");
    expect(wrapper.text()).toContain("Inner");
    expect(wrapper.find("input[type='text']").element).toBeTruthy();
  });

  it("renders a repeater row recursively", () => {
    const { wrapper } = mountWithContext({
      schema: {
        type: "array",
        items: { type: "object", properties: { title: { type: "string", title: "Title" } } },
      },
      modelValue: [{ title: "one" }, { title: "two" }],
    });
    const inputs = wrapper.findAll("input[type='text']");
    expect(inputs.length).toBe(2);
    expect((inputs[0]!.element as HTMLInputElement).value).toBe("one");
    expect((inputs[1]!.element as HTMLInputElement).value).toBe("two");
  });

  it("scopes errors to the path and descendants", () => {
    const { wrapper } = mountWithContext({
      schema: {
        type: "object",
        properties: { a: { type: "string" }, b: { type: "string" } },
      },
      modelValue: { a: "", b: "" },
      errors: [
        { path: "a", keyword: "minLength", messageKey: "minLength", params: { minLength: 3 } },
        { path: "b", keyword: "minLength", messageKey: "minLength", params: { minLength: 3 } },
      ],
    });
    const fieldA = wrapper.find("[data-path='a']");
    const fieldB = wrapper.find("[data-path='b']");
    expect(fieldA.exists()).toBe(true);
    expect(fieldB.exists()).toBe(true);
    // each field should show exactly one error
    expect(fieldA.findAll(".widget-error").length).toBe(1);
    expect(fieldB.findAll(".widget-error").length).toBe(1);
  });

  it("hides a field when x-show-when evaluates false; retains model value", async () => {
    const rootModel = reactive({ mode: "a", detail: "kept" });
    const { wrapper, context } = mountWithContext({
      schema: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["a", "b"] },
          detail: { type: "string", "x-show-when": { field: "mode", equals: "b" } },
        },
      },
      modelValue: rootModel,
      rootModel,
    });
    // initially mode=a → detail hidden
    expect(wrapper.find("[data-path='detail']").exists()).toBe(false);
    // flip rootModel.mode to b → detail visible
    rootModel.mode = "b";
    (context as { rootModel: Record<string, unknown> }).rootModel = rootModel;
    await wrapper.vm.$nextTick();
    expect(wrapper.find("[data-path='detail']").exists()).toBe(true);
    const detailInput = wrapper.find("[data-path='detail'] input[type='text']")
      .element as HTMLInputElement;
    expect(detailInput.value).toBe("kept");
  });

  it("does not emit FormContext-missing warnings when context provided", () => {
    const { wrapper } = mountWithContext({
      schema: { type: "string" },
      modelValue: "ok",
    });
    expect(wrapper.find(".field-error").exists()).toBe(false);
  });
});
