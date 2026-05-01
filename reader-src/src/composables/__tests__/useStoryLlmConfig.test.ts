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

describe("useStoryLlmConfig", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getApi() {
    const mod = await import("@/composables/useStoryLlmConfig");
    return mod.useStoryLlmConfig();
  }

  it("loadConfig GETs the correct URL and stores overrides", async () => {
    mockFetch({ temperature: 0.7, topK: 5 });
    const api = await getApi();
    await api.loadConfig("my-series", "my-story");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("/api/my-series/my-story/config");
    expect(api.overrides.value).toEqual({ temperature: 0.7, topK: 5 });
    expect(api.error.value).toBeNull();
  });

  it("loadConfig URL-encodes params", async () => {
    mockFetch({});
    const api = await getApi();
    await api.loadConfig("a b", "c/d");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("/api/a%20b/c%2Fd/config");
  });

  it("loadConfig sets error when request fails", async () => {
    mockFetch({ detail: "Bad params" }, 400);
    const api = await getApi();
    await api.loadConfig("s", "n");

    expect(api.error.value).toBe("Bad params");
    expect(api.overrides.value).toEqual({});
  });

  it("saveConfig PUTs JSON body and updates overrides", async () => {
    mockFetch({ temperature: 0.9 });
    const api = await getApi();
    const result = await api.saveConfig("s", "n", { temperature: 0.9 });

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(call[0]).toBe("/api/s/n/config");
    expect(call[1]!.method).toBe("PUT");
    expect(JSON.parse(call[1]!.body)).toEqual({ temperature: 0.9 });
    expect(call[1]!.headers["Content-Type"]).toBe("application/json");
    expect(result).toEqual({ temperature: 0.9 });
    expect(api.overrides.value).toEqual({ temperature: 0.9 });
  });

  it("saveConfig throws and sets error on failure", async () => {
    mockFetch({ detail: "Invalid" }, 400);
    const api = await getApi();
    await expect(api.saveConfig("s", "n", { topK: 5 })).rejects.toThrow("Invalid");
    expect(api.error.value).toBe("Invalid");
  });

  it("saveConfig can persist an empty object (clears overrides)", async () => {
    mockFetch({});
    const api = await getApi();
    const result = await api.saveConfig("s", "n", {});
    expect(result).toEqual({});
    expect(api.overrides.value).toEqual({});
  });

  it("reset clears state", async () => {
    mockFetch({ temperature: 0.5 });
    const api = await getApi();
    await api.loadConfig("s", "n");
    api.reset();
    expect(api.overrides.value).toEqual({});
    expect(api.error.value).toBeNull();
  });

  it("loading flag toggles around loadConfig", async () => {
    mockFetch({});
    const api = await getApi();
    const p = api.loadConfig("s", "n");
    expect(api.loading.value).toBe(true);
    await p;
    expect(api.loading.value).toBe(false);
  });

  it("round-trips reasoningEnabled (boolean) and reasoningEffort (enum) preserving real types", async () => {
    mockFetch({ reasoningEnabled: false, reasoningEffort: "low" });
    const api = await getApi();
    await api.loadConfig("s", "n");
    expect(api.overrides.value).toEqual({
      reasoningEnabled: false,
      reasoningEffort: "low",
    });
    expect(typeof api.overrides.value.reasoningEnabled).toBe("boolean");
    expect(typeof api.overrides.value.reasoningEffort).toBe("string");

    mockFetch({ reasoningEnabled: true, reasoningEffort: "xhigh" });
    const result = await api.saveConfig("s", "n", {
      reasoningEnabled: true,
      reasoningEffort: "xhigh",
    });
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    const body = JSON.parse(call[1]!.body);
    expect(body).toEqual({ reasoningEnabled: true, reasoningEffort: "xhigh" });
    expect(typeof body.reasoningEnabled).toBe("boolean");
    expect(result).toEqual({ reasoningEnabled: true, reasoningEffort: "xhigh" });
  });

  describe("loadLlmDefaults", () => {
    const VALID_DEFAULTS = {
      model: "deepseek/deepseek-v4-pro",
      temperature: 0.1,
      frequencyPenalty: 0.13,
      presencePenalty: 0.52,
      topK: 10,
      topP: 0,
      repetitionPenalty: 1.2,
      minP: 0,
      topA: 1,
      reasoningEnabled: true,
      reasoningEffort: "xhigh",
      maxCompletionTokens: 4096,
    };

    it("populates defaults on a validated success response", async () => {
      mockFetch(VALID_DEFAULTS);
      const api = await getApi();
      await api.loadLlmDefaults();

      const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0]!;
      expect(call[0]).toBe("/api/llm-defaults");
      expect(api.defaults.value).toEqual(VALID_DEFAULTS);
      expect(api.defaultsError.value).toBeNull();
      expect(api.defaultsLoading.value).toBe(false);
    });

    it("leaves defaults at null and records an error on non-2xx response", async () => {
      mockFetch({ detail: "unauthorized" }, 401);
      const api = await getApi();
      await api.loadLlmDefaults();

      expect(api.defaults.value).toBeNull();
      expect(api.defaultsError.value).toBeTruthy();
    });

    it("rejects a body missing a required key", async () => {
      const body = { ...VALID_DEFAULTS } as Record<string, unknown>;
      delete body.maxCompletionTokens;
      mockFetch(body);
      const api = await getApi();
      await api.loadLlmDefaults();

      expect(api.defaults.value).toBeNull();
      expect(api.defaultsError.value).toContain("maxCompletionTokens");
    });

    it("rejects a body with the wrong type for a numeric field", async () => {
      mockFetch({ ...VALID_DEFAULTS, temperature: "not-a-number" });
      const api = await getApi();
      await api.loadLlmDefaults();

      expect(api.defaults.value).toBeNull();
      expect(api.defaultsError.value).toContain("temperature");
    });

    it("rejects a body with an invalid reasoningEffort enum value", async () => {
      mockFetch({ ...VALID_DEFAULTS, reasoningEffort: "ultraviolet" });
      const api = await getApi();
      await api.loadLlmDefaults();

      expect(api.defaults.value).toBeNull();
      expect(api.defaultsError.value).toContain("reasoningEffort");
    });

    it("rejects a non-positive-integer maxCompletionTokens", async () => {
      mockFetch({ ...VALID_DEFAULTS, maxCompletionTokens: 0 });
      const api = await getApi();
      await api.loadLlmDefaults();

      expect(api.defaults.value).toBeNull();
      expect(api.defaultsError.value).toContain("maxCompletionTokens");
    });

    it("toggles defaultsLoading flag around the request", async () => {
      mockFetch(VALID_DEFAULTS);
      const api = await getApi();
      const p = api.loadLlmDefaults();
      expect(api.defaultsLoading.value).toBe(true);
      await p;
      expect(api.defaultsLoading.value).toBe(false);
    });
  });
});
