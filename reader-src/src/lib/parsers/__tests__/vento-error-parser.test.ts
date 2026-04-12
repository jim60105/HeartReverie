import { extractVentoErrors } from "@/lib/parsers/vento-error-parser";
import type { VentoErrorCardProps } from "@/types";

describe("extractVentoErrors", () => {
  it("returns empty array for empty input", () => {
    expect(extractVentoErrors([])).toEqual([]);
  });

  it("maps a single error to a placeholder entry", () => {
    const errors: VentoErrorCardProps[] = [{ message: "Something broke" }];
    const result = extractVentoErrors(errors);
    expect(result).toHaveLength(1);
    expect(result[0]!.placeholder).toBe("<!--VENTO_ERROR_0-->");
    expect(result[0]!.data.message).toBe("Something broke");
  });

  it("includes source field when provided", () => {
    const errors: VentoErrorCardProps[] = [
      { message: "err", source: "template.vto" },
    ];
    const result = extractVentoErrors(errors);
    expect(result[0]!.data.source).toBe("template.vto");
  });

  it("includes source with line number when provided", () => {
    const errors: VentoErrorCardProps[] = [
      { message: "err", source: "a.vto", line: 42 },
    ];
    const result = extractVentoErrors(errors);
    expect(result[0]!.data.source).toBe("a.vto");
    expect(result[0]!.data.line).toBe(42);
  });

  it("includes suggestion when provided", () => {
    const errors: VentoErrorCardProps[] = [
      { message: "err", suggestion: "Try this" },
    ];
    const result = extractVentoErrors(errors);
    expect(result[0]!.data.suggestion).toBe("Try this");
  });

  it("omits source when not present", () => {
    const errors: VentoErrorCardProps[] = [{ message: "err" }];
    const result = extractVentoErrors(errors);
    expect(result[0]!.data.source).toBeUndefined();
  });

  it("omits suggestion when not present", () => {
    const errors: VentoErrorCardProps[] = [{ message: "err" }];
    const result = extractVentoErrors(errors);
    expect(result[0]!.data.suggestion).toBeUndefined();
  });

  it("maps multiple errors with sequential placeholders", () => {
    const errors: VentoErrorCardProps[] = [
      { message: "first" },
      { message: "second" },
      { message: "third" },
    ];
    const result = extractVentoErrors(errors);
    expect(result).toHaveLength(3);
    expect(result[0]!.placeholder).toBe("<!--VENTO_ERROR_0-->");
    expect(result[1]!.placeholder).toBe("<!--VENTO_ERROR_1-->");
    expect(result[2]!.placeholder).toBe("<!--VENTO_ERROR_2-->");
  });

  it("preserves all fields in data object", () => {
    const errors: VentoErrorCardProps[] = [
      {
        message: "Undefined variable",
        source: "main.vto",
        line: 7,
        suggestion: "Check variable name",
      },
    ];
    const result = extractVentoErrors(errors);
    expect(result[0]!.data).toEqual({
      message: "Undefined variable",
      source: "main.vto",
      line: 7,
      suggestion: "Check variable name",
    });
  });

  it("omits line when not provided but source is present", () => {
    const errors: VentoErrorCardProps[] = [
      { message: "err", source: "b.vto" },
    ];
    const result = extractVentoErrors(errors);
    expect(result[0]!.data.source).toBe("b.vto");
    expect(result[0]!.data.line).toBeUndefined();
  });

  it("returns data objects that match VentoErrorCardProps shape", () => {
    const errors: VentoErrorCardProps[] = [
      { message: "test", source: "x.vto", line: 1, suggestion: "fix" },
    ];
    const result = extractVentoErrors(errors);
    const d = result[0]!.data;
    expect(typeof d.message).toBe("string");
    expect(typeof d.source).toBe("string");
    expect(typeof d.line).toBe("number");
    expect(typeof d.suggestion).toBe("string");
  });
});
