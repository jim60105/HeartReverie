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

describe("useUsage", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getApi() {
    const mod = await import("@/composables/useUsage");
    return mod.useUsage();
  }

  it("load fetches records and exposes totals", async () => {
    mockFetch({
      records: [
        {
          chapter: 1,
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
          model: "m",
          timestamp: "2026-01-01T00:00:00Z",
        },
      ],
      totals: {
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        count: 1,
      },
    });
    const api = await getApi();
    api.reset();
    await api.load("s", "t");
    expect(api.records.value.length).toBe(1);
    expect(api.totals.value.totalTokens).toBe(30);
    expect(api.currentKey.value).toBe("s/t");
  });

  it("load tolerates failed response by resetting records", async () => {
    mockFetch({}, 500);
    const api = await getApi();
    api.pushRecord({
      chapter: 1,
      promptTokens: 5,
      completionTokens: 5,
      totalTokens: 10,
      model: "m",
      timestamp: "2026-01-01T00:00:00Z",
    });
    await api.load("s", "t");
    expect(api.records.value).toEqual([]);
    expect(api.totals.value.count).toBe(0);
  });

  it("pushRecord appends and recomputes totals", async () => {
    const api = await getApi();
    api.reset();
    api.pushRecord({
      chapter: 1,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      model: "m",
      timestamp: "2026-01-01T00:00:00Z",
    });
    api.pushRecord({
      chapter: 2,
      promptTokens: 5,
      completionTokens: 15,
      totalTokens: 20,
      model: "m",
      timestamp: "2026-01-01T00:01:00Z",
    });
    expect(api.records.value.length).toBe(2);
    expect(api.totals.value).toEqual({
      promptTokens: 15,
      completionTokens: 35,
      totalTokens: 50,
      count: 2,
    });
  });

  it("pushRecord ignores null/undefined", async () => {
    const api = await getApi();
    api.reset();
    api.pushRecord(null);
    api.pushRecord(undefined);
    expect(api.records.value.length).toBe(0);
    expect(api.totals.value.count).toBe(0);
  });

  it("reset clears state", async () => {
    const api = await getApi();
    api.pushRecord({
      chapter: 1,
      promptTokens: 10,
      completionTokens: 20,
      totalTokens: 30,
      model: "m",
      timestamp: "2026-01-01T00:00:00Z",
    });
    api.reset();
    expect(api.records.value).toEqual([]);
    expect(api.totals.value.count).toBe(0);
    expect(api.currentKey.value).toBe("");
  });
});
