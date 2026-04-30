import {
  doubleNewlines,
  reinjectPlaceholders,
} from "@/lib/markdown-pipeline";

describe("doubleNewlines", () => {
  it("doubles newlines for markdown paragraph breaks", () => {
    expect(doubleNewlines("line1\nline2")).toBe("line1\n\nline2");
  });

  it("handles empty string", () => {
    expect(doubleNewlines("")).toBe("");
  });

  it("handles text with no newlines", () => {
    expect(doubleNewlines("no breaks")).toBe("no breaks");
  });

  it("handles multiple consecutive newlines", () => {
    expect(doubleNewlines("a\n\nb")).toBe("a\n\n\n\nb");
  });
});

describe("reinjectPlaceholders", () => {
  it("replaces a single placeholder", () => {
    const map = new Map([["<!--P0-->", "<div>hello</div>"]]);
    expect(reinjectPlaceholders("before <!--P0--> after", map)).toBe(
      "before <div>hello</div> after",
    );
  });

  it("replaces multiple different placeholders", () => {
    const map = new Map([
      ["<!--A-->", "<a>"],
      ["<!--B-->", "<b>"],
    ]);
    expect(reinjectPlaceholders("<!--A--> and <!--B-->", map)).toBe(
      "<a> and <b>",
    );
  });

  it("handles placeholder appearing multiple times in HTML", () => {
    const map = new Map([["<!--X-->", "REPLACED"]]);
    expect(reinjectPlaceholders("<!--X--> mid <!--X-->", map)).toBe(
      "REPLACED mid REPLACED",
    );
  });

  it("leaves text unchanged when placeholder is not found in HTML", () => {
    const map = new Map([["<!--MISSING-->", "value"]]);
    expect(reinjectPlaceholders("no placeholders here", map)).toBe(
      "no placeholders here",
    );
  });

  it("returns original HTML with empty map", () => {
    const map = new Map<string, string>();
    expect(reinjectPlaceholders("<p>hello</p>", map)).toBe("<p>hello</p>");
  });

  it("handles empty HTML string", () => {
    const map = new Map([["<!--P-->", "val"]]);
    expect(reinjectPlaceholders("", map)).toBe("");
  });

  it("preserves surrounding content", () => {
    const map = new Map([
      ["<!--STATUS_BLOCK_0-->", '<div class="status">ok</div>'],
    ]);
    const html =
      "<p>chapter start</p><!--STATUS_BLOCK_0--><p>chapter end</p>";
    expect(reinjectPlaceholders(html, map)).toBe(
      '<p>chapter start</p><div class="status">ok</div><p>chapter end</p>',
    );
  });

  it("handles placeholder with special regex chars in value", () => {
    const map = new Map([["<!--P0-->", "$1 \\n (special)"]]);
    expect(reinjectPlaceholders("<!--P0-->", map)).toBe("$1 \\n (special)");
  });
});
