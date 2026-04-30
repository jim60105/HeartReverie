// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

// Tests for plugins/dialogue-colorize/frontend.js. Stubs the CSS Custom
// Highlight API since happy-dom doesn't implement it.

interface MockHighlight {
  add: (range: Range) => void;
  delete: (range: Range) => void;
  ranges: Set<Range>;
}

interface MockHighlightCtor {
  new (): MockHighlight;
}

interface CSSWithHighlights {
  highlights: Map<string, MockHighlight>;
}

function installHighlightStubs() {
  class StubHighlight implements MockHighlight {
    ranges = new Set<Range>();
    add(range: Range) {
      this.ranges.add(range);
    }
    delete(range: Range) {
      this.ranges.delete(range);
    }
  }
  const cssObj = ((globalThis as unknown as { CSS?: CSSWithHighlights }).CSS ??
    {}) as CSSWithHighlights;
  cssObj.highlights = new Map<string, MockHighlight>();
  (globalThis as unknown as { CSS: CSSWithHighlights }).CSS = cssObj;
  (globalThis as unknown as { Highlight: MockHighlightCtor }).Highlight =
    StubHighlight as unknown as MockHighlightCtor;
  return cssObj.highlights;
}

function uninstallHighlightStubs() {
  delete (globalThis as unknown as { Highlight?: MockHighlightCtor }).Highlight;
  const css = (globalThis as unknown as { CSS?: CSSWithHighlights }).CSS;
  if (css) delete (css as { highlights?: unknown }).highlights;
}

async function freshImport() {
  vi.resetModules();
  // @ts-expect-error — plain JS plugin module, no type declaration
  return await import("../../../../plugins/dialogue-colorize/frontend.js");
}

