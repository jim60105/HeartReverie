// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
import { listTemplates, lintTemplate, previewTemplate, writeTemplate, TemplateApiError, getVariables } from "@/lib/template-api";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({ getAuthHeaders: () => ({ "X-Passphrase": "pw" }) }),
}));

describe("template-api HTTP client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listTemplates appends series/story query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ entries: [], templates: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await listTemplates({ series: "s", story: "t" });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain("/api/templates?");
    expect(url).toContain("series=s");
    expect(url).toContain("story=t");
    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(new Headers(init.headers).get("X-Passphrase")).toBe("pw");
  });

  it("lintTemplate POSTs JSON with auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ diagnostics: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await lintTemplate({ templatePath: "system.md", source: "hi" });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/templates/lint");
    expect(init.method).toBe("POST");
    const h = new Headers(init.headers);
    expect(h.get("Content-Type")).toBe("application/json");
    expect(h.get("X-Passphrase")).toBe("pw");
    expect(JSON.parse(init.body as string)).toEqual({ templatePath: "system.md", source: "hi" });
  });

  it("previewTemplate forwards fixture object", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ kind: "markdown", content: "rendered" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await previewTemplate({ templatePath: "system.md", source: "x", fixture: { user_input: "u" } });
    expect(res.kind).toBe("markdown");
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).fixture).toEqual({ user_input: "u" });
  });

  it("writeTemplate uses PUT", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, path: "/x/system.md" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await writeTemplate({ templatePath: "system.md", source: "x" });
    expect((fetchMock.mock.calls[0]![1] as RequestInit).method).toBe("PUT");
  });

  it("throws TemplateApiError with status on non-2xx", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ detail: "plugin path forbidden" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    let caught: unknown = null;
    try {
      await writeTemplate({ templatePath: "plugin:x:y.md", source: "x" });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(TemplateApiError);
    expect((caught as TemplateApiError).status).toBe(403);
    expect((caught as TemplateApiError).detail).toBe("plugin path forbidden");
  });

  it("getVariables returns body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ variables: [{ name: "x", source: "core" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const res = await getVariables();
    expect(res.variables[0]!.name).toBe("x");
  });
});
