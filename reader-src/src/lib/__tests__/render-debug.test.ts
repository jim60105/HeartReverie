// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { renderDebug } from "@/lib/render-debug";

describe("renderDebug", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    try {
      localStorage.removeItem("RENDER_DEBUG");
    } catch {
      // ignore
    }
  });

  afterEach(() => {
    debugSpy.mockRestore();
    try {
      localStorage.removeItem("RENDER_DEBUG");
    } catch {
      // ignore
    }
  });

  it("is a no-op when neither env flag nor localStorage flag is set", () => {
    renderDebug("event-a");
    renderDebug("event-b", { extra: 1 });
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("emits console.debug without payload when localStorage flag is 'true'", () => {
    localStorage.setItem("RENDER_DEBUG", "true");
    renderDebug("evt");
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith("[render-debug] evt");
  });

  it("emits console.debug with payload when enabled and payload is provided", () => {
    localStorage.setItem("RENDER_DEBUG", "true");
    const payload = { chapterIndex: 3 };
    renderDebug("ready", payload);
    expect(debugSpy).toHaveBeenCalledTimes(1);
    expect(debugSpy).toHaveBeenCalledWith("[render-debug] ready", payload);
  });

  it("treats any non-'true' localStorage value as disabled", () => {
    localStorage.setItem("RENDER_DEBUG", "1");
    renderDebug("evt");
    localStorage.setItem("RENDER_DEBUG", "yes");
    renderDebug("evt2");
    expect(debugSpy).not.toHaveBeenCalled();
  });

  it("swallows errors thrown by localStorage access", () => {
    const original = Object.getOwnPropertyDescriptor(
      globalThis,
      "localStorage",
    );
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("blocked");
      },
    });
    try {
      expect(() => renderDebug("evt")).not.toThrow();
      expect(debugSpy).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
    }
  });
});