describe("dialogue-colorize frontend plugin", () => {
  beforeEach(() => {
    installHighlightStubs();
  });

  afterEach(() => {
    uninstallHighlightStubs();
  });

  it("registers handlers when Highlight API is available", async () => {
    const mod = await freshImport();
    const hooks = { register: vi.fn() };
    const logger = { info: vi.fn() };
    mod.register(hooks as never, { logger } as never);
    expect(hooks.register).toHaveBeenCalledTimes(2);
    const stages = hooks.register.mock.calls.map((c) => c[0]).sort();
    expect(stages).toEqual(["chapter:dom:dispose", "chapter:dom:ready"]);
    expect(hooks.register.mock.calls.every((c) => c[2] === 100)).toBe(true);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("no-op fallback when Highlight API is unavailable", async () => {
    uninstallHighlightStubs();
    const mod = await freshImport();
    const hooks = { register: vi.fn() };
    const logger = { info: vi.fn() };
    mod.register(hooks as never, { logger } as never);
    expect(hooks.register).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it("colorizes each supported pair into the right registry", async () => {
    const highlights = installHighlightStubs();
    const mod = await freshImport();
    const container = document.createElement("div");
    container.innerHTML =
      '<p>"a" \u201Cb\u201D \u00ABc\u00BB \u300Cd\u300D \uFF62e\uFF63 \u300Af\u300B</p>';
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);

    const expectedSuffixes = [
      "straight",
      "curly",
      "guillemet",
      "corner",
      "corner-half",
      "book",
    ];
    for (const suffix of expectedSuffixes) {
      const h = highlights.get(`dialogue-quote-${suffix}`);
      expect(h, `missing ${suffix}`).toBeDefined();
      expect(h!.ranges.size, `${suffix} should have 1 range`).toBe(1);
    }
  });

  it("does not colorize text inside <code> or <pre>", async () => {
    const highlights = installHighlightStubs();
    const mod = await freshImport();
    const container = document.createElement("div");
    container.innerHTML =
      '<p>外面\u300C對話\u300D</p><pre><code>"x"</code></pre>';
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);
    const corner = highlights.get("dialogue-quote-corner");
    expect(corner!.ranges.size).toBe(1);
    const straight = highlights.get("dialogue-quote-straight");
    expect(straight ? straight.ranges.size : 0).toBe(0);
  });

  it("does not colorize quotes inside attribute values", async () => {
    const highlights = installHighlightStubs();
    const mod = await freshImport();
    const container = document.createElement("div");
    const a = document.createElement("a");
    a.setAttribute("href", "?q=\u300Cfoo\u300D");
    a.setAttribute("title", "say \u300Cbar\u300D");
    a.textContent = "\u300Cbaz\u300D";
    container.appendChild(a);
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);
    const corner = highlights.get("dialogue-quote-corner");
    expect(corner!.ranges.size).toBe(1);
  });

  it("does not colorize an opener-only run with no closer", async () => {
    const highlights = installHighlightStubs();
    const mod = await freshImport();
    const container = document.createElement("div");
    container.innerHTML = "<p>\u300Cunfinished</p>";
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);
    const corner = highlights.get("dialogue-quote-corner");
    expect(corner ? corner.ranges.size : 0).toBe(0);
  });

  it("does not colorize a pair split across element boundaries", async () => {
    const highlights = installHighlightStubs();
    const mod = await freshImport();
    const container = document.createElement("div");
    container.innerHTML = "<p>\u300Cfoo<br>bar\u300D</p>";
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);
    const corner = highlights.get("dialogue-quote-corner");
    expect(corner ? corner.ranges.size : 0).toBe(0);
  });

  it("nested supported pair yields outer-only range (leftmost-longest)", async () => {
    const highlights = installHighlightStubs();
    const mod = await freshImport();
    const container = document.createElement("div");
    container.innerHTML = '<p>\u300Couter "inner" outer\u300D</p>';
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);
    const corner = highlights.get("dialogue-quote-corner");
    expect(corner!.ranges.size).toBe(1);
    const straight = highlights.get("dialogue-quote-straight");
    expect(straight ? straight.ranges.size : 0).toBe(0);
  });

  it("re-dispatch on same container clears prior ranges first", async () => {
    const highlights = installHighlightStubs();
    const mod = await freshImport();
    const container = document.createElement("div");
    container.innerHTML = "<p>\u300Cfoo\u300D \u300Cbar\u300D</p>";
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);
    const corner = highlights.get("dialogue-quote-corner");
    expect(corner!.ranges.size).toBe(2);
    container.innerHTML = "<p>\u300Cbaz\u300D</p>";
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);
    expect(corner!.ranges.size).toBe(1);
  });

  it("dispose handler releases container ranges (no leak)", async () => {
    const highlights = installHighlightStubs();
    const mod = await freshImport();
    const containerA = document.createElement("div");
    containerA.innerHTML = "<p>\u300Cfoo\u300D \u300Cbar\u300D</p>";
    const containerB = document.createElement("div");
    containerB.innerHTML = "<p>\u300Cbaz\u300D</p>";
    type TestApi = {
      colorize: (c: HTMLElement) => void;
      clearPriorRanges: (c: HTMLElement) => void;
    };
    const api = (mod as unknown as { __test__: TestApi }).__test__;
    api.colorize(containerA);
    api.colorize(containerB);
    const corner = highlights.get("dialogue-quote-corner");
    expect(corner!.ranges.size).toBe(3);
    api.clearPriorRanges(containerA);
    expect(corner!.ranges.size).toBe(1);
    api.clearPriorRanges(containerB);
    expect(corner!.ranges.size).toBe(0);
  });

  it("registers handlers for ready and dispose stages", async () => {
    installHighlightStubs();
    const mod = await freshImport();
    const calls: Array<[string, unknown, number]> = [];
    const hooks = {
      register: (stage: string, handler: unknown, priority: number) => {
        calls.push([stage, handler, priority]);
      },
    };
    mod.register(hooks as never, { logger: { info: vi.fn() } } as never);
    const stages = calls.map((c) => c[0]).sort();
    expect(stages).toEqual(["chapter:dom:dispose", "chapter:dom:ready"]);
    expect(calls.every((c) => c[2] === 100)).toBe(true);
  });
  it("does not mutate DOM (outerHTML byte-identical)", async () => {
    installHighlightStubs();
    const mod = await freshImport();
    const container = document.createElement("div");
    container.innerHTML =
      '<p>她說\u300C早安\u300D，他回應 "morning"。</p>';
    const before = container.outerHTML;
    (mod as unknown as { __test__: { colorize: (c: HTMLElement) => void } })
      .__test__.colorize(container);
    expect(container.outerHTML).toBe(before);
  });
});
