// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { FrontendHookDispatcher } from "@/lib/plugin-hooks";
import type { ActionButtonClickContext } from "@/types";
import { __resetNotificationStateForTests, useNotification } from "@/composables/useNotification";

function makeClickCtx(
  overrides: Partial<ActionButtonClickContext> = {},
): ActionButtonClickContext {
  return {
    buttonId: "btn-1",
    pluginName: "plugin-a",
    series: "s",
    name: "n",
    storyDir: "s/n",
    lastChapterIndex: 0,
    runPluginPrompt: () =>
      Promise.resolve({
        content: "",
        usage: null,
        chapterUpdated: false,
        appendedTag: null,
      }),
    notify: () => {},
    reload: () => Promise.resolve(),
    ...overrides,
  };
}

describe("FrontendHookDispatcher — action-button:click", () => {
  beforeEach(() => {
    __resetNotificationStateForTests();
  });

  it("registers the new stage without warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const d = new FrontendHookDispatcher();
    d.register("action-button:click", () => {}, 100, "plugin-a");
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("dispatch returns a Promise for action-button:click", () => {
    const d = new FrontendHookDispatcher();
    const result = d.dispatch("action-button:click", makeClickCtx());
    expect(result).toBeInstanceOf(Promise);
  });

  it("awaits handlers in priority order", async () => {
    const d = new FrontendHookDispatcher();
    const order: string[] = [];
    d.register(
      "action-button:click",
      async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push("low");
      },
      10,
      "plugin-a",
    );
    d.register(
      "action-button:click",
      async () => {
        order.push("high");
      },
      200,
      "plugin-a",
    );
    d.register(
      "action-button:click",
      async () => {
        order.push("mid");
      },
      100,
      "plugin-a",
    );
    await d.dispatch("action-button:click", makeClickCtx());
    expect(order).toEqual(["low", "mid", "high"]);
  });

  it("origin filtering: only invokes handlers whose origin matches context.pluginName", async () => {
    const d = new FrontendHookDispatcher();
    const seen: string[] = [];
    d.register(
      "action-button:click",
      () => {
        seen.push("a");
      },
      100,
      "plugin-a",
    );
    d.register(
      "action-button:click",
      () => {
        seen.push("b");
      },
      100,
      "plugin-b",
    );
    await d.dispatch(
      "action-button:click",
      makeClickCtx({ pluginName: "plugin-a" }),
    );
    expect(seen).toEqual(["a"]);
  });

  it("origin filtering does not affect other stages", () => {
    const d = new FrontendHookDispatcher();
    let count = 0;
    d.register(
      "frontend-render",
      () => {
        count++;
      },
      100,
      "plugin-a",
    );
    d.register(
      "frontend-render",
      () => {
        count++;
      },
      100,
      "plugin-b",
    );
    d.dispatch("frontend-render", {
      text: "",
      placeholderMap: new Map(),
      options: {},
    });
    expect(count).toBe(2);
  });

  it("handler rejection still resolves dispatch and emits default error toast", async () => {
    const d = new FrontendHookDispatcher();
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    d.register(
      "action-button:click",
      () => {
        throw new Error("boom");
      },
      100,
      "plugin-a",
    );
    const ctx = makeClickCtx({ pluginName: "plugin-a" });
    await expect(d.dispatch("action-button:click", ctx)).resolves.toBe(ctx);
    const { toasts } = useNotification();
    expect(toasts.value.length).toBeGreaterThan(0);
    expect(toasts.value.some((t) => t.level === "error")).toBe(true);
    expect(toasts.value.some((t) => (t.body ?? "").includes("boom"))).toBe(true);
    errSpy.mockRestore();
  });

  it("origin tracking: register accepts a fourth originPluginName argument", async () => {
    const d = new FrontendHookDispatcher();
    let invokedFor: string | null = null;
    d.register(
      "action-button:click",
      (ctx) => {
        invokedFor = ctx.pluginName;
      },
      100,
      "plugin-x",
    );
    await d.dispatch(
      "action-button:click",
      makeClickCtx({ pluginName: "plugin-x" }),
    );
    expect(invokedFor).toBe("plugin-x");
  });
});
