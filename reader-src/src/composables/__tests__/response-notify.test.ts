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
// @ts-expect-error — plugin is plain JS without types
import { register } from "../../../../plugins/response-notify/frontend.js";

function makeCtx(
  event: string,
  notify: (opts: NotifyOptions) => string,
): NotificationContext {
  return { event, data: {}, notify };
}

describe("response-notify plugin", () => {
  let visSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    visSpy?.mockRestore();
    visSpy = undefined;
  });

  it("dispatches a success notification on chat:done", () => {
    const d = new FrontendHookDispatcher();
    register(d);
    const notify = vi.fn((_opts: NotifyOptions) => "id");
    d.dispatch("notification", makeCtx("chat:done", notify));
    expect(notify).toHaveBeenCalledTimes(1);
    const call = notify.mock.calls[0]?.[0];
    expect(call?.level).toBe("success");
    expect(call?.title).toBeTruthy();
  });

  it("ignores non-chat:done events", () => {
    const d = new FrontendHookDispatcher();
    register(d);
    const notify = vi.fn((_opts: NotifyOptions) => "id");
    d.dispatch("notification", makeCtx("chat:error", notify));
    expect(notify).not.toHaveBeenCalled();
  });

  it("uses 'in-app' channel when page is visible", () => {
    visSpy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const d = new FrontendHookDispatcher();
    register(d);
    const notify = vi.fn((_opts: NotifyOptions) => "id");
    d.dispatch("notification", makeCtx("chat:done", notify));
    const call = notify.mock.calls[0]?.[0];
    expect(call?.channel).toBe("in-app");
  });

  it("uses 'auto' channel when page is hidden", () => {
    visSpy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const d = new FrontendHookDispatcher();
    register(d);
    const notify = vi.fn((_opts: NotifyOptions) => "id");
    d.dispatch("notification", makeCtx("chat:done", notify));
    const call = notify.mock.calls[0]?.[0];
    expect(call?.channel).toBe("auto");
  });
});
