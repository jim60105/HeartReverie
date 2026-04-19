import { ref } from "vue";
import { stubSessionStorage } from "@/__tests__/setup";

const wsConnected = ref(false);
const wsAuthenticated = ref(false);
const wsSend = vi.fn();
const wsHandlers: Record<string, (msg: Record<string, unknown>) => void> = {};
const wsOnMessage = vi.fn((type: string, handler: (msg: Record<string, unknown>) => void) => {
  wsHandlers[type] = handler;
  return vi.fn();
});

const usagePush = vi.fn();
const usageLoad = vi.fn(() => Promise.resolve());

vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: wsConnected,
    isAuthenticated: wsAuthenticated,
    send: wsSend,
    onMessage: wsOnMessage,
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
}));

vi.mock("@/composables/useUsage", () => ({
  useUsage: () => ({
    records: ref([]),
    totals: ref({ promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 }),
    currentKey: ref(""),
    load: usageLoad,
    pushRecord: usagePush,
    reset: vi.fn(),
  }),
}));

describe("useChatApi additional coverage", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    stubSessionStorage();
    wsConnected.value = false;
    wsAuthenticated.value = false;
    wsSend.mockClear();
    wsOnMessage.mockClear();
    usagePush.mockClear();
    usageLoad.mockClear();
    for (const key of Object.keys(wsHandlers)) delete wsHandlers[key];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function getApi() {
    const { useChatApi } = await import("@/composables/useChatApi");
    return useChatApi();
  }

  it("sendMessage WebSocket timeout resolves false with timeout message", async () => {
    wsConnected.value = true;
    wsAuthenticated.value = true;

    const api = await getApi();
    const pending = api.sendMessage("s", "t", "m");

    await vi.advanceTimersByTimeAsync(300_000);
    expect(await pending).toBe(false);
    expect(api.errorMessage.value).toBe("請求逾時");
  });

  it("resendMessage WebSocket handles delta + done and pushes usage", async () => {
    wsConnected.value = true;
    wsAuthenticated.value = true;

    const api = await getApi();
    const pending = api.resendMessage("s", "t", "msg");

    const sent = wsSend.mock.calls[0]![0] as { id: string };
    wsHandlers["chat:delta"]?.({ id: sent.id, content: "chunk" });
    expect(api.streamingContent.value).toBe("chunk");

    wsHandlers["chat:done"]?.({
      id: sent.id,
      usage: { chapter: 1, promptTokens: 1, completionTokens: 1, totalTokens: 2, model: "m", timestamp: "t" },
    });

    expect(await pending).toBe(true);
    expect(usagePush).toHaveBeenCalled();
  });

  it("resendMessage WebSocket handles error and aborted events", async () => {
    wsConnected.value = true;
    wsAuthenticated.value = true;

    const api = await getApi();
    const pendingError = api.resendMessage("s", "t", "msg");
    const sentError = wsSend.mock.calls[0]![0] as { id: string };
    wsHandlers["chat:error"]?.({ id: sentError.id });
    expect(await pendingError).toBe(false);
    expect(api.errorMessage.value).toBe("重送失敗");

    const pendingAbort = api.resendMessage("s", "t", "msg2");
    const sentAbort = wsSend.mock.calls[1]![0] as { id: string };
    wsHandlers["chat:aborted"]?.({ id: sentAbort.id });
    expect(await pendingAbort).toBe(false);
  });

  it("resendMessage HTTP handles post failure and json fallback load", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}), headers: new Headers() })
      .mockResolvedValueOnce({ ok: false, status: 500, json: () => Promise.resolve({}), headers: new Headers() });
    vi.stubGlobal("fetch", fetchMock);

    const api = await getApi();
    expect(await api.resendMessage("s", "t", "m")).toBe(false);
    expect(api.errorMessage.value).toBe("重送失敗");

    fetchMock.mockReset();
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({}), headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.reject(new Error("bad json")), headers: new Headers() });

    expect(await api.resendMessage("s", "t", "m")).toBe(true);
    expect(usageLoad).toHaveBeenCalledWith("s", "t");
  });

  it("resendMessage HTTP handles AbortError and generic errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new DOMException("aborted", "AbortError"))),
    );
    const api = await getApi();
    expect(await api.resendMessage("s", "t", "m")).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("network"))),
    );
    expect(await api.resendMessage("s", "t", "m")).toBe(false);
    expect(api.errorMessage.value).toBe("重送失敗");
  });
});
