import { stubSessionStorage } from "@/__tests__/setup";
import type { RenderToken, HtmlToken } from "@/types";

describe("useMarkdownRenderer — chapter:render:after hook", () => {
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

  it("dispatches chapter:render:after once per renderChapter call with the final tokens", async () => {
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    const calls: RenderToken[][] = [];
    frontendHooks.register("chapter:render:after", (ctx) => {
      calls.push([...ctx.tokens]);
      expect(ctx.rawMarkdown).toBe("hello");
      expect(ctx.options.isLastChapter).toBe(false);
    });

    const { renderChapter } = await getRenderer();
    renderChapter("hello", { isLastChapter: false });

    expect(calls.length).toBe(1);
    expect(calls[0]!.length).toBeGreaterThan(0);
  });

  it("plugin additions to tokens are reflected in the returned array", async () => {
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    frontendHooks.register("chapter:render:after", (ctx) => {
      ctx.tokens.push({ type: "html", content: "<p>benign-added</p>" });
    });

    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("hello");
    const htmlContents = tokens
      .filter((t): t is HtmlToken => t.type === "html")
      .map((t) => t.content)
      .join("");
    expect(htmlContents).toContain("benign-added");
  });

  it("re-sanitizes plugin-injected <script> payloads in newly pushed tokens", async () => {
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    frontendHooks.register("chapter:render:after", (ctx) => {
      // Plugin maliciously appends unsanitized HTML — dispatcher must scrub.
      ctx.tokens.push({
        type: "html",
        content: "<p>safe</p><script>alert(1)</script>",
      });
    });

    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("hello");
    const joined = tokens
      .filter((t): t is HtmlToken => t.type === "html")
      .map((t) => t.content)
      .join("");

    // <script> removal demonstrates that DOMPurify re-ran on the mutated token.
    // (Attribute-level XSS vectors like `javascript:` / `onclick=` are
    // DOMPurify's responsibility and are covered by its own test suite.)
    expect(joined).not.toMatch(/<script/i);
    expect(joined).toContain("safe");
  });

  it("re-sanitizes when a handler replaces an existing token's .content", async () => {
    const { frontendHooks } = await import("@/lib/plugin-hooks");
    frontendHooks.register("chapter:render:after", (ctx) => {
      const first = ctx.tokens.find((t) => t.type === "html") as
        | HtmlToken
        | undefined;
      if (first) {
        first.content = "<div>ok</div><script>alert('x')</script>";
      }
    });

    const { renderChapter } = await getRenderer();
    const tokens = renderChapter("hello");
    const joined = tokens
      .filter((t): t is HtmlToken => t.type === "html")
      .map((t) => t.content)
      .join("");
    expect(joined).not.toMatch(/<script/i);
  });
});
