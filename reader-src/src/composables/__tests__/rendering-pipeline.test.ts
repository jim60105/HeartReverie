import { stubSessionStorage } from "@/__tests__/setup";

// Mock marked and DOMPurify
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

describe("rendering pipeline integration", () => {
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

  it("status blocks are not natively extracted (plugin handles them)", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter(
      "before <status>基礎: [Alice|勇者|森林|好奇|長劍]</status> after",
    );
    // Without the plugin loaded, status blocks pass through to HTML
    const types = new Set(tokens.map((t) => t.type));
    expect(types.has("status" as never)).toBe(false);
  });

  it("options block produces options token", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter(
      "text <options>1: 前進\n2: 後退\n3: 觀察\n4: 休息</options>",
    );
    const optTokens = tokens.filter((t) => t.type === "options");
    expect(optTokens).toHaveLength(1);
    expect(optTokens[0]!.data).toHaveLength(4);
  });

  it("variable block produces variable token", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter(
      "<UpdateVariable>some data</UpdateVariable>",
    );
    const varTokens = tokens.filter((t) => t.type === "variable");
    expect(varTokens).toHaveLength(1);
    expect(varTokens[0]!.data).toMatchObject({
      content: "some data",
      isComplete: true,
    });
  });

  it("mixed content produces correct token types in order", async () => {
    const { renderChapter } = await getRenderer();
    const input = [
      "## Chapter Title",
      "<status>基礎: [A|B|C|D|E]</status>",
      "Some narrative text",
      "<options>1: Go\n2: Stay</options>",
      "<UpdateVariable>vars</UpdateVariable>",
    ].join("\n");
    const tokens = renderChapter(input);
    const types = tokens.map((t) => t.type);
    expect(types).toContain("html");
    // Status is handled by plugin, not native extraction
    expect(types).not.toContain("status");
    expect(types).toContain("options");
    expect(types).toContain("variable");
  });

  it("plain text produces single html token", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("Just plain text");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.type).toBe("html");
  });

  it("empty input produces single html token", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("");
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.type).toBe("html");
  });

  it("incomplete variable block is marked as incomplete", async () => {
    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("text <UpdateVariable>streaming data");
    const varTokens = tokens.filter((t) => t.type === "variable");
    expect(varTokens).toHaveLength(1);
    expect(varTokens[0]!.data.isComplete).toBe(false);
  });

  it("multiple status blocks are not natively extracted", async () => {
    const { renderChapter } = await getRenderer();
    const input =
      "<status>基礎: [A||||]</status> mid <status>基礎: [B||||]</status>";
    const tokens = renderChapter(input);
    const types = new Set(tokens.map((t) => t.type));
    expect(types.has("status" as never)).toBe(false);
  });
});
