// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Resolver behaviour: priority ordering, fallback, default coverage.

import {
  createDefaultWidgetRegistry,
  type WidgetDescriptor,
  WidgetRegistry,
} from "@/lib/widget-registry";
import { defineComponent } from "vue";

const stub = defineComponent({ name: "Stub", render: () => null });

function descriptor(kind: string, score: number): WidgetDescriptor {
  return { kind, component: stub, match: () => score };
}

describe("WidgetRegistry", () => {
  it("falls back to the text widget when nothing matches", () => {
    const fallback: WidgetDescriptor = { kind: "fallback", component: stub, match: () => 0 };
    const reg = new WidgetRegistry(fallback);
    reg.register(descriptor("nomatch", 0));
    expect(reg.resolve({ type: "anything" }).kind).toBe("fallback");
  });

  it("returns the highest-priority match", () => {
    const fallback: WidgetDescriptor = { kind: "fallback", component: stub, match: () => 0 };
    const reg = new WidgetRegistry(fallback);
    reg.register(descriptor("low", 10));
    reg.register(descriptor("high", 50));
    reg.register(descriptor("mid", 25));
    expect(reg.resolve({}).kind).toBe("high");
  });

  it("breaks ties by first-registered", () => {
    const fallback: WidgetDescriptor = { kind: "fallback", component: stub, match: () => 0 };
    const reg = new WidgetRegistry(fallback);
    reg.register(descriptor("first", 40));
    reg.register(descriptor("second", 40));
    expect(reg.resolve({}).kind).toBe("first");
  });

  it("ignores match() exceptions and treats as 0", () => {
    const fallback: WidgetDescriptor = { kind: "fallback", component: stub, match: () => 0 };
    const reg = new WidgetRegistry(fallback);
    const throwy: WidgetDescriptor = {
      kind: "boom",
      component: stub,
      match: () => {
        throw new Error("boom");
      },
    };
    reg.register(throwy);
    reg.register(descriptor("ok", 5));
    expect(reg.resolve({}).kind).toBe("ok");
  });
});

describe("createDefaultWidgetRegistry", () => {
  it("returns a fresh instance per call (no module singleton)", () => {
    const a = createDefaultWidgetRegistry();
    const b = createDefaultWidgetRegistry();
    expect(a).not.toBe(b);
  });

  it("includes the phase-1 widget kinds", () => {
    const reg = createDefaultWidgetRegistry();
    const kinds = new Set(reg.list().map((d) => d.kind));
    for (
      const k of [
        "text",
        "number",
        "checkbox",
        "select",
        "multi-select",
        "tags",
        "color",
        "masked-secret",
        "range-number",
        "path-picker",
        "combobox",
        "object-fieldset",
        "repeater",
      ]
    ) {
      expect(kinds.has(k)).toBe(true);
    }
  });

  it("resolves multi-select for array+items.enum (the demo case)", () => {
    const reg = createDefaultWidgetRegistry();
    const resolved = reg.resolve({
      type: "array",
      items: { type: "string", enum: ["a", "b", "c"] },
    });
    expect(resolved.kind).toBe("multi-select");
  });

  it("resolves tags for array without items.enum", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "array", items: { type: "string" } }).kind).toBe("tags");
  });

  it("resolves repeater for array of object", () => {
    const reg = createDefaultWidgetRegistry();
    expect(
      reg.resolve({
        type: "array",
        items: { type: "object", properties: { name: { type: "string" } } },
      }).kind,
    ).toBe("repeater");
  });

  it("resolves checkbox for boolean", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "boolean" }).kind).toBe("checkbox");
  });

  it("resolves range-number for bounded numerics", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "integer", minimum: 0, maximum: 10 }).kind).toBe("range-number");
  });

  it("resolves plain number when only one bound is set", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "number", minimum: 0 }).kind).toBe("number");
  });

  it("resolves color when format=color", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "string", format: "color" }).kind).toBe("color");
  });

  it("resolves path-picker when format=path", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "string", format: "path" }).kind).toBe("path-picker");
  });

  it("resolves masked-secret when writeOnly=true (highest priority)", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "string", writeOnly: true }).kind).toBe("masked-secret");
  });

  it("resolves select for string+enum", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "string", enum: ["a", "b"] }).kind).toBe("select");
  });

  it("resolves combobox for string+x-options-url", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "string", "x-options-url": "/api/x" }).kind).toBe("combobox");
  });

  it("resolves object-fieldset for plain object", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({ type: "object", properties: {} }).kind).toBe("object-fieldset");
  });

  it("falls back to text for unknown shapes", () => {
    const reg = createDefaultWidgetRegistry();
    expect(reg.resolve({}).kind).toBe("text");
    expect(reg.resolve({ type: "string" }).kind).toBe("text");
  });
});
