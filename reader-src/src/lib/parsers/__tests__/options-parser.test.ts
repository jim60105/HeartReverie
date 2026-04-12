import { extractOptionsBlocks, parseOptions } from "@/lib/parsers/options-parser";

// ── parseOptions ──

describe("parseOptions", () => {
  it('parses numbered options like "1: text"', () => {
    const items = parseOptions("1: 前進\n2: 後退\n3: 觀察\n4: 休息");
    expect(items).toHaveLength(4);
    expect(items[0]).toEqual({ number: 1, text: "前進" });
    expect(items[3]).toEqual({ number: 4, text: "休息" });
  });

  it("parses options with【】brackets", () => {
    const items = parseOptions("1:【探索洞穴】\n2:【返回村莊】");
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toBe("探索洞穴");
    expect(items[1]!.text).toBe("返回村莊");
  });

  it("parses options with full-width colon", () => {
    const items = parseOptions("1：往前走\n2：往後退");
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toBe("往前走");
  });

  it('parses "option1:" prefix style', () => {
    const items = parseOptions("option1: hello\noption2: world");
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toBe("hello");
    expect(items[1]!.text).toBe("world");
  });

  it("limits to 4 items maximum", () => {
    const items = parseOptions("1: a\n2: b\n3: c\n4: d\n5: e");
    expect(items).toHaveLength(4);
  });

  it("handles fewer than 4 options", () => {
    const items = parseOptions("1: only one");
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("only one");
  });

  it("skips lines that do not match the option pattern", () => {
    const items = parseOptions("no match here\n2: valid");
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toBe("valid");
  });

  it("returns empty array for unparseable content", () => {
    expect(parseOptions("no options here")).toHaveLength(0);
  });

  it("parses options with period separator", () => {
    const items = parseOptions("1. 探索\n2. 逃跑");
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toBe("探索");
    expect(items[1]!.text).toBe("逃跑");
  });

  it("skips options where text is only whitespace", () => {
    expect(parseOptions("1:   ")).toHaveLength(0);
  });

  it("handles mixed separator styles", () => {
    const items = parseOptions("1: first\n2. second\n3：third");
    expect(items).toHaveLength(3);
    expect(items[0]!.text).toBe("first");
    expect(items[1]!.text).toBe("second");
    expect(items[2]!.text).toBe("third");
  });

  it("returns empty array for empty input", () => {
    expect(parseOptions("")).toHaveLength(0);
  });

  it("parses option prefix with bracket style combined", () => {
    const items = parseOptions("option1:【探索洞穴】\noption2:【返回村莊】");
    expect(items).toHaveLength(2);
    expect(items[0]!.text).toBe("探索洞穴");
    expect(items[1]!.text).toBe("返回村莊");
  });
});

// ── extractOptionsBlocks ──

describe("extractOptionsBlocks", () => {
  it("extracts options block and returns placeholder", () => {
    const input = "text <options>1: Go\n2: Stay</options> more";
    const { text, blocks } = extractOptionsBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(text).toContain("<!--OPTIONS_BLOCK_0-->");
    expect(text).not.toContain("<options>");
  });

  it("returns parsed OptionItem[] data", () => {
    const input = "<options>1: A\n2: B</options>";
    const { blocks } = extractOptionsBlocks(input);
    expect(blocks[0]!.data).toHaveLength(2);
    expect(blocks[0]!.data[0]).toEqual({ number: 1, text: "A" });
    expect(blocks[0]!.data[1]).toEqual({ number: 2, text: "B" });
  });

  it("returns original text when no options blocks exist", () => {
    const { text, blocks } = extractOptionsBlocks("nothing");
    expect(text).toBe("nothing");
    expect(blocks).toHaveLength(0);
  });

  it("is case-insensitive for tag matching", () => {
    const { blocks } = extractOptionsBlocks("<Options>1: X</OPTIONS>");
    expect(blocks).toHaveLength(1);
  });

  it("extracts multiple options blocks with sequential placeholders", () => {
    const input = "<options>1: A</options> middle <options>1: B</options>";
    const { text, blocks } = extractOptionsBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(text).toContain("<!--OPTIONS_BLOCK_0-->");
    expect(text).toContain("<!--OPTIONS_BLOCK_1-->");
    expect(text).toContain("middle");
  });

  it("placeholder format matches expected pattern", () => {
    const { blocks } = extractOptionsBlocks("<options>1: X</options>");
    expect(blocks[0]!.placeholder).toBe("<!--OPTIONS_BLOCK_0-->");
  });
});
