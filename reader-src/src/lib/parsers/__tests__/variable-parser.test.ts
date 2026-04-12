import { extractVariableBlocks } from "@/lib/parsers/variable-parser";

describe("extractVariableBlocks", () => {
  it("extracts complete <UpdateVariable> block", () => {
    const input = "before <UpdateVariable>data</UpdateVariable> after";
    const { text, blocks } = extractVariableBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(text).toContain("<!--VARIABLE_BLOCK_0-->");
    expect(text).not.toContain("<UpdateVariable>");
    expect(blocks[0]!.data.content).toBe("data");
    expect(blocks[0]!.data.isComplete).toBe(true);
  });

  it("extracts incomplete <UpdateVariable> block (no closing tag)", () => {
    const input = "before <UpdateVariable>streaming data";
    const { text, blocks } = extractVariableBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(text).toContain("<!--VARIABLE_BLOCK_0-->");
    expect(blocks[0]!.data.isComplete).toBe(false);
    expect(blocks[0]!.data.content).toBe("streaming data");
  });

  it("extracts short form <update> tag", () => {
    const input = "<update>content</update>";
    const { text, blocks } = extractVariableBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(text).toContain("<!--VARIABLE_BLOCK_0-->");
    expect(blocks[0]!.data.isComplete).toBe(true);
  });

  it("extracts incomplete short form <update> tag", () => {
    const input = "text <update>partial content";
    const { text, blocks } = extractVariableBlocks(input);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.data.isComplete).toBe(false);
  });

  it("handles both complete and incomplete blocks", () => {
    const input =
      "<UpdateVariable>done</UpdateVariable> then <UpdateVariable>streaming";
    const { text, blocks } = extractVariableBlocks(input);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.data.isComplete).toBe(true);
    expect(blocks[0]!.data.content).toBe("done");
    expect(blocks[1]!.data.isComplete).toBe(false);
    expect(blocks[1]!.data.content).toBe("streaming");
  });

  it("returns original text when no variable blocks exist", () => {
    const { text, blocks } = extractVariableBlocks("plain text");
    expect(text).toBe("plain text");
    expect(blocks).toHaveLength(0);
  });

  it("is case-insensitive for tag matching", () => {
    const input = "<updatevariable>data</UPDATEVARIABLE>";
    const { blocks } = extractVariableBlocks(input);
    expect(blocks).toHaveLength(1);
  });

  it("trims whitespace from content", () => {
    const input = "<UpdateVariable>  hello  </UpdateVariable>";
    const { blocks } = extractVariableBlocks(input);
    expect(blocks[0]!.data.content).toBe("hello");
  });

  it("returns placeholder in expected format", () => {
    const input = "<update>x</update>";
    const { blocks } = extractVariableBlocks(input);
    expect(blocks[0]!.placeholder).toBe("<!--VARIABLE_BLOCK_0-->");
  });

  it("numbers sequential placeholders correctly", () => {
    const input = "<update>a</update> <update>b</update>";
    const { blocks } = extractVariableBlocks(input);
    expect(blocks[0]!.placeholder).toBe("<!--VARIABLE_BLOCK_0-->");
    expect(blocks[1]!.placeholder).toBe("<!--VARIABLE_BLOCK_1-->");
  });

  it("returns VariableDisplayProps with correct fields", () => {
    const input = "<UpdateVariable>some content</UpdateVariable>";
    const { blocks } = extractVariableBlocks(input);
    expect(blocks[0]!.data).toHaveProperty("content");
    expect(blocks[0]!.data).toHaveProperty("isComplete");
  });
});
