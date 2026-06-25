// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Tests for plugins/polish/frontend.js — the action-button:click handler that
// forwards the live chat-input directive as the `polish_instruction` extra
// variable (empty → omitted; non-empty → passed verbatim, trim-only).

// Make this file a module so its top-level declarations are scoped to it and
// do not collide with identically-named helpers in sibling plugin tests.
export {};

interface HookRegister {
  (
    stage: string,
    handler: (ctx: unknown) => unknown,
    priority?: number,
    originPluginName?: string,
  ): void;
}

interface MockHooks {
  register: HookRegister;
  handlers: Map<string, Array<(ctx: unknown) => unknown>>;
}

function createMockHooks(): MockHooks {
  const handlers = new Map<string, Array<(ctx: unknown) => unknown>>();
  return {
    handlers,
    register: ((stage, handler) => {
      if (!handlers.has(stage)) handlers.set(stage, []);
      handlers.get(stage)!.push(handler);
    }) as HookRegister,
  };
}

async function freshImportPolish() {
  vi.resetModules();
  // @ts-expect-error — plain JS plugin module, no type declaration
  return await import("../../../../plugins/polish/frontend.js");
}

interface RunOpts {
  replace?: boolean;
  extraVariables?: Record<string, unknown>;
}

function makeCtx(chatInputText: string) {
  const runPluginPrompt = vi.fn(async (_file: string, _opts: RunOpts) => ({
    content: "",
    usage: null,
    chapterUpdated: false,
    chapterReplaced: true,
    chapterInserted: false,
    insertedCount: 0,
    appendedTag: null,
  }));
  const reload = vi.fn(async () => {});
  let currentText = chatInputText;
  const ctx = {
    pluginName: "polish",
    buttonId: "polish",
    series: "s",
    name: "t",
    storyDir: "s/t",
    lastChapterIndex: 0,
    getChatInputText: () => currentText,
    runPluginPrompt,
    reload,
    notify: vi.fn(),
  };
  return { ctx, runPluginPrompt, reload, setText: (v: string) => (currentText = v) };
}

async function getHandler() {
  const mod = await freshImportPolish();
  const hooks = createMockHooks();
  mod.register(hooks);
  const handler = hooks.handlers.get("action-button:click")?.[0];
  if (!handler) throw new Error("polish did not register action-button:click");
  return handler;
}

describe("polish plugin frontend handler — directive forwarding", () => {
  it("omits polish_instruction when the chat input is empty", async () => {
    const handler = await getHandler();
    const { ctx, runPluginPrompt } = makeCtx("");
    await handler(ctx);
    expect(runPluginPrompt).toHaveBeenCalledTimes(1);
    const [file, opts] = runPluginPrompt.mock.calls[0]!;
    expect(file).toBe("polish-instruction.md");
    expect(opts).toEqual({ replace: true });
    expect(opts).not.toHaveProperty("extraVariables");
  });

  it("omits polish_instruction when the chat input is whitespace-only", async () => {
    const handler = await getHandler();
    const { ctx, runPluginPrompt } = makeCtx("   \n\t  ");
    await handler(ctx);
    const [, opts] = runPluginPrompt.mock.calls[0]!;
    expect(opts).toEqual({ replace: true });
  });

  it("passes the trimmed directive verbatim as polish_instruction when non-empty", async () => {
    const handler = await getHandler();
    const { ctx, runPluginPrompt } = makeCtx("  讓對白更尖銳  ");
    await handler(ctx);
    const [, opts] = runPluginPrompt.mock.calls[0]!;
    expect(opts).toEqual({
      replace: true,
      extraVariables: { polish_instruction: "讓對白更尖銳" },
    });
  });

  it("passes XML-like markup through verbatim (no escaping, no truncation)", async () => {
    const handler = await getHandler();
    const directive = "用 <emphasis> 強調雨聲，甚至 </draft> 也照樣傳遞 & 不轉義";
    const { ctx, runPluginPrompt } = makeCtx(`  ${directive}  `);
    await handler(ctx);
    const [, opts] = runPluginPrompt.mock.calls[0]!;
    expect(opts.extraVariables).toEqual({ polish_instruction: directive });
    // Ensure no HTML entity escaping happened.
    expect(opts.extraVariables!.polish_instruction).not.toContain("&lt;");
    expect(opts.extraVariables!.polish_instruction).not.toContain("&amp;");
  });

  it("does not read or mutate the chat input beyond a read, and reloads on replace", async () => {
    const handler = await getHandler();
    const { ctx, reload, setText } = makeCtx("保留我");
    await handler(ctx);
    // Handler must not clear the textarea (it has no setter; assert source unchanged).
    expect(ctx.getChatInputText()).toBe("保留我");
    setText("保留我");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks for a different button or plugin", async () => {
    const handler = await getHandler();
    const { ctx, runPluginPrompt } = makeCtx("x");
    await handler({ ...ctx, buttonId: "other" });
    await handler({ ...ctx, pluginName: "other" });
    expect(runPluginPrompt).not.toHaveBeenCalled();
  });
});
