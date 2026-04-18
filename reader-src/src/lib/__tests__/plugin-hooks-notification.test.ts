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
import type { NotificationContext, NotifyOptions } from "@/types";

function makeNotifyStub(): (opts: NotifyOptions) => string {
  return vi.fn(() => "stub-id");
}

function makeCtx(
  overrides: Partial<NotificationContext> = {},
): NotificationContext {
  return {
    event: "chat:done",
    data: {},
    notify: makeNotifyStub(),
    ...overrides,
  };
}

describe("FrontendHookDispatcher — notification stage", () => {
  it("notification stage can be registered and dispatched", () => {
    const d = new FrontendHookDispatcher();
    let called = false;
    d.register("notification", () => {
      called = true;
    });
    d.dispatch("notification", makeCtx());
    expect(called).toBe(true);
  });

  it("passes the correct context shape to handlers", () => {
    const d = new FrontendHookDispatcher();
    let received: NotificationContext | null = null;
    d.register("notification", (ctx) => {
      received = ctx;
    });
    const ctx = makeCtx({ event: "chat:error", data: { id: "abc" } });
    d.dispatch("notification", ctx);
    expect(received).not.toBeNull();
    expect(received!.event).toBe("chat:error");
    expect(received!.data).toEqual({ id: "abc" });
    expect(typeof received!.notify).toBe("function");
  });

  it("multiple handlers can call notify independently", () => {
    const d = new FrontendHookDispatcher();
    const notify = vi.fn(() => "id");
    d.register("notification", (ctx) => {
      ctx.notify({ title: "A" });
    });
    d.register("notification", (ctx) => {
      ctx.notify({ title: "B", level: "error" });
    });
    d.dispatch("notification", { event: "chat:done", data: {}, notify });
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, { title: "A" });
    expect(notify).toHaveBeenNthCalledWith(2, { title: "B", level: "error" });
  });

  it("frontend-render and notification stages are independent", () => {
    const d = new FrontendHookDispatcher();
    let renderCalls = 0;
    let notifyCalls = 0;
    d.register("frontend-render", () => { renderCalls++; });
    d.register("notification", () => { notifyCalls++; });
    d.dispatch("notification", makeCtx());
    expect(renderCalls).toBe(0);
    expect(notifyCalls).toBe(1);
  });

  it("error in one notification handler does not prevent others", () => {
    const d = new FrontendHookDispatcher();
    const order: string[] = [];
    d.register("notification", () => order.push("a"), 1);
    d.register("notification", () => { throw new Error("boom"); }, 2);
    d.register("notification", () => order.push("c"), 3);
    d.dispatch("notification", makeCtx());
    expect(order).toEqual(["a", "c"]);
  });
});
