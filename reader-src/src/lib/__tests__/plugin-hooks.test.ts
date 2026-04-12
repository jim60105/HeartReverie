import { FrontendHookDispatcher } from "@/lib/plugin-hooks";
import type { FrontendRenderContext, RenderOptions } from "@/types";

function makeContext(
  overrides: Partial<FrontendRenderContext> = {},
): FrontendRenderContext {
  return {
    text: "",
    placeholderMap: new Map(),
    options: {} as RenderOptions,
    ...overrides,
  };
}

describe("FrontendHookDispatcher", () => {
  it("registers and dispatches a handler", () => {
    const d = new FrontendHookDispatcher();
    let called = false;
    d.register("frontend-render", () => {
      called = true;
    });
    d.dispatch("frontend-render", makeContext());
    expect(called).toBe(true);
  });

  it("passes context to handler", () => {
    const d = new FrontendHookDispatcher();
    d.register("frontend-render", (ctx) => {
      ctx.text = "mutated";
    });
    const ctx = makeContext();
    d.dispatch("frontend-render", ctx);
    expect(ctx.text).toBe("mutated");
  });

  it("returns context from dispatch", () => {
    const d = new FrontendHookDispatcher();
    const ctx = makeContext({ text: "original" });
    const result = d.dispatch("frontend-render", ctx);
    expect(result).toBe(ctx);
  });

  it("runs handlers in priority order (lower first)", () => {
    const d = new FrontendHookDispatcher();
    const order: string[] = [];
    d.register("frontend-render", () => order.push("low"), 10);
    d.register("frontend-render", () => order.push("high"), 200);
    d.register("frontend-render", () => order.push("mid"), 100);
    d.dispatch("frontend-render", makeContext());
    expect(order).toEqual(["low", "mid", "high"]);
  });

  it("uses default priority of 100", () => {
    const d = new FrontendHookDispatcher();
    const order: string[] = [];
    d.register("frontend-render", () => order.push("first-default"));
    d.register("frontend-render", () => order.push("early"), 50);
    d.dispatch("frontend-render", makeContext());
    expect(order).toEqual(["early", "first-default"]);
  });

  it("isolates errors — other handlers still run", () => {
    const d = new FrontendHookDispatcher();
    const order: string[] = [];
    d.register("frontend-render", () => order.push("before"), 1);
    d.register(
      "frontend-render",
      () => {
        throw new Error("boom");
      },
      2,
    );
    d.register("frontend-render", () => order.push("after"), 3);
    d.dispatch("frontend-render", makeContext());
    expect(order).toEqual(["before", "after"]);
  });

  it("returns context unchanged for unregistered stage", () => {
    const d = new FrontendHookDispatcher();
    const ctx = makeContext({ text: "value" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = d.dispatch("frontend-render" as any, ctx);
    expect(result).toBe(ctx);
    expect(result.text).toBe("value");
  });

  it("supports multiple handlers on the same stage", () => {
    const d = new FrontendHookDispatcher();
    let count = 0;
    d.register("frontend-render", () => count++);
    d.register("frontend-render", () => count++);
    d.register("frontend-render", () => count++);
    d.dispatch("frontend-render", makeContext());
    expect(count).toBe(3);
  });

  it("rejects invalid stage names", () => {
    const d = new FrontendHookDispatcher();
    let called = false;
    // @ts-expect-error — testing invalid stage
    d.register("frontend-strip", () => {
      called = true;
    });
    // @ts-expect-error — testing invalid stage
    d.dispatch("frontend-strip", {});
    expect(called).toBe(false);
  });
});
