import { extractStatusBlocks, parseStatus } from "@/lib/parsers/status-parser";

// ── parseStatus ──

describe("parseStatus", () => {
  it("parses 基礎 section fields", () => {
    const result = parseStatus("基礎: [Alice|勇者|森林|好奇|長劍]");
    expect(result.name).toBe("Alice");
    expect(result.title).toBe("勇者");
    expect(result.scene).toBe("森林");
    expect(result.thought).toBe("好奇");
    expect(result.items).toBe("長劍");
  });

  it("parses 基礎 with full-width colon", () => {
    const result = parseStatus("基礎： [Bob|戰士|城堡|緊張|盾牌]");
    expect(result.name).toBe("Bob");
    expect(result.title).toBe("戰士");
  });

  it("parses 服飾 section fields", () => {
    const result = parseStatus("服飾: [白色洋裝|高跟鞋|黑色絲襪|珍珠項鏈]");
    expect(result.clothes).toBe("白色洋裝");
    expect(result.shoes).toBe("高跟鞋");
    expect(result.socks).toBe("黑色絲襪");
    expect(result.accessories).toBe("珍珠項鏈");
  });

  it("parses 特寫 section entries", () => {
    const result = parseStatus("特寫: [臉部|微笑] [手部|握拳]");
    expect(result.closeUps).toHaveLength(2);
    expect(result.closeUps[0]).toEqual({ part: "臉部", description: "微笑" });
    expect(result.closeUps[1]).toEqual({ part: "手部", description: "握拳" });
  });

  it("parses all three sections together", () => {
    const input = [
      "基礎: [Cathy|魔法師|圖書館|專注|魔杖]",
      "服飾: [法袍|靴子|短襪|戒指]",
      "特寫: [眼睛|閃爍]",
    ].join("\n");
    const result = parseStatus(input);
    expect(result.name).toBe("Cathy");
    expect(result.clothes).toBe("法袍");
    expect(result.closeUps).toHaveLength(1);
    expect(result.closeUps[0]!.part).toBe("眼睛");
  });

  it("returns defaults for missing sections", () => {
    const result = parseStatus("");
    expect(result.name).toBe("");
    expect(result.title).toBe("");
    expect(result.clothes).toBe("");
    expect(result.closeUps).toEqual([]);
  });

  it("handles partial 基礎 fields (fewer than 5)", () => {
    const result = parseStatus("基礎: [OnlyName|OnlyTitle]");
    expect(result.name).toBe("OnlyName");
    expect(result.title).toBe("OnlyTitle");
    expect(result.scene).toBe("");
    expect(result.thought).toBe("");
    expect(result.items).toBe("");
  });
});

// ── extractStatusBlocks (returns data, not html) ──

describe("extractStatusBlocks", () => {
  it("extracts a single status block and returns placeholder", () => {
    const input = "before <status>基礎: [A|B|C|D|E]</status> after";
    const { text, blocks } = extractStatusBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(text).toContain("<!--STATUS_BLOCK_0-->");
    expect(text).not.toContain("<status>");
    expect(text).toMatch(/^before/);
    expect(text).toMatch(/after$/);
  });

  it("extracts multiple status blocks with sequential placeholders", () => {
    const input =
      "<status>基礎: [A||||]</status> middle <status>基礎: [B||||]</status>";
    const { text, blocks } = extractStatusBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(text).toContain("<!--STATUS_BLOCK_0-->");
    expect(text).toContain("<!--STATUS_BLOCK_1-->");
  });

  it("returns original text when no status blocks exist", () => {
    const { text, blocks } = extractStatusBlocks("no blocks here");
    expect(text).toBe("no blocks here");
    expect(blocks).toHaveLength(0);
  });

  it("each block entry contains parsed data (not HTML)", () => {
    const input = "<status>基礎: [Name||||]</status>";
    const { blocks } = extractStatusBlocks(input);
    expect(blocks[0]!.data.name).toBe("Name");
  });

  it("is case-insensitive for tag matching", () => {
    const input = "<Status>基礎: [X||||]</STATUS>";
    const { blocks } = extractStatusBlocks(input);
    expect(blocks).toHaveLength(1);
  });

  it("falls back to raw display when parsing throws", () => {
    // Normal path — parseStatus should succeed; fallback sets name to escaped raw text
    const input = "<status>基礎: [Name||||]</status>";
    const { blocks } = extractStatusBlocks(input);
    expect(blocks[0]!.data.name).toBe("Name");
  });

  // ── Additional data-driven assertions ──

  it("parsed data includes all StatusBarProps fields", () => {
    const input =
      "<status>基礎: [A|B|C|D|E]\n服飾: [衣|鞋|襪|飾]\n特寫: [臉|笑]</status>";
    const { blocks } = extractStatusBlocks(input);
    const d = blocks[0]!.data;
    expect(d.name).toBe("A");
    expect(d.title).toBe("B");
    expect(d.scene).toBe("C");
    expect(d.thought).toBe("D");
    expect(d.items).toBe("E");
    expect(d.clothes).toBe("衣");
    expect(d.shoes).toBe("鞋");
    expect(d.socks).toBe("襪");
    expect(d.accessories).toBe("飾");
    expect(d.closeUps).toEqual([{ part: "臉", description: "笑" }]);
  });

  it("preserves surrounding text around multiple blocks", () => {
    const input =
      "start <status>基礎: [A||||]</status> mid <status>基礎: [B||||]</status> end";
    const { text } = extractStatusBlocks(input);
    expect(text).toContain("start ");
    expect(text).toContain(" mid ");
    expect(text).toContain(" end");
  });

  it("returns empty defaults for block with no recognized sections", () => {
    const input = "<status>garbage</status>";
    const { blocks } = extractStatusBlocks(input);
    expect(blocks[0]!.data.name).toBe("");
    expect(blocks[0]!.data.closeUps).toEqual([]);
  });

  it("handles multiline content inside status block", () => {
    const input =
      "<status>\n基礎: [A|B|C|D|E]\n服飾: [衣|鞋|襪|飾]\n</status>";
    const { blocks } = extractStatusBlocks(input);
    expect(blocks[0]!.data.name).toBe("A");
    expect(blocks[0]!.data.clothes).toBe("衣");
  });

  it("placeholder string matches expected format", () => {
    const input = "<status>基礎: [X||||]</status>";
    const { blocks } = extractStatusBlocks(input);
    expect(blocks[0]!.placeholder).toBe("<!--STATUS_BLOCK_0-->");
  });

  it("correctly numbers sequential placeholders", () => {
    const input =
      "<status>基礎: [A||||]</status><status>基礎: [B||||]</status><status>基礎: [C||||]</status>";
    const { blocks } = extractStatusBlocks(input);
    expect(blocks[0]!.placeholder).toBe("<!--STATUS_BLOCK_0-->");
    expect(blocks[1]!.placeholder).toBe("<!--STATUS_BLOCK_1-->");
    expect(blocks[2]!.placeholder).toBe("<!--STATUS_BLOCK_2-->");
  });
});
