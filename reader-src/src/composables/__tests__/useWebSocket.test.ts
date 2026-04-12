import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

class MockWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  readyState = MockWebSocket.OPEN;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  });

  simulateMessage(data: unknown) {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(data) }));
  }
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }
}

let mockWsInstance: MockWebSocket;
vi.stubGlobal('WebSocket', class extends MockWebSocket {
  constructor() {
    super();
    mockWsInstance = this;
  }
});

describe('useWebSocket', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    // Re-stub WebSocket after unstubAllGlobals for next test
    vi.stubGlobal('WebSocket', class extends MockWebSocket {
      constructor() {
        super();
        mockWsInstance = this;
      }
    });
  });

  async function getWebSocket() {
    const mod = await import('@/composables/useWebSocket');
    return mod.useWebSocket();
  }

  it('connect creates WebSocket and sends auth on open', async () => {
    const ws = await getWebSocket();
    ws.connect('ws://localhost/ws', 'secret');
    mockWsInstance.simulateOpen();

    expect(ws.isConnected.value).toBe(true);
    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'auth', passphrase: 'secret' }),
    );
  });

  it('auth:ok response sets isAuthenticated to true', async () => {
    const ws = await getWebSocket();
    ws.connect('ws://localhost/ws', 'secret');
    mockWsInstance.simulateOpen();
    mockWsInstance.simulateMessage({ type: 'auth:ok' });

    expect(ws.isAuthenticated.value).toBe(true);
  });

  it('auth:error response sets isAuthenticated to false', async () => {
    const ws = await getWebSocket();
    ws.connect('ws://localhost/ws', 'secret');
    mockWsInstance.simulateOpen();
    // First set authenticated to true via auth:ok
    mockWsInstance.simulateMessage({ type: 'auth:ok' });
    expect(ws.isAuthenticated.value).toBe(true);
    // Then receive auth:error
    mockWsInstance.simulateMessage({ type: 'auth:error', detail: 'bad' });

    expect(ws.isAuthenticated.value).toBe(false);
  });

  it('send calls ws.send with JSON stringified message', async () => {
    const ws = await getWebSocket();
    ws.connect('ws://localhost/ws', 'secret');
    mockWsInstance.simulateOpen();
    // Clear the auth send call
    mockWsInstance.send.mockClear();

    ws.send({ type: 'chat:send', id: '1', series: 's', story: 'st', message: 'hi' });

    expect(mockWsInstance.send).toHaveBeenCalledWith(
      JSON.stringify({ type: 'chat:send', id: '1', series: 's', story: 'st', message: 'hi' }),
    );
  });

  it('onMessage handler receives typed messages and unsubscribe works', async () => {
    const ws = await getWebSocket();
    ws.connect('ws://localhost/ws', 'secret');
    mockWsInstance.simulateOpen();

    const handler = vi.fn();
    const unsub = ws.onMessage('auth:ok', handler);

    mockWsInstance.simulateMessage({ type: 'auth:ok' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ type: 'auth:ok' });

    unsub();
    mockWsInstance.simulateMessage({ type: 'auth:ok' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('disconnect closes WebSocket and sets isConnected to false', async () => {
    const ws = await getWebSocket();
    ws.connect('ws://localhost/ws', 'secret');
    mockWsInstance.simulateOpen();
    expect(ws.isConnected.value).toBe(true);

    ws.disconnect();

    expect(ws.isConnected.value).toBe(false);
    expect(ws.isAuthenticated.value).toBe(false);
  });

  it('reconnection: after unexpected close, attempts reconnect after delay', async () => {
    const ws = await getWebSocket();
    ws.connect('ws://localhost/ws', 'secret');
    const firstInstance = mockWsInstance;
    firstInstance.simulateOpen();

    // Simulate unexpected close (not intentional disconnect)
    firstInstance.onclose?.(new CloseEvent('close'));

    expect(ws.isConnected.value).toBe(false);

    // Advance timer past reconnect delay (1000ms)
    vi.advanceTimersByTime(1100);

    // A new WebSocket instance should have been created
    expect(mockWsInstance).not.toBe(firstInstance);
  });
});
