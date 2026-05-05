import {
  deriveLoreFilename,
  ensureMdExtension,
  isValidSeriesOrStoryName,
  validateLoreFilename,
  sanitiseTags,
} from "@/lib/lore-filename";

describe("deriveLoreFilename", () => {
  it("preserves CJK characters verbatim", () => {
    expect(deriveLoreFilename("林小美", "character.md")).toBe("林小美.md");
  });

  it("preserves Hiragana/Katakana/Hangul", () => {
    expect(deriveLoreFilename("さくら", "character.md")).toBe("さくら.md");
    expect(deriveLoreFilename("サクラ", "character.md")).toBe("サクラ.md");
    expect(deriveLoreFilename("한글", "character.md")).toBe("한글.md");
  });

  it("collapses whitespace runs to a single dash", () => {
    expect(deriveLoreFilename("Alice  In   Wonderland", "x.md")).toBe(
      "Alice-In-Wonderland.md",
    );
  });

  it("replaces forbidden filesystem chars with dash", () => {
    expect(deriveLoreFilename("foo/bar:baz", "x.md")).toBe("foo-bar-baz.md");
  });

  it("trims leading/trailing dashes and dots", () => {
    expect(deriveLoreFilename("...hero...", "x.md")).toBe("hero.md");
    expect(deriveLoreFilename("///hero///", "x.md")).toBe("hero.md");
  });

  it("falls back to provided default for empty result", () => {
    expect(deriveLoreFilename("", "character.md")).toBe("character.md");
    expect(deriveLoreFilename("///", "character.md")).toBe("character.md");
    expect(deriveLoreFilename("   ", "character.md")).toBe("character.md");
  });

  it("NFC-normalises input", () => {
    // 'é' as U+0065 + U+0301 vs precomposed U+00E9
    const decomposed = "Cafe\u0301";
    expect(deriveLoreFilename(decomposed, "x.md")).toBe("Café.md");
  });
});

describe("ensureMdExtension", () => {
  it("appends .md when missing", () => {
    expect(ensureMdExtension("hero")).toBe("hero.md");
  });
  it("leaves .md as-is", () => {
    expect(ensureMdExtension("hero.md")).toBe("hero.md");
  });
  it("trims whitespace", () => {
    expect(ensureMdExtension("  hero  ")).toBe("hero.md");
  });
  it("returns empty for empty input", () => {
    expect(ensureMdExtension("")).toBe("");
    expect(ensureMdExtension("   ")).toBe("");
  });
});

describe("validateLoreFilename", () => {
  it("accepts simple ASCII names", () => {
    expect(validateLoreFilename("hero.md").valid).toBe(true);
  });
  it("accepts CJK names", () => {
    expect(validateLoreFilename("林小美.md").valid).toBe(true);
  });
  it("rejects path traversal", () => {
    expect(validateLoreFilename("../foo.md")).toEqual({
      valid: false,
      reason: "traversal",
    });
  });
  it("rejects leading dot", () => {
    expect(validateLoreFilename(".hidden.md")).toEqual({
      valid: false,
      reason: "reserved",
    });
  });
  it("rejects leading underscore", () => {
    expect(validateLoreFilename("_hidden.md")).toEqual({
      valid: false,
      reason: "reserved",
    });
  });
  it("rejects missing .md extension", () => {
    expect(validateLoreFilename("hero")).toEqual({
      valid: false,
      reason: "format",
    });
  });
  it("rejects forbidden characters", () => {
    expect(validateLoreFilename("foo/bar.md")).toEqual({
      valid: false,
      reason: "format",
    });
  });
  it("rejects oversize UTF-8 byte length", () => {
    const big = "字".repeat(90) + ".md"; // 90×3 bytes for CJK + 3 bytes = 273 > 255
    expect(validateLoreFilename(big)).toEqual({
      valid: false,
      reason: "too-long",
    });
  });
  it("rejects empty", () => {
    expect(validateLoreFilename("")).toEqual({ valid: false, reason: "empty" });
  });
});

describe("sanitiseTags", () => {
  it("keeps valid tags", () => {
    const r = sanitiseTags(["alpha", "beta", "fantasy"]);
    expect(r.kept).toEqual(["alpha", "beta", "fantasy"]);
    expect(r.droppedTooLong).toEqual([]);
    expect(r.droppedSpecial).toEqual([]);
  });
  it("drops empty/whitespace", () => {
    const r = sanitiseTags(["", "  ", "ok"]);
    expect(r.kept).toEqual(["ok"]);
  });
  it("drops over-100-char tags", () => {
    const big = "x".repeat(101);
    const r = sanitiseTags([big, "ok"]);
    expect(r.kept).toEqual(["ok"]);
    expect(r.droppedTooLong).toEqual([big]);
  });
  it("drops tags with forbidden characters", () => {
    const r = sanitiseTags(["a,b", "[c]", "x\ny", "ok"]);
    expect(r.kept).toEqual(["ok"]);
    expect(r.droppedSpecial).toEqual(["a,b", "[c]", "x\ny"]);
  });
  it("trims whitespace from valid tags", () => {
    const r = sanitiseTags(["  trim  "]);
    expect(r.kept).toEqual(["trim"]);
  });
});

describe("isValidSeriesOrStoryName", () => {
  it("accepts ordinary CJK and ASCII names", () => {
    expect(isValidSeriesOrStoryName("Series1")).toBe(true);
    expect(isValidSeriesOrStoryName("林小美")).toBe(true);
    expect(isValidSeriesOrStoryName("foo bar")).toBe(true);
  });
  it("rejects empty / whitespace-only", () => {
    expect(isValidSeriesOrStoryName("")).toBe(false);
    expect(isValidSeriesOrStoryName("   ")).toBe(false);
  });
  it("rejects names starting with underscore", () => {
    expect(isValidSeriesOrStoryName("_hidden")).toBe(false);
  });
  it("rejects names containing path separators", () => {
    expect(isValidSeriesOrStoryName("foo/bar")).toBe(false);
    expect(isValidSeriesOrStoryName("foo\\bar")).toBe(false);
  });
  it("rejects names containing path traversal", () => {
    expect(isValidSeriesOrStoryName("..")).toBe(false);
    expect(isValidSeriesOrStoryName("foo..bar")).toBe(false);
  });
  it("rejects names containing NUL", () => {
    expect(isValidSeriesOrStoryName("foo\x00bar")).toBe(false);
  });
  it("rejects reserved platform directory names", () => {
    expect(isValidSeriesOrStoryName("lost+found")).toBe(false);
    expect(isValidSeriesOrStoryName("$RECYCLE.BIN")).toBe(false);
    expect(isValidSeriesOrStoryName(".Trashes")).toBe(false);
  });
});
