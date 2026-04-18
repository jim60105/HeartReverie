import { stubSessionStorage } from "@/__tests__/setup";

function mockFetch(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        headers: new Headers(),
      }),
    ),
  );
}

describe("usePlugins", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockFetch([]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getPlugins() {
    const mod = await import("@/composables/usePlugins");
    return mod.usePlugins();
  }

  it("initial state: not initialized, empty plugins", async () => {
    const p = await getPlugins();
    expect(p.initialized.value).toBe(false);
    expect(p.plugins.value).toEqual([]);
  });

  it("initPlugins fetches plugin list", async () => {
    mockFetch([
      { name: "test-plugin", hasFrontendModule: false },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    expect(fetch).toHaveBeenCalled();
    expect(p.plugins.value).toHaveLength(1);
    expect(p.initialized.value).toBe(true);
  });

  it("initPlugins only runs once", async () => {
    mockFetch([]);
    const p = await getPlugins();
    await p.initPlugins();
    await p.initPlugins();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("applyDisplayStrip returns text unchanged when no patterns", async () => {
    const p = await getPlugins();
    expect(p.applyDisplayStrip("hello world")).toBe("hello world");
  });

  it("applyDisplayStrip removes matching tags after init", async () => {
    mockFetch([
      {
        name: "strip-test",
        hasFrontendModule: false,
        displayStripTags: ["custom"],
      },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    const result = p.applyDisplayStrip(
      "before <custom>inner</custom> after",
    );
    expect(result).toBe("before  after");
  });

  it("displayStripTags handles regex patterns", async () => {
    mockFetch([
      {
        name: "regex-test",
        hasFrontendModule: false,
        displayStripTags: ["/<test>[\\s\\S]*?<\\/test>/"],
      },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    const result = p.applyDisplayStrip("before <test>data</test> after");
    expect(result).toBe("before  after");
  });

  it("handles plugins with no displayStripTags", async () => {
    mockFetch([
      { name: "no-strip", hasFrontendModule: false },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    expect(p.applyDisplayStrip("unchanged")).toBe("unchanged");
  });

  it("exports FrontendHookDispatcher class", async () => {
    const mod = await import("@/composables/usePlugins");
    expect(mod.FrontendHookDispatcher).toBeDefined();
  });

  it("silently ignores fetch errors during initPlugins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network"))),
    );
    const p = await getPlugins();
    // Should not throw
    await p.initPlugins();
    expect(p.plugins.value).toEqual([]);
  });
});

describe("usePlugins - CSS injection", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    document.head.querySelectorAll("link[data-plugin]").forEach((el) =>
      el.remove()
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.head.querySelectorAll("link[data-plugin]").forEach((el) =>
      el.remove()
    );
  });

  async function getPlugins() {
    const mod = await import("@/composables/usePlugins");
    return mod.usePlugins();
  }

  it("injects link elements for plugins with frontendStyles", async () => {
    mockFetch([
      {
        name: "styled",
        hasFrontendModule: false,
        frontendStyles: ["/plugins/styled/styles.css"],
      },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    const link = document.head.querySelector<HTMLLinkElement>(
      'link[href="/plugins/styled/styles.css"]',
    );
    expect(link).not.toBeNull();
    expect(link?.rel).toBe("stylesheet");
  });

  it("sets data-plugin attribute on injected links", async () => {
    mockFetch([
      {
        name: "my-plugin",
        hasFrontendModule: false,
        frontendStyles: ["/plugins/my-plugin/a.css"],
      },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    const link = document.head.querySelector<HTMLLinkElement>(
      'link[href="/plugins/my-plugin/a.css"]',
    );
    expect(link?.dataset.plugin).toBe("my-plugin");
  });

  it("deduplicates identical hrefs across plugins", async () => {
    mockFetch([
      {
        name: "p1",
        hasFrontendModule: false,
        frontendStyles: ["/plugins/shared/s.css", "/plugins/shared/s.css"],
      },
      {
        name: "p2",
        hasFrontendModule: false,
        frontendStyles: ["/plugins/shared/s.css"],
      },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    const links = document.head.querySelectorAll(
      'link[href="/plugins/shared/s.css"]',
    );
    expect(links.length).toBe(1);
  });

  it("onerror handler removes the link element", async () => {
    mockFetch([
      {
        name: "broken",
        hasFrontendModule: false,
        frontendStyles: ["/plugins/broken/missing.css"],
      },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    const link = document.head.querySelector<HTMLLinkElement>(
      'link[href="/plugins/broken/missing.css"]',
    );
    expect(link).not.toBeNull();
    link?.onerror?.(new Event("error"));
    expect(
      document.head.querySelector(
        'link[href="/plugins/broken/missing.css"]',
      ),
    ).toBeNull();
  });

  it("skips plugins without frontendStyles", async () => {
    mockFetch([
      { name: "no-styles", hasFrontendModule: false },
    ]);
    const p = await getPlugins();
    await p.initPlugins();
    expect(
      document.head.querySelectorAll('link[data-plugin="no-styles"]').length,
    ).toBe(0);
  });
});
