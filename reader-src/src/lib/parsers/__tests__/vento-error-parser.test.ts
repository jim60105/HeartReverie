import { extractVentoErrors } from "@/lib/parsers/vento-error-parser";

describe("extractVentoErrors", () => {
  it("returns empty blocks for text without vento-error tags", () => {
    const result = extractVentoErrors("Hello world");
    expect(result.blocks).toEqual([]);
    expect(result.text).toBe("Hello world");
  });

  it("extracts a single error block with message", () => {
    const text = "before <vento-error><message>Something broke</message></vento-error> after";
    const result = extractVentoErrors(text);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]!.placeholder).toBe("<!--VENTO_ERROR_0-->");
    expect(result.blocks[0]!.data.message).toBe("Something broke");
    expect(result.text).toContain("<!--VENTO_ERROR_0-->");
    expect(result.text).not.toContain("<vento-error>");
  });

  it("extracts source field when present", () => {
    const text = "<vento-error><message>err</message><source>template.vto</source></vento-error>";
    const result = extractVentoErrors(text);
    expect(result.blocks[0]!.data.source).toBe("template.vto");
  });

  it("extracts source and line number", () => {
    const text = "<vento-error><message>err</message><source>a.vto</source><line>42</line></vento-error>";
    const result = extractVentoErrors(text);
    expect(result.blocks[0]!.data.source).toBe("a.vto");
    expect(result.blocks[0]!.data.line).toBe(42);
  });

  it("extracts suggestion field", () => {
    const text = "<vento-error><message>err</message><suggestion>Try this</suggestion></vento-error>";
    const result = extractVentoErrors(text);
    expect(result.blocks[0]!.data.suggestion).toBe("Try this");
  });

  it("omits source when not present", () => {
    const text = "<vento-error><message>err</message></vento-error>";
    const result = extractVentoErrors(text);
    expect(result.blocks[0]!.data.source).toBeUndefined();
  });

  it("omits suggestion when not present", () => {
    const text = "<vento-error><message>err</message></vento-error>";
    const result = extractVentoErrors(text);
    expect(result.blocks[0]!.data.suggestion).toBeUndefined();
  });

  it("extracts multiple errors with sequential placeholders", () => {
    const text = "<vento-error><message>first</message></vento-error> mid <vento-error><message>second</message></vento-error> end <vento-error><message>third</message></vento-error>";
    const result = extractVentoErrors(text);
    expect(result.blocks).toHaveLength(3);
    expect(result.blocks[0]!.placeholder).toBe("<!--VENTO_ERROR_0-->");
    expect(result.blocks[1]!.placeholder).toBe("<!--VENTO_ERROR_1-->");
    expect(result.blocks[2]!.placeholder).toBe("<!--VENTO_ERROR_2-->");
  });

  it("preserves all fields in data object", () => {
    const text = `<vento-error>
      <message>Undefined variable</message>
      <source>main.vto</source>
      <line>7</line>
      <suggestion>Check variable name</suggestion>
    </vento-error>`;
    const result = extractVentoErrors(text);
    expect(result.blocks[0]!.data).toEqual({
      message: "Undefined variable",
      source: "main.vto",
      line: 7,
      suggestion: "Check variable name",
    });
  });

  it("uses full match as message when no message tag exists", () => {
    const text = "<vento-error>plain error text</vento-error>";
    const result = extractVentoErrors(text);
    expect(result.blocks[0]!.data.message).toContain("plain error text");
  });

  it("returns data objects that match VentoErrorCardProps shape", () => {
    const text = "<vento-error><message>test</message><source>x.vto</source><line>1</line><suggestion>fix</suggestion></vento-error>";
    const result = extractVentoErrors(text);
    const d = result.blocks[0]!.data;
    expect(typeof d.message).toBe("string");
    expect(typeof d.source).toBe("string");
    expect(typeof d.line).toBe("number");
    expect(typeof d.suggestion).toBe("string");
  });
});
