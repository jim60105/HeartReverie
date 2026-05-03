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

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "test" }),
  }),
}));

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

describe("useBackground — /api/config integration", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function loadFresh() {
    const mod = await import("@/composables/useBackground");
    return mod.useBackground();
  }

  it("uses fetched relative path from /api/config", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ backgroundImage: "/custom/relative.webp" }),
        )
      ),
    );
    const bg = await loadFresh();
    await bg.applyBackground();
    expect(bg.backgroundUrl.value).toBe("/custom/relative.webp");
    expect(document.body.style.backgroundImage).toContain(
      "/custom/relative.webp",
    );
  });

  it("uses fetched absolute URL from /api/config", async () => {
    const url = "https://cdn.example.com/bg.png";
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({ backgroundImage: url }))),
    );
    const bg = await loadFresh();
    await bg.applyBackground();
    expect(bg.backgroundUrl.value).toBe(url);
    expect(document.body.style.backgroundImage).toContain(url);
  });

  it("falls back to default when fetch rejects (network error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("network down"))),
    );
    const bg = await loadFresh();
    await bg.applyBackground();
    expect(bg.backgroundUrl.value).toBe("");
    expect(document.body.style.backgroundImage).toContain("heart.webp");
  });

  it("falls back to default when /api/config returns non-OK status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({}, false, 500))),
    );
    const bg = await loadFresh();
    await bg.applyBackground();
    expect(bg.backgroundUrl.value).toBe("");
    expect(document.body.style.backgroundImage).toContain("heart.webp");
  });

  it("falls back to default when response body has no backgroundImage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse({}))),
    );
    const bg = await loadFresh();
    await bg.applyBackground();
    expect(bg.backgroundUrl.value).toBe("");
    expect(document.body.style.backgroundImage).toContain("heart.webp");
  });

  it("prefers fetched value over the built-in default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(jsonResponse({ backgroundImage: "/api-served.png" }))
      ),
    );
    const bg = await loadFresh();
    await bg.applyBackground();
    expect(document.body.style.backgroundImage).toContain("/api-served.png");
    expect(document.body.style.backgroundImage).not.toContain("heart.webp");
  });
});

// This block intentionally does NOT vi.resetModules() between calls so the
// same module-level `backgroundUrl` ref persists across two applyBackground()
// invocations on a single composable instance. The point is to lock in the
// observed graceful-degradation behaviour required by
// `openspec/specs/frontend-background/spec.md` when a successful fetch is
// followed by a failure.
describe("useBackground — sequential applyBackground on the same instance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retains the previously-applied custom URL when a later fetch fails", async () => {
    // Fresh module so this scenario starts from a known-empty backgroundUrl.
    vi.resetModules();
    const customUrl = "/persisted/custom.webp";
    const fetchMock = vi
      .fn()
      // First call: successful fetch returning a custom backgroundImage.
      .mockImplementationOnce(() =>
        Promise.resolve(jsonResponse({ backgroundImage: customUrl }))
      )
      // Second call: rejected (network error) — the second-call branch.
      .mockImplementationOnce(() =>
        Promise.reject(new TypeError("network down"))
      );
    vi.stubGlobal("fetch", fetchMock);

    const mod = await import("@/composables/useBackground");
    const bg = mod.useBackground();

    // First invocation: custom URL applied, no fallback needed.
    await bg.applyBackground();
    expect(bg.backgroundUrl.value).toBe(customUrl);
    expect(document.body.style.backgroundImage).toContain(customUrl);

    // Second invocation on the SAME composable instance with a failing fetch.
    await bg.applyBackground();

    // Observed (and intentional, per current source) behaviour: the
    // module-level `backgroundUrl` ref is not cleared on subsequent failure,
    // so the previously-applied custom URL persists. Graceful degradation
    // here means "do not regress to the default mid-session" — once a
    // custom URL is known, transient fetch failures keep using it. If the
    // production source is ever changed to reset on failure, this assertion
    // will catch the regression.
    expect(bg.backgroundUrl.value).toBe(customUrl);
    expect(document.body.style.backgroundImage).toContain(customUrl);
    expect(document.body.style.backgroundImage).not.toContain("heart.webp");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
