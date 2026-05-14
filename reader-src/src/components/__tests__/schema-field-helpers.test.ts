// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import {
  diffPaths,
  evaluateShowWhen,
  getValueAtPath,
  isPathHidden,
  parentPath,
  tokenisePath,
} from "@/components/schema-field-helpers";

describe("schema-field-helpers", () => {
  it("tokenises mixed paths", () => {
    expect(tokenisePath("")).toEqual([]);
    expect(tokenisePath("a.b")).toEqual([
      { kind: "prop", name: "a" },
      { kind: "prop", name: "b" },
    ]);
    expect(tokenisePath("items[0].name")).toEqual([
      { kind: "prop", name: "items" },
      { kind: "index", idx: 0 },
      { kind: "prop", name: "name" },
    ]);
    expect(tokenisePath("[3].title")).toEqual([
      { kind: "index", idx: 3 },
      { kind: "prop", name: "title" },
    ]);
  });

  it("reads values at paths", () => {
    const m = { a: { b: [{ c: "hi" }] } };
    expect(getValueAtPath(m, "a.b[0].c")).toBe("hi");
    expect(getValueAtPath(m, "a.b[5].c")).toBeUndefined();
    expect(getValueAtPath(m, "")).toEqual(m);
  });

  it("derives parent paths", () => {
    expect(parentPath("a.b.c")).toBe("a.b");
    expect(parentPath("a")).toBe("");
    expect(parentPath("a.b[0].c")).toBe("a.b[0]");
    expect(parentPath("")).toBe("");
  });

  it("evaluates x-show-when equals/notEquals/in", () => {
    const root = { mode: "b", count: 3, list: ["x"] };
    expect(evaluateShowWhen({ field: "mode", equals: "b" }, "detail", root)).toBe(true);
    expect(evaluateShowWhen({ field: "mode", equals: "a" }, "detail", root)).toBe(false);
    expect(evaluateShowWhen({ field: "mode", notEquals: "a" }, "detail", root)).toBe(true);
    expect(evaluateShowWhen({ field: "count", in: [1, 2, 3] }, "detail", root)).toBe(true);
    expect(evaluateShowWhen({ field: "count", in: [9] }, "detail", root)).toBe(false);
  });

  it("isPathHidden walks the schema following x-show-when at each ancestor", () => {
    const schema = {
      type: "object",
      properties: {
        mode: { type: "string" },
        detail: { type: "string", "x-show-when": { field: "mode", equals: "b" } },
      },
    } as Record<string, unknown>;
    expect(isPathHidden(schema, "detail", { mode: "a", detail: "kept" })).toBe(true);
    expect(isPathHidden(schema, "detail", { mode: "b", detail: "kept" })).toBe(false);
    expect(isPathHidden(schema, "mode", { mode: "a" })).toBe(false);
  });

  it("diffPaths reports changed leaves", () => {
    const before = { a: 1, b: { c: "x" }, d: [1, 2] };
    const after = { a: 1, b: { c: "y" }, d: [1, 2, 3] };
    const paths = diffPaths(before, after);
    expect(paths).toContain("b.c");
    // length differs → array root + missing entry
    expect(paths.some((p) => p.startsWith("d"))).toBe(true);
  });
});
