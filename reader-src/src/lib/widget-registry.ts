// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Schema-driven widget registry for plugin settings forms.
// Per design D7: factory-per-instance, no module-level singleton.

import type { Component, InjectionKey } from "vue";
import { markRaw } from "vue";
import type { ValidationError } from "@/lib/validation-i18n";

import TextWidget from "@/components/widgets/TextWidget.vue";
import NumberWidget from "@/components/widgets/NumberWidget.vue";
import CheckboxWidget from "@/components/widgets/CheckboxWidget.vue";
import SelectWidget from "@/components/widgets/SelectWidget.vue";
import MultiSelectWidget from "@/components/widgets/MultiSelectWidget.vue";
import TagsWidget from "@/components/widgets/TagsWidget.vue";
import ColorWidget from "@/components/widgets/ColorWidget.vue";
import MaskedSecretWidget from "@/components/widgets/MaskedSecretWidget.vue";
import RangeNumberWidget from "@/components/widgets/RangeNumberWidget.vue";
import PathPickerWidget from "@/components/widgets/PathPickerWidget.vue";
import ComboboxWidget from "@/components/widgets/ComboboxWidget.vue";
import ObjectFieldsetWidget from "@/components/widgets/ObjectFieldsetWidget.vue";
import RepeaterWidget from "@/components/widgets/RepeaterWidget.vue";

export type JsonSchema = Record<string, unknown>;

export interface SchemaMeta {
  schemaVersion: number;
  pathRoots: string[];
  formats: string[];
}

export interface WidgetDescriptor {
  kind: string;
  component: Component;
  match: (schema: JsonSchema) => number;
}

export interface FormContextValue {
  registry: WidgetRegistry;
  errors: ValidationError[];
  schemaMeta: SchemaMeta | null;
  basePath: string;
  rootModel: Record<string, unknown>;
}

export const FormContextKey: InjectionKey<FormContextValue> = Symbol("HeartReverie:FormContext");

export class WidgetRegistry {
  private descriptors: WidgetDescriptor[] = [];
  private fallback: WidgetDescriptor;

  constructor(fallback: WidgetDescriptor) {
    this.fallback = { ...fallback, component: markRaw(fallback.component) };
  }

  register(descriptor: WidgetDescriptor): this {
    this.descriptors.push({ ...descriptor, component: markRaw(descriptor.component) });
    return this;
  }

  get fallbackDescriptor(): WidgetDescriptor {
    return this.fallback;
  }

  list(): WidgetDescriptor[] {
    return [...this.descriptors];
  }

  resolve(schema: JsonSchema): WidgetDescriptor {
    let best: WidgetDescriptor | null = null;
    let bestScore = 0;
    for (const d of this.descriptors) {
      let score = 0;
      try {
        score = d.match(schema) | 0;
      } catch {
        score = 0;
      }
      if (score > bestScore) {
        bestScore = score;
        best = d;
      }
    }
    return best ?? this.fallback;
  }
}

// ---- Match helpers ----

function hasOptionsUrl(schema: JsonSchema): boolean {
  return typeof schema["x-options-url"] === "string";
}

function itemsHasOptionsUrl(schema: JsonSchema): boolean {
  const items = schema["items"];
  if (!items || typeof items !== "object") return false;
  return typeof (items as JsonSchema)["x-options-url"] === "string";
}

function itemsHasEnum(schema: JsonSchema): boolean {
  const items = schema["items"];
  if (!items || typeof items !== "object") return false;
  return Array.isArray((items as JsonSchema)["enum"]);
}

function isType(schema: JsonSchema, t: string): boolean {
  return schema["type"] === t;
}

// ---- Default factory ----

