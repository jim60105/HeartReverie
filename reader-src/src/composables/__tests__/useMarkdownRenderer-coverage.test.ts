import { stubSessionStorage } from "@/__tests__/setup";
import type { HtmlToken } from "@/types";

vi.mock("marked", () => ({
  marked: {
    parse: vi.fn((text: string) => `<p>${text}</p>`),
  },
}));

describe("useMarkdownRenderer vento-error coverage", () => {
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
        })
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts vento-error placeholders and splits mixed tokens", async () => {
    const { useMarkdownRenderer } = await import("@/composables/useMarkdownRenderer");
    const { renderChapter } = useMarkdownRenderer();

    const tokens = renderChapter(
      [
        "before",
        "<vento-error><message>Broken render</message><source>system.md</source><line>3</line></vento-error>",
        "after",
      ].join("\n"),
      { isLastChapter: true },
    );

    const vento = tokens.find((t) => t.type === "vento-error");
    expect(vento).toBeDefined();

    const html = tokens.filter((t): t is HtmlToken => t.type === "html").map((t) => t.content).join(" ");
    expect(html).toContain("before");
    expect(html).toContain("after");
  });
});
