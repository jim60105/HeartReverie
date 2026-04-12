import { stubSessionStorage } from "@/__tests__/setup";

function mockFetch(body: unknown, status = 200) {
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

describe("useChatApi", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockFetch({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getChatApi() {
    const mod = await import("@/composables/useChatApi");
    return mod.useChatApi();
  }

  it("initial state: not loading, no error", async () => {
    const api = await getChatApi();
    expect(api.isLoading.value).toBe(false);
    expect(api.errorMessage.value).toBe("");
  });

  it("sendMessage calls fetch with POST method", async () => {
    mockFetch({}, 200);
    const api = await getChatApi();
    await api.sendMessage("series", "story", "hello");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("chat"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("sendMessage returns true on success", async () => {
    mockFetch({}, 200);
    const api = await getChatApi();
    const result = await api.sendMessage("s", "t", "msg");
    expect(result).toBe(true);
  });

  it("sendMessage returns false on failure", async () => {
    mockFetch({}, 500);
    const api = await getChatApi();
    const result = await api.sendMessage("s", "t", "msg");
    expect(result).toBe(false);
    expect(api.errorMessage.value).toBeTruthy();
  });

  it("sendMessage sets isLoading during request", async () => {
    let resolvePromise: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; headers: Headers }>((resolve) => {
            resolvePromise = () =>
              resolve({
                ok: true,
                status: 200,
                json: () => Promise.resolve({}),
                headers: new Headers(),
              });
          }),
      ),
    );
    const api = await getChatApi();
    const promise = api.sendMessage("s", "t", "msg");
    expect(api.isLoading.value).toBe(true);
    resolvePromise!();
    await promise;
    expect(api.isLoading.value).toBe(false);
  });

  it("resendMessage calls DELETE then POST", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({}),
        headers: new Headers(),
      });
    vi.stubGlobal("fetch", fetchMock);

    const api = await getChatApi();
    const result = await api.resendMessage("s", "t", "msg");
    expect(result).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]![1]).toHaveProperty("method", "DELETE");
    expect(fetchMock.mock.calls[1]![1]).toHaveProperty("method", "POST");
  });

  it("resendMessage returns false when delete fails", async () => {
    mockFetch({}, 500);
    const api = await getChatApi();
    const result = await api.resendMessage("s", "t", "msg");
    expect(result).toBe(false);
  });

  it("sendMessage includes template when provided", async () => {
    mockFetch({}, 200);
    const api = await getChatApi();
    await api.sendMessage("s", "t", "msg", "custom template");
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string,
    );
    expect(body.template).toBe("custom template");
  });

  it("sendMessage catches network errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network"))),
    );
    const api = await getChatApi();
    const result = await api.sendMessage("s", "t", "msg");
    expect(result).toBe(false);
    expect(api.errorMessage.value).toBeTruthy();
  });
});
