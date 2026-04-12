import { stubSessionStorage } from "@/__tests__/setup";

// Mock marked and DOMPurify before importing the composable
vi.mock("marked", () => ({
  marked: {
    parse: vi.fn((text: string) => `<p>${text}</p>`),
  },
}));

vi.mock("dompurify", () => ({
  default: {
    sanitize: vi.fn((html: string) => html),
  },
}));

describe("useMarkdownRenderer", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([]),
          headers: new Headers(),
        }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getRenderer() {
    const mod = await import("@/composables/useMarkdownRenderer");
    return mod.useMarkdownRenderer();
  }

  it("returns RenderToken[] for simple text", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("hello");
    expect(Array.isArray(tokens)).toBe(true);
    expect(tokens.length).toBeGreaterThan(0);
  });

  it("produces html token for plain markdown", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("hello world");
    const htmlTokens = tokens.filter((t) => t.type === "html");
    expect(htmlTokens.length).toBeGreaterThan(0);
    expect(htmlTokens[0]!.content).toBeDefined();
  });

  it("does not extract status blocks natively (handled by plugin)", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter(
      "text <status>基礎: [Alice|勇者|森林|好奇|長劍]</status> more",
    );
    // Status blocks are handled by the plugin's frontend-render hook,
    // not by native extraction. Without the plugin loaded, <status> tags
    // pass through to markdown and end up in html tokens.
    const types = new Set(tokens.map((t) => t.type));
    expect(types.has("status" as never)).toBe(false);
  });

  it("extracts options blocks into options tokens", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter(
      "text <options>1: 前進\n2: 後退</options> more",
    );
    const optionsTokens = tokens.filter((t) => t.type === "options");
    expect(optionsTokens.length).toBe(1);
    expect(optionsTokens[0]!.data).toHaveLength(2);
  });

  it("extracts variable blocks into variable tokens", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter(
      "text <UpdateVariable>data</UpdateVariable> more",
    );
    const varTokens = tokens.filter((t) => t.type === "variable");
    expect(varTokens.length).toBe(1);
    expect(varTokens[0]!.data.isComplete).toBe(true);
  });

  it("handles empty input", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("");
    expect(Array.isArray(tokens)).toBe(true);
  });

  it("uses default empty options when none provided", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("text");
    expect(Array.isArray(tokens)).toBe(true);
  });

  it("accepts options parameter", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("text", { isLastChapter: true });
    expect(Array.isArray(tokens)).toBe(true);
  });

  it("produces multiple token types from mixed input", async () => {
    const { renderChapter } = await getRenderer();
    const input = [
      "paragraph before",
      "<status>基礎: [A|B|C|D|E]</status>",
      "paragraph between",
      "<options>1: Go\n2: Stay</options>",
      "paragraph after",
    ].join("\n");
    const tokens = renderChapter(input);
    const types = tokens.map((t) => t.type);
    expect(types).toContain("html");
    // Status is handled by plugin, not native extraction
    expect(types).not.toContain("status");
    expect(types).toContain("options");
  });

  it("normalizes curly quotes in markdown text", async () => {
    const { marked } = await import("marked");
    const { renderChapter } = await getRenderer();
    renderChapter("\u201cHello\u201d");
    const calls = (marked.parse as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1]![0] as string;
    expect(lastCall).toContain('"');
  });

  it("doubles newlines for markdown paragraph breaks", async () => {
    const { marked } = await import("marked");
    const { renderChapter } = await getRenderer();
    renderChapter("line1\nline2");
    const calls = (marked.parse as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastCall = calls[calls.length - 1]![0] as string;
    expect(lastCall).toContain("line1\n\nline2");
  });

  it("calls marked.parse with breaks option", async () => {
    const { marked } = await import("marked");
    const { renderChapter } = await getRenderer();
    renderChapter("test");
    const calls = (marked.parse as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastOpts = calls[calls.length - 1]![1] as { breaks?: boolean };
    expect(lastOpts.breaks).toBe(true);
  });

  it("calls DOMPurify.sanitize with ADD_TAGS config", async () => {
    const DOMPurify = (await import("dompurify")).default;
    const { renderChapter } = await getRenderer();
    renderChapter("test");
    const calls = (DOMPurify.sanitize as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const lastOpts = calls[calls.length - 1]![1] as {
      ADD_TAGS?: string[];
      ADD_ATTR?: string[];
    };
    expect(lastOpts.ADD_TAGS).toContain("details");
    expect(lastOpts.ADD_TAGS).toContain("summary");
    expect(lastOpts.ADD_ATTR).toContain("open");
  });
});
