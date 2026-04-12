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

describe("useChatApi", () => {
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

  it("sendMessage does not include template in body", async () => {
    mockFetch({}, 200);
    const api = await getChatApi();
    await api.sendMessage("s", "t", "msg");
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string,
    );
    expect(body).not.toHaveProperty("template");
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

  describe("WebSocket path", () => {
    beforeEach(() => {
      mockWsIsConnected.value = true;
      mockWsIsAuthenticated.value = true;
    });

    it("sendMessage sends chat:send with UUID id via WebSocket", async () => {
      // Make onMessage return an unsubscribe fn; capture the handlers
      mockWsOnMessageFn.mockImplementation(() => vi.fn());
      const api = await getChatApi();
      // Don't await — promise won't resolve until chat:done handler fires
      api.sendMessage("s", "t", "hello");

      expect(mockWsSendFn).toHaveBeenCalledTimes(1);
      const sentArg = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      expect(sentArg.type).toBe("chat:send");
      expect(sentArg.series).toBe("s");
      expect(sentArg.story).toBe("t");
      expect(sentArg.message).toBe("hello");
      expect(typeof sentArg.id).toBe("string");
      expect((sentArg.id as string).length).toBeGreaterThan(0);
    });

    it("resendMessage sends chat:resend via WebSocket", async () => {
      mockWsOnMessageFn.mockImplementation(() => vi.fn());
      const api = await getChatApi();
      api.resendMessage("s", "t", "retry");

      expect(mockWsSendFn).toHaveBeenCalledTimes(1);
      const sentArg = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      expect(sentArg.type).toBe("chat:resend");
      expect(sentArg.series).toBe("s");
      expect(sentArg.story).toBe("t");
      expect(sentArg.message).toBe("retry");
    });

    it("HTTP fallback is used when WebSocket is disconnected", async () => {
      mockWsIsConnected.value = false;
      mockFetch({}, 200);
      const api = await getChatApi();
      await api.sendMessage("s", "t", "msg");

      expect(fetch).toHaveBeenCalled();
      expect(mockWsSendFn).not.toHaveBeenCalled();
    });

    it("streamingContent initial value is empty string", async () => {
      const api = await getChatApi();
      expect(api.streamingContent.value).toBe("");
    });

    it("streamingContent accumulates chat:delta messages", async () => {
      // Capture the handler registered for chat:delta
      const capturedHandlers: Record<string, (msg: unknown) => void> = {};
      mockWsOnMessageFn.mockImplementation((type: string, handler: (msg: unknown) => void) => {
        capturedHandlers[type] = handler;
        return vi.fn();
      });

      const api = await getChatApi();
      const promise = api.sendMessage("s", "t", "hello");

      // Get the id from the send call
      const sentArg = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      const id = sentArg.id as string;

      // Simulate delta messages
      capturedHandlers["chat:delta"]!({ type: "chat:delta", id, content: "Hello " });
      expect(api.streamingContent.value).toBe("Hello ");

      capturedHandlers["chat:delta"]!({ type: "chat:delta", id, content: "world" });
      expect(api.streamingContent.value).toBe("Hello world");

      // Complete the stream
      capturedHandlers["chat:done"]!({ type: "chat:done", id });
      const result = await promise;
      expect(result).toBe(true);
      expect(api.streamingContent.value).toBe("");
      expect(api.isLoading.value).toBe(false);
    });

    it("chat:error resolves false and sets errorMessage", async () => {
      const capturedHandlers: Record<string, (msg: unknown) => void> = {};
      mockWsOnMessageFn.mockImplementation((type: string, handler: (msg: unknown) => void) => {
        capturedHandlers[type] = handler;
        return vi.fn();
      });

      const api = await getChatApi();
      const promise = api.sendMessage("s", "t", "hello");

      const sentArg = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      const id = sentArg.id as string;

      capturedHandlers["chat:error"]!({ type: "chat:error", id, detail: "fail" });
      const result = await promise;
      expect(result).toBe(false);
      expect(api.errorMessage.value).toBeTruthy();
      expect(api.isLoading.value).toBe(false);
    });

    it("chat:aborted resolves false and resets loading state", async () => {
      const capturedHandlers: Record<string, (msg: unknown) => void> = {};
      mockWsOnMessageFn.mockImplementation((type: string, handler: (msg: unknown) => void) => {
        capturedHandlers[type] = handler;
        return vi.fn();
      });

      const api = await getChatApi();
      const promise = api.sendMessage("s", "t", "hello");

      const sentArg = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      const id = sentArg.id as string;

      // Simulate server-side abort confirmation
      capturedHandlers["chat:aborted"]!({ type: "chat:aborted", id });
      const result = await promise;
      expect(result).toBe(false);
      expect(api.streamingContent.value).toBe("");
      expect(api.isLoading.value).toBe(false);
    });

    it("abortCurrentRequest sends chat:abort when WS request active", async () => {
      const capturedHandlers: Record<string, (msg: unknown) => void> = {};
      mockWsOnMessageFn.mockImplementation((type: string, handler: (msg: unknown) => void) => {
        capturedHandlers[type] = handler;
        return vi.fn();
      });

      const api = await getChatApi();
      api.sendMessage("s", "t", "hello");

      const sentArg = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      const id = sentArg.id as string;

      // Call abort
      api.abortCurrentRequest();

      // Should have sent chat:abort with the same id
      expect(mockWsSendFn).toHaveBeenCalledTimes(2);
      const abortArg = mockWsSendFn.mock.calls[1]![0] as Record<string, unknown>;
      expect(abortArg.type).toBe("chat:abort");
      expect(abortArg.id).toBe(id);
    });

    it("abortCurrentRequest is no-op when no active request", async () => {
      const api = await getChatApi();
      // Should not throw
      api.abortCurrentRequest();
      expect(mockWsSendFn).not.toHaveBeenCalled();
    });
  });

  describe("HTTP abort", () => {
    it("abortCurrentRequest aborts HTTP fetch", async () => {
      let fetchAbortSignal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          fetchAbortSignal = init?.signal as AbortSignal | undefined;
          return new Promise<{ ok: boolean; status: number; json: () => Promise<unknown>; headers: Headers }>(
            (_resolve, reject) => {
              if (fetchAbortSignal) {
                fetchAbortSignal.addEventListener("abort", () => {
                  reject(new DOMException("The operation was aborted.", "AbortError"));
                });
              }
            },
          );
        }),
      );

      const api = await getChatApi();
      const promise = api.sendMessage("s", "t", "msg");

      // Abort the request
      api.abortCurrentRequest();
      const result = await promise;
      expect(result).toBe(false);
      // AbortError should not set errorMessage
      expect(api.errorMessage.value).toBe("");
      expect(api.isLoading.value).toBe(false);
    });
  });
});
