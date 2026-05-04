import { ref } from "vue";
import { stubSessionStorage } from "@/__tests__/setup";

const mockWsIsConnected = ref(false);
const mockWsIsAuthenticated = ref(false);
const mockWsSendFn = vi.fn();
const mockWsOnMessageFn: ReturnType<typeof vi.fn> = vi.fn(() => vi.fn());

vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: mockWsIsConnected,
    isAuthenticated: mockWsIsAuthenticated,
    send: mockWsSendFn,
    onMessage: mockWsOnMessageFn,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

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

describe("useChatApi.continueLastChapter", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockFetch({});
    mockWsIsConnected.value = false;
    mockWsIsAuthenticated.value = false;
    mockWsSendFn.mockClear();
    mockWsOnMessageFn.mockClear();
    mockWsOnMessageFn.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getChatApi() {
    const mod = await import("@/composables/useChatApi");
    return mod.useChatApi();
  }

  it("HTTP path: POST to /chat/continue (no body)", async () => {
    mockFetch({ chapter: 1, content: "full", usage: null }, 200);
    const api = await getChatApi();
    const result = await api.continueLastChapter("series", "story");
    expect(result).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/chat/continue"),
      expect.objectContaining({ method: "POST" }),
    );
    const callArgs = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0];
    const init = callArgs![1] as { body?: unknown };
    expect(init.body).toBeUndefined();
  });

  it("HTTP path: returns false on failure and sets errorMessage", async () => {
    mockFetch({ detail: "Latest chapter is empty; nothing to continue" }, 400);
    const api = await getChatApi();
    const result = await api.continueLastChapter("s", "t");
    expect(result).toBe(false);
    expect(api.errorMessage.value).toBe(
      "續寫失敗",
    );
  });

  it("HTTP path: toggles isLoading", async () => {
    let resolveFetch: (() => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; headers: Headers }>((resolve) => {
            if (!resolveFetch) {
              resolveFetch = () =>
                resolve({
                  ok: true,
                  status: 200,
                  json: () => Promise.resolve({}),
                  headers: new Headers(),
                });
            } else {
              resolve({
                ok: true,
                status: 200,
                json: () =>
                  Promise.resolve({
                    records: [],
                    totals: {
                      promptTokens: 0,
                      completionTokens: 0,
                      totalTokens: 0,
                      count: 0,
                    },
                  }),
                headers: new Headers(),
              });
            }
          }),
      ),
    );
    const api = await getChatApi();
    const promise = api.continueLastChapter("s", "t");
    expect(api.isLoading.value).toBe(true);
    resolveFetch!();
    await promise;
    expect(api.isLoading.value).toBe(false);
  });

  it("WS path: emits chat:continue envelope and resolves on chat:done", async () => {
    mockWsIsConnected.value = true;
    mockWsIsAuthenticated.value = true;
    type Handler = (msg: Record<string, unknown>) => void;
    const handlers: Record<string, Handler> = {};
    mockWsOnMessageFn.mockImplementation((event: string, fn: Handler) => {
      handlers[event] = fn;
      return vi.fn();
    });

    const api = await getChatApi();
    const promise = api.continueLastChapter("series", "story");

    expect(mockWsSendFn).toHaveBeenCalledTimes(1);
    const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
    expect(sent.type).toBe("chat:continue");
    expect(sent.series).toBe("series");
    expect(sent.story).toBe("story");
    expect(typeof sent.id).toBe("string");

    handlers["chat:done"]!({
      type: "chat:done",
      id: sent.id,
      usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
    });
    const result = await promise;
    expect(result).toBe(true);
    expect(api.isLoading.value).toBe(false);
  });

  it("WS path: chat:error populates errorMessage with detail", async () => {
    mockWsIsConnected.value = true;
    mockWsIsAuthenticated.value = true;
    type Handler = (msg: Record<string, unknown>) => void;
    const handlers: Record<string, Handler> = {};
    mockWsOnMessageFn.mockImplementation((event: string, fn: Handler) => {
      handlers[event] = fn;
      return vi.fn();
    });

    const api = await getChatApi();
    const promise = api.continueLastChapter("s", "t");
    const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
    handlers["chat:error"]!({
      type: "chat:error",
      id: sent.id,
      detail: "boom",
    });
    const result = await promise;
    expect(result).toBe(false);
    expect(api.errorMessage.value).toBe("續寫失敗");
  });
});
