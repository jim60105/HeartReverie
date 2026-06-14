// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch, apiFetchJson } from "@/lib/api";

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
    const headers = init.headers as Headers;
    expect(headers.get("X-Passphrase")).toBe("secret");
  });

  it("merges caller headers over auth headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await apiFetch("/api/test", {
      headers: { "Content-Type": "application/json", "X-Passphrase": "override" },
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Passphrase")).toBe("override");
  });

  it("accepts Headers instance as caller headers", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await apiFetch("/api/test", {
      headers: new Headers({ "Content-Type": "application/json" }),
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    const headers = init.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("X-Passphrase")).toBe("secret");
  });

  it("falls back to a generic message when statusText is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 500, statusText: "" }),
    );

    await expect(apiFetch("/api/blank")).rejects.toThrow("Request failed: /api/blank");
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

  it("passes method, body, and signal through to fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const controller = new AbortController();

    await apiFetch("/api/test", {
      method: "POST",
      body: JSON.stringify({ x: 1 }),
      signal: controller.signal,
    });

    const init = fetchSpy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ x: 1 }));
    expect(init.signal).toBe(controller.signal);
  });

  it("propagates AbortError when the signal aborts", async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );

    const promise = apiFetch("/api/test", { signal: controller.signal });
    controller.abort();

    await expect(promise).rejects.toThrow("aborted");
  });

  it("prefers detail over errorMessage over statusText", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "from-body" }), {
        status: 400,
        statusText: "Bad Request",
      }),
    );

    await expect(
      apiFetch("/api/test", { errorMessage: "from-caller" }),
    ).rejects.toThrow("from-body");
  });

  it("falls back to statusText when neither detail nor errorMessage is provided", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 503, statusText: "Service Unavailable" }),
    );

    await expect(apiFetch("/api/test")).rejects.toThrow("Service Unavailable");
  });

  it("handles non-JSON error body without crashing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>oops</html>", {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "Content-Type": "text/html" },
      }),
    );

    await expect(
      apiFetch("/api/test", { errorMessage: "boom" }),
    ).rejects.toThrow("boom");
  });

  it("throws a structured ApiError carrying status/type/message on a problem body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "chapter:not-found",
          title: "Not Found",
          status: 404,
          detail: "Chapter not found",
        }),
        { status: 404, statusText: "Not Found" },
      ),
    );

    let caught: unknown;
    try {
      await apiFetch("/api/test");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(404);
    expect(apiErr.type).toBe("chapter:not-found");
    expect(apiErr.title).toBe("Not Found");
    // message is detail-first and byte-identical to the prior contract.
    expect(apiErr.message).toBe("Chapter not found");
  });

  it("throws an ApiError with the fallback message and undefined type on a non-JSON body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html>oops</html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "Content-Type": "text/html" },
      }),
    );

    let caught: unknown;
    try {
      await apiFetch("/api/test");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ApiError);
    const apiErr = caught as ApiError;
    expect(apiErr.status).toBe(502);
    expect(apiErr.type).toBeUndefined();
    expect(apiErr.message).toBe("Bad Gateway");
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

  it("throws on non-2xx without attempting to parse a success body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "not found" }), { status: 404 }),
    );

    await expect(
      apiFetchJson<{ ok: boolean }>("/api/test"),
    ).rejects.toThrow("not found");
  });
});
