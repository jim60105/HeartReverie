// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Helpers for mounting individual widgets in isolation.

import { defineComponent, h, reactive } from "vue";
import { mount, type VueWrapper } from "@vue/test-utils";
import {
  createDefaultWidgetRegistry,
  FormContextKey,
  type FormContextValue,
} from "@/lib/widget-registry";
import type { ValidationError } from "@/lib/validation-i18n";
import type { Component } from "vue";

export interface MountWidgetOpts {
  schema: Record<string, unknown>;
  modelValue: unknown;
  errors?: ValidationError[];
  path?: string;
  rootModel?: Record<string, unknown>;
  schemaMeta?: {
    schemaVersion: number;
    pathRoots: string[];
    formats: string[];
  };
}

export function mountWidget(Widget: Component, opts: MountWidgetOpts): {
  wrapper: VueWrapper;
  emitted: () => unknown[][] | undefined;
} {
  const registry = createDefaultWidgetRegistry();
  const ctx: FormContextValue = reactive({
    registry,
    errors: opts.errors ?? [],
    schemaMeta: opts.schemaMeta ?? {
      schemaVersion: 1,
      pathRoots: ["playground/lore/", "playground/chapters/"],
      formats: ["path", "color", "url", "email", "uuid"],
    },
    basePath: "",
    rootModel: opts.rootModel ?? {},
  }) as unknown as FormContextValue;

  const Host = defineComponent({
    props: ["modelValue"],
    emits: ["update:modelValue"],
    setup(p, { emit }) {
      return () =>
        h(Widget, {
          schema: opts.schema,
          path: opts.path ?? "",
          modelValue: p.modelValue,
          errors: opts.errors ?? [],
          context: ctx,
          "onUpdate:modelValue": (v: unknown) => emit("update:modelValue", v),
        });
    },
  });
  const wrapper = mount(Host, {
    props: { modelValue: opts.modelValue },
    global: { provide: { [FormContextKey as symbol]: ctx } },
  });
  return { wrapper, emitted: () => wrapper.emitted("update:modelValue") };
}
