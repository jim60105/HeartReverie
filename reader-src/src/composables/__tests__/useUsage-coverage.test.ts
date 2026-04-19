import { stubSessionStorage } from "@/__tests__/setup";

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({
    getAuthHeaders: () => ({ "X-Passphrase": "test" }),
  }),
}));

describe("useUsage additional coverage", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getUsage() {
    const { useUsage } = await import("@/composables/useUsage");
    return useUsage();
  }

  it("recomputes totals when backend omits totals payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              records: [
                {
                  chapter: 1,
                  promptTokens: 2,
                  completionTokens: 3,
                  totalTokens: 5,
                  model: "m",
                  timestamp: "t",
                },
              ],
            }),
          headers: new Headers(),
        })
      ),
    );

    const usage = await getUsage();
    await usage.load("s", "t");
    expect(usage.totals.value.totalTokens).toBe(5);
    expect(usage.totals.value.count).toBe(1);
  });

  it("load catch path resets state and sets key", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));

    const usage = await getUsage();
    usage.pushRecord({
      chapter: 9,
      promptTokens: 1,
      completionTokens: 1,
      totalTokens: 2,
      model: "m",
      timestamp: "t",
    });

    await usage.load("series-x", "story-y");
    expect(usage.records.value).toEqual([]);
    expect(usage.currentKey.value).toBe("series-x/story-y");
    expect(usage.totals.value.count).toBe(0);
  });
});