export function createDefaultWidgetRegistry(): WidgetRegistry {
  const textDescriptor: WidgetDescriptor = {
    kind: "text",
    component: TextWidget,
    match: (schema) => {
      const t = schema["type"];
      if (t === "string" || t === undefined || t === null) return 5;
      return 0;
    },
  };

  const registry = new WidgetRegistry(textDescriptor);

  registry.register(textDescriptor);

  registry.register({
    kind: "checkbox",
    component: CheckboxWidget,
    match: (schema) => (isType(schema, "boolean") ? 50 : 0),
  });

  registry.register({
    kind: "number",
    component: NumberWidget,
    match: (schema) => {
      if (!isType(schema, "number") && !isType(schema, "integer")) return 0;
      // RangeNumberWidget wins when bounds are declared, so this is the plain case.
      const hasMin =
        typeof schema["minimum"] === "number" || typeof schema["exclusiveMinimum"] === "number";
      const hasMax =
        typeof schema["maximum"] === "number" || typeof schema["exclusiveMaximum"] === "number";
      return hasMin && hasMax ? 0 : 40;
    },
  });

  registry.register({
    kind: "range-number",
    component: RangeNumberWidget,
    match: (schema) => {
      if (!isType(schema, "number") && !isType(schema, "integer")) return 0;
      const hasMin =
        typeof schema["minimum"] === "number" || typeof schema["exclusiveMinimum"] === "number";
      const hasMax =
        typeof schema["maximum"] === "number" || typeof schema["exclusiveMaximum"] === "number";
      return hasMin && hasMax ? 55 : 0;
    },
  });

  registry.register({
    kind: "color",
    component: ColorWidget,
    match: (schema) => (isType(schema, "string") && schema["format"] === "color" ? 70 : 0),
  });

  registry.register({
    kind: "path-picker",
    component: PathPickerWidget,
    match: (schema) => (isType(schema, "string") && schema["format"] === "path" ? 70 : 0),
  });

  registry.register({
    kind: "masked-secret",
    component: MaskedSecretWidget,
    match: (schema) => (isType(schema, "string") && schema["writeOnly"] === true ? 80 : 0),
  });

  registry.register({
    kind: "select",
    component: SelectWidget,
    match: (schema) => {
      if (!isType(schema, "string") && schema["type"] !== undefined) {
        // Allow enum on `type: string` only; arrays handled by multi-select.
        if (schema["type"] !== "number" && schema["type"] !== "integer") return 0;
      }
      if (isType(schema, "array")) return 0;
      if (Array.isArray(schema["enum"])) return 30;
      if (hasOptionsUrl(schema)) return 25;
      return 0;
    },
  });

  registry.register({
    kind: "combobox",
    component: ComboboxWidget,
    match: (schema) => {
      if (isType(schema, "array")) return 0;
      // free-text + dropdown when string + x-options-url but no enum-restriction
      if (isType(schema, "string") && hasOptionsUrl(schema) && !Array.isArray(schema["enum"])) {
        return 28;
      }
      return 0;
    },
  });

  registry.register({
    kind: "multi-select",
    component: MultiSelectWidget,
    match: (schema) => {
      if (!isType(schema, "array")) return 0;
      if (itemsHasEnum(schema) || itemsHasOptionsUrl(schema)) return 60;
      return 0;
    },
  });

  registry.register({
    kind: "tags",
    component: TagsWidget,
    match: (schema) => {
      if (!isType(schema, "array")) return 0;
      if (itemsHasEnum(schema) || itemsHasOptionsUrl(schema)) return 0;
      const items = schema["items"];
      if (items && typeof items === "object") {
        const t = (items as JsonSchema)["type"];
        if (t === "object" || t === "array") return 0;
      }
      return 35;
    },
  });

  registry.register({
    kind: "repeater",
    component: RepeaterWidget,
    match: (schema) => {
      if (!isType(schema, "array")) return 0;
      const items = schema["items"];
      if (items && typeof items === "object" && (items as JsonSchema)["type"] === "object") {
        return 65;
      }
      return 0;
    },
  });

  registry.register({
    kind: "object-fieldset",
    component: ObjectFieldsetWidget,
    match: (schema) => (isType(schema, "object") ? 50 : 0),
  });

  return registry;
}
