import { FrontendHookDispatcher } from "@/lib/plugin-hooks";
import type {
  ChatSendBeforeContext,
  ChatSendBeforeHandler,
  ChapterChangeContext,
  ChapterDomReadyContext,
  ChapterDomDisposeContext,
  StorySwitchContext,
  ChapterRenderAfterContext,
  RenderToken,
} from "@/types";

function makeChatCtx(
  overrides: Partial<ChatSendBeforeContext> = {},
): ChatSendBeforeContext {
  return {
    message: "hello",
    series: "s",
    story: "st",
    mode: "send",
    ...overrides,
  };
}

describe("FrontendHookDispatcher — new stages", () => {
  it("registers all four new stages without warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = new FrontendHookDispatcher();
    d.register("chat:send:before", () => {});
    d.register("chapter:render:after", () => {});
    d.register("chapter:dom:ready", () => {});
    d.register("chapter:dom:dispose", () => {});
    d.register("story:switch", () => {});
    d.register("chapter:change", () => {});
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("chat:send:before — string return replaces context.message", () => {
    const d = new FrontendHookDispatcher();
    d.register("chat:send:before", () => "replaced");
    const ctx = makeChatCtx({ message: "original" });
    d.dispatch("chat:send:before", ctx);
    expect(ctx.message).toBe("replaced");
  });

  it("chat:send:before — non-string return is ignored", () => {
    const d = new FrontendHookDispatcher();
    d.register("chat:send:before", () => undefined);
    d.register("chat:send:before", (() => 42) as unknown as ChatSendBeforeHandler);
    d.register("chat:send:before", (() => ({ msg: "no" })) as unknown as ChatSendBeforeHandler);
    const ctx = makeChatCtx({ message: "keep" });
    d.dispatch("chat:send:before", ctx);
    expect(ctx.message).toBe("keep");
  });

  it("chat:send:before — multiple handlers chain transformations in priority order", () => {
    const d = new FrontendHookDispatcher();
    d.register("chat:send:before", () => "A", 10);
    d.register("chat:send:before", (ctx) => `${ctx.message} → B`, 20);
    const ctx = makeChatCtx({ message: "orig" });
    d.dispatch("chat:send:before", ctx);
    expect(ctx.message).toBe("A → B");
  });

  it("chat:send:before — handler throw is isolated, subsequent handler sees mutated message", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const d = new FrontendHookDispatcher();
    d.register("chat:send:before", (ctx) => {
      ctx.message = "partial";
      throw new Error("boom");
    }, 1);
    let seen = "";
    d.register("chat:send:before", (ctx) => {
      seen = ctx.message;
    }, 2);
    const ctx = makeChatCtx({ message: "orig" });
    d.dispatch("chat:send:before", ctx);
    expect(seen).toBe("partial");
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it("chat:send:before — direct mutation takes effect when no string is returned", () => {
    const d = new FrontendHookDispatcher();
    d.register("chat:send:before", (ctx) => {
      ctx.message = "mutated";
    });
    const ctx = makeChatCtx({ message: "orig" });
    d.dispatch("chat:send:before", ctx);
    expect(ctx.message).toBe("mutated");
  });

  it("chat:send:before — returned string takes precedence over direct mutation", () => {
    const d = new FrontendHookDispatcher();
    d.register("chat:send:before", (ctx) => {
      ctx.message = "mutated";
      return "returned";
    });
    const ctx = makeChatCtx({ message: "orig" });
    d.dispatch("chat:send:before", ctx);
    expect(ctx.message).toBe("returned");
  });

  it("chapter:render:after — handler receives tokens by reference and mutations stick", () => {
    const d = new FrontendHookDispatcher();
    d.register("chapter:render:after", (ctx) => {
      ctx.tokens.push({ type: "html", content: "<div>added</div>" });
    });
    const tokens: RenderToken[] = [{ type: "html", content: "<p>orig</p>" }];
    const ctx: ChapterRenderAfterContext = {
      tokens,
      rawMarkdown: "orig",
      options: {},
    };
    d.dispatch("chapter:render:after", ctx);
    expect(tokens.length).toBe(2);
    expect(tokens[1]!.type).toBe("html");
  });

  it("story:switch — informational; return value is ignored", () => {
    const d = new FrontendHookDispatcher();
    let received: StorySwitchContext | null = null;
    d.register("story:switch", (ctx) => {
      received = ctx;
    });
    const ctx: StorySwitchContext = {
      previousSeries: "a",
      previousStory: "b",
      series: "c",
      story: "d",
      mode: "backend",
    };
    d.dispatch("story:switch", ctx);
    expect(received).toBe(ctx);
  });

  it("chapter:change — informational", () => {
    const d = new FrontendHookDispatcher();
    const calls: ChapterChangeContext[] = [];
    d.register("chapter:change", (ctx) => {
      calls.push(ctx);
    });
    const ctx: ChapterChangeContext = {
      previousIndex: null,
      index: 0,
      chapter: 1,
      series: "s",
      story: "st",
      mode: "backend",
    };
    d.dispatch("chapter:change", ctx);
    expect(calls.length).toBe(1);
    expect(calls[0]!.previousIndex).toBeNull();
  });

  it("chapter:dom:ready — handler receives container and tokens", () => {
    const d = new FrontendHookDispatcher();
    const seen: ChapterDomReadyContext[] = [];
    d.register("chapter:dom:ready", (ctx) => {
      seen.push(ctx);
    });
    const container = document.createElement("div");
    const tokens: RenderToken[] = [{ type: "html", content: "<p>x</p>" }];
    const ctx: ChapterDomReadyContext = {
      container,
      tokens,
      rawMarkdown: "x",
      chapterIndex: 0,
    };
    d.dispatch("chapter:dom:ready", ctx);
    expect(seen.length).toBe(1);
    expect(seen[0]!.container).toBe(container);
    expect(seen[0]!.tokens).toBe(tokens);
    expect(seen[0]!.chapterIndex).toBe(0);
  });

  it("chapter:dom:dispose — handler receives container and chapterIndex", () => {
    const d = new FrontendHookDispatcher();
    const seen: ChapterDomDisposeContext[] = [];
    d.register("chapter:dom:dispose", (ctx) => {
      seen.push(ctx);
    });
    const container = document.createElement("div");
    const ctx: ChapterDomDisposeContext = { container, chapterIndex: 4 };
    d.dispatch("chapter:dom:dispose", ctx);
    expect(seen.length).toBe(1);
    expect(seen[0]!.container).toBe(container);
    expect(seen[0]!.chapterIndex).toBe(4);
  });
});
