import { stubSessionStorage } from "@/__tests__/setup";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "test" }),
  }),
}));

function mockFetch(body: unknown = {}, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(JSON.stringify(body)),
        headers: new Headers(),
      }),
    ),
  );
}

describe("useLoreApi", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getUseLoreApi() {
    const mod = await import("@/composables/useLoreApi");
    return mod.useLoreApi();
  }

  // ── fetchPassages ──

  it("fetchPassages calls correct URL for global scope", async () => {
    const passages = [{ filename: "a.md", scope: "global" }];
    mockFetch(passages);
    const api = await getUseLoreApi();
    await api.fetchPassages("global");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = new URL(call[0]! as string);
    expect(url.pathname).toBe("/api/lore/global");
  });

  it("fetchPassages calls correct URL for series scope", async () => {
    mockFetch([]);
    const api = await getUseLoreApi();
    await api.fetchPassages("series", "my-series");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = new URL(call[0]! as string);
    expect(url.pathname).toBe("/api/lore/series/my-series");
  });

  it("fetchPassages calls correct URL for story scope", async () => {
    mockFetch([]);
    const api = await getUseLoreApi();
    await api.fetchPassages("story", "s1", "st1");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = new URL(call[0]! as string);
    expect(url.pathname).toBe("/api/lore/story/s1/st1");
  });

  it("fetchPassages adds tag query param when provided", async () => {
    mockFetch([]);
    const api = await getUseLoreApi();
    await api.fetchPassages("global", undefined, undefined, "mytag");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const url = new URL(call[0]! as string);
    expect(url.searchParams.get("tag")).toBe("mytag");
  });

  it("fetchPassages sets loading and error state correctly", async () => {
    const data = [{ filename: "x.md" }];
    mockFetch(data);
    const api = await getUseLoreApi();

    expect(api.loading.value).toBe(false);
    expect(api.error.value).toBeNull();

    await api.fetchPassages("global");

    expect(api.loading.value).toBe(false);
    expect(api.error.value).toBeNull();
    expect(api.passages.value).toEqual(data);
  });

  it("fetchPassages sets error on failure", async () => {
    mockFetch({ detail: "Not found" }, 404);
    const api = await getUseLoreApi();
    await api.fetchPassages("global");

    expect(api.error.value).toBe("Not found");
    expect(api.loading.value).toBe(false);
  });

  // ── fetchTags ──

  it("fetchTags calls GET /api/lore/tags", async () => {
    const tags = ["角色", "世界觀"];
    mockFetch(tags);
    const api = await getUseLoreApi();
    await api.fetchTags();

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]!).toBe("/api/lore/tags");
    expect(api.allTags.value).toEqual(tags);
  });

  // ── readPassage ──

  it("readPassage returns passage data", async () => {
    const data = {
      frontmatter: { tags: ["t"], priority: 1, enabled: true },
      content: "hello",
    };
    mockFetch(data);
    const api = await getUseLoreApi();
    const result = await api.readPassage("global", "test.md");

    expect(result).toEqual(data);
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]!).toBe("/api/lore/global/test.md");
  });

  it("readPassage throws on error", async () => {
    mockFetch({ detail: "Not found" }, 404);
    const api = await getUseLoreApi();
    await expect(api.readPassage("global", "missing.md")).rejects.toThrow(
      "Not found",
    );
  });

  // ── writePassage ──

  it("writePassage sends PUT with correct body", async () => {
    mockFetch({});
    const api = await getUseLoreApi();
    const fm = { tags: ["a"], priority: 5, enabled: true };
    await api.writePassage("global", "doc.md", fm, "content text");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]!).toBe("/api/lore/global/doc.md");
    expect(call[1]!.method).toBe("PUT");
    expect(JSON.parse(call[1]!.body)).toEqual({
      frontmatter: fm,
      content: "content text",
    });
    expect(call[1].headers["Content-Type"]).toBe("application/json");
  });

  // ── deletePassage ──

  it("deletePassage sends DELETE", async () => {
    mockFetch({});
    const api = await getUseLoreApi();
    await api.deletePassage("global", "old.md");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]!).toBe("/api/lore/global/old.md");
    expect(call[1]!.method).toBe("DELETE");
  });

  it("deletePassage throws on error", async () => {
    mockFetch({ detail: "Forbidden" }, 403);
    const api = await getUseLoreApi();
    await expect(api.deletePassage("global", "x.md")).rejects.toThrow(
      "Forbidden",
    );
  });
});
