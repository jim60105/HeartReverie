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

import { stubSessionStorage } from "@/__tests__/setup";

function mockFetchOnce(body: unknown, status = 200) {
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

describe("usePlugins readiness gate", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getPlugins() {
    const mod = await import("@/composables/usePlugins");
    return mod.usePlugins();
  }

  it("flips both pluginsReady and pluginsSettled on success", async () => {
    mockFetchOnce([]);
    const p = await getPlugins();
    expect(p.pluginsReady.value).toBe(false);
    expect(p.pluginsSettled.value).toBe(false);

    await p.initPlugins();

    expect(p.pluginsReady.value).toBe(true);
    expect(p.pluginsSettled.value).toBe(true);
  });

  it("flips only pluginsSettled on fetch failure (pluginsReady stays false)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network down"))),
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const p = await getPlugins();
    await p.initPlugins();

    expect(p.pluginsReady.value).toBe(false);
    expect(p.pluginsSettled.value).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("flips only pluginsSettled when /api/plugins returns a non-ok status", async () => {
    mockFetchOnce(null, 503);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const p = await getPlugins();
    await p.initPlugins();

    expect(p.pluginsReady.value).toBe(false);
    expect(p.pluginsSettled.value).toBe(true);
    warnSpy.mockRestore();
  });

  it("concurrent initPlugins() calls share one in-flight promise", async () => {
    let resolveFetch!: (v: unknown) => void;
    const fetchMock = vi.fn(() =>
      new Promise((resolve) => {
        resolveFetch = (body) =>
          resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(body),
            headers: new Headers(),
          });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const p = await getPlugins();
    const a = p.initPlugins();
    const b = p.initPlugins();
    const c = p.initPlugins();

    resolveFetch([]);
    await Promise.all([a, b, c]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(p.pluginsSettled.value).toBe(true);
  });

  it("does not double-register when initPlugins is called after pluginsSettled is true", async () => {
    mockFetchOnce([]);
    const p = await getPlugins();
    await p.initPlugins();
    const callsAfterFirst = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length;

    await p.initPlugins();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it("per-plugin import failure keeps pluginsReady false but flips pluginsSettled", async () => {
    // hasFrontendModule: true triggers a dynamic import to
    // /plugins/<name>/frontend.js which does not exist in the test
    // resolver — this is the canonical per-plugin import failure path.
    mockFetchOnce([
      { name: "broken-plugin", hasFrontendModule: true },
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const p = await getPlugins();
    await p.initPlugins();

    expect(p.pluginsSettled.value).toBe(true);
    expect(p.pluginsReady.value).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    // The per-plugin warning AND the outer init-failed warning should both fire.
    const calls = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((m) => m.includes("broken-plugin"))).toBe(true);
    warnSpy.mockRestore();
  });
});
