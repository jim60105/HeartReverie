// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch, apiFetchJson } from "@/lib/api";

const authHeaders: Record<string, string> = {};

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ ...authHeaders }),
  }),
}));

describe("apiFetch", () => {
  beforeEach(() => {
    Object.keys(authHeaders).forEach((k) => delete authHeaders[k]);
    authHeaders["X-Passphrase"] = "secret";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("injects auth headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await apiFetch("/api/test");

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({ "X-Passphrase": "secret" });
  });

  it("merges caller headers over auth headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await apiFetch("/api/test", {
      headers: { "Content-Type": "application/json", "X-Passphrase": "override" },
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Passphrase": "override",
    });
  });

  it("throws with body.detail on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "nope" }), { status: 400 }),
    );

    await expect(apiFetch("/api/test")).rejects.toThrow("nope");
  });

  it("uses errorMessage fallback when body has no detail", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 500 }),
    );

    await expect(apiFetch("/api/test", { errorMessage: "boom" })).rejects.toThrow("boom");
  });

  it("returns response on error when throwOnError=false", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 404 }),
    );

    const res = await apiFetch("/api/test", { throwOnError: false });
    expect(res.status).toBe(404);
  });
});

describe("apiFetchJson", () => {
  beforeEach(() => {
    Object.keys(authHeaders).forEach((k) => delete authHeaders[k]);
  });

  it("parses JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ ok: true, n: 42 }), { status: 200 }),
    );

    const body = await apiFetchJson<{ ok: boolean; n: number }>("/api/test");
    expect(body).toEqual({ ok: true, n: 42 });
  });
});
