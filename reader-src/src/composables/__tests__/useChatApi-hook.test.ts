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

describe("useChatApi — chat:send:before hook", () => {
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

  it("HTTP fallback uses hook-transformed message in POST body", async () => {
    const fetchMock = vi.fn(
      (_url: unknown, _init?: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({}),
          headers: new Headers(),
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { frontendHooks } = await import("@/lib/plugin-hooks");
    frontendHooks.register("chat:send:before", (ctx) => {
      expect(ctx.mode).toBe("send");
      expect(ctx.series).toBe("s");
      expect(ctx.story).toBe("st");
      return `transformed:${ctx.message}`;
    });

    const { useChatApi } = await import("@/composables/useChatApi");
    await useChatApi().sendMessage("s", "st", "hello");

    const call = fetchMock.mock.calls.find(
      (c) => typeof c[1] === "object" && (c[1] as { method?: string }).method === "POST",
    );
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as { body: string }).body);
    expect(body.message).toBe("transformed:hello");
  });

  it("WebSocket path uses hook-transformed message in chat:send payload", async () => {
    mockWsIsConnected.value = true;
    mockWsIsAuthenticated.value = true;

    const { frontendHooks } = await import("@/lib/plugin-hooks");
    frontendHooks.register("chat:send:before", () => "ws-transformed");

    const { useChatApi } = await import("@/composables/useChatApi");
    // Fire-and-forget; we only need to observe the send() call synchronously.
    void useChatApi().sendMessage("s", "st", "orig");

    expect(mockWsSendFn).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "chat:send",
        series: "s",
        story: "st",
        message: "ws-transformed",
      }),
    );
  });

  it("resendMessage sets ctx.mode = 'resend'", async () => {
    mockWsIsConnected.value = true;
    mockWsIsAuthenticated.value = true;

    const { frontendHooks } = await import("@/lib/plugin-hooks");
    const seen: string[] = [];
    frontendHooks.register("chat:send:before", (ctx) => {
      seen.push(ctx.mode);
    });

    const { useChatApi } = await import("@/composables/useChatApi");
    void useChatApi().resendMessage("s", "st", "orig");
    expect(seen).toContain("resend");
  });
});
