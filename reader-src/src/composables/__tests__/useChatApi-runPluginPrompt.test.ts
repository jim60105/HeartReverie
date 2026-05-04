// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

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

describe("useChatApi.runPluginPrompt", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    mockWsIsConnected.value = false;
    mockWsIsAuthenticated.value = false;
    mockWsSendFn.mockClear();
    mockWsOnMessageFn.mockClear();
    mockWsOnMessageFn.mockImplementation(() => vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getApi() {
    const mod = await import("@/composables/useChatApi");
    return mod.useChatApi();
  }

  describe("WebSocket transport", () => {
    beforeEach(() => {
      mockWsIsConnected.value = true;
      mockWsIsAuthenticated.value = true;
    });

    it("dispatches plugin-action:run envelope with correlationId and forwards options", async () => {
      mockWsOnMessageFn.mockImplementation(() => vi.fn());
      const api = await getApi();
      void api.runPluginPrompt("state", "state-recompute.md", {
        series: "S",
        name: "T",
        append: true,
        appendTag: "UpdateVariable",
      }).catch(() => {});

      expect(mockWsSendFn).toHaveBeenCalledTimes(1);
      const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      expect(sent.type).toBe("plugin-action:run");
      expect(sent.pluginName).toBe("state");
      expect(sent.promptFile).toBe("state-recompute.md");
      expect(sent.append).toBe(true);
      expect(sent.appendTag).toBe("UpdateVariable");
      expect(sent.series).toBe("S");
      expect(sent.name).toBe("T");
      expect(typeof sent.correlationId).toBe("string");
      expect((sent.correlationId as string).length).toBeGreaterThan(0);
    });

    it("streams plugin-action:delta into streamingContent and resolves on :done", async () => {
      const handlers: Record<string, (msg: unknown) => void> = {};
      mockWsOnMessageFn.mockImplementation(
        (type: string, h: (msg: unknown) => void) => {
          handlers[type] = h;
          return vi.fn();
        },
      );

      const api = await getApi();
      const promise = api.runPluginPrompt("p", "x.md");
      const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      const correlationId = sent.correlationId as string;

      handlers["plugin-action:delta"]!({
        type: "plugin-action:delta",
        correlationId,
        chunk: "Hello ",
      });
      expect(api.streamingContent.value).toBe("Hello ");
      handlers["plugin-action:delta"]!({
        type: "plugin-action:delta",
        correlationId,
        chunk: "world",
      });
      expect(api.streamingContent.value).toBe("Hello world");

      handlers["plugin-action:done"]!({
        type: "plugin-action:done",
        correlationId,
        content: "Hello world",
        usage: null,
        chapterUpdated: true,
        chapterReplaced: false,
        appendedTag: null,
      });

      const result = await promise;
      expect(result.content).toBe("Hello world");
      expect(result.chapterUpdated).toBe(true);
      expect(api.streamingContent.value).toBe("");
      expect(api.isLoading.value).toBe(false);
    });

    it("rejects when plugin-action:error envelope arrives", async () => {
      const handlers: Record<string, (msg: unknown) => void> = {};
      mockWsOnMessageFn.mockImplementation(
        (type: string, h: (msg: unknown) => void) => {
          handlers[type] = h;
          return vi.fn();
        },
      );

      const api = await getApi();
      const promise = api.runPluginPrompt("p", "x.md");
      const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      const correlationId = sent.correlationId as string;

      handlers["plugin-action:error"]!({
        type: "plugin-action:error",
        correlationId,
        problem: { detail: "bad path" },
      });

      await expect(promise).rejects.toThrow("bad path");
      expect(api.isLoading.value).toBe(false);
      expect(api.errorMessage.value).toBe("bad path");
    });

    it("abortCurrentRequest sends plugin-action:abort with the correlationId", async () => {
      mockWsOnMessageFn.mockImplementation(() => vi.fn());
      const api = await getApi();
      void api.runPluginPrompt("p", "x.md").catch(() => {});
      const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      const correlationId = sent.correlationId as string;

      api.abortCurrentRequest();
      expect(mockWsSendFn).toHaveBeenCalledTimes(2);
      const abortMsg = mockWsSendFn.mock.calls[1]![0] as Record<string, unknown>;
      expect(abortMsg.type).toBe("plugin-action:abort");
      expect(abortMsg.correlationId).toBe(correlationId);
    });

    it("rejects with AbortError on plugin-action:aborted", async () => {
      const handlers: Record<string, (msg: unknown) => void> = {};
      mockWsOnMessageFn.mockImplementation(
        (type: string, h: (msg: unknown) => void) => {
          handlers[type] = h;
          return vi.fn();
        },
      );
      const api = await getApi();
      const promise = api.runPluginPrompt("p", "x.md");
      const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      const correlationId = sent.correlationId as string;
      handlers["plugin-action:aborted"]!({
        type: "plugin-action:aborted",
        correlationId,
      });
      await expect(promise).rejects.toThrow();
      expect(api.isLoading.value).toBe(false);
    });

    it("forwards replace: true on the WS envelope and surfaces chapterReplaced from done", async () => {
      const handlers: Record<string, (msg: unknown) => void> = {};
      mockWsOnMessageFn.mockImplementation(
        (type: string, h: (msg: unknown) => void) => {
          handlers[type] = h;
          return vi.fn();
        },
      );

      const api = await getApi();
      const promise = api.runPluginPrompt("polish", "polish-instruction.md", {
        replace: true,
      });

      expect(mockWsSendFn).toHaveBeenCalledTimes(1);
      const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      expect(sent.replace).toBe(true);
      expect(sent).not.toHaveProperty("append");
      expect(sent).not.toHaveProperty("appendTag");

      const correlationId = sent.correlationId as string;
      handlers["plugin-action:done"]!({
        type: "plugin-action:done",
        correlationId,
        content: "polished",
        usage: null,
        chapterUpdated: false,
        chapterReplaced: true,
        appendedTag: null,
      });

      const result = await promise;
      expect(result.chapterReplaced).toBe(true);
    });

    it("does not include replace field when replace is not set", async () => {
      mockWsOnMessageFn.mockImplementation(() => vi.fn());
      const api = await getApi();
      void api.runPluginPrompt("p", "x.md", { append: true }).catch(() => {});

      const sent = mockWsSendFn.mock.calls[0]![0] as Record<string, unknown>;
      expect(sent).not.toHaveProperty("replace");
    });

    it("rejects when isLoading is already true", async () => {
      mockWsOnMessageFn.mockImplementation(() => vi.fn());
      const api = await getApi();
      void api.runPluginPrompt("p", "x.md").catch(() => {});
      expect(api.isLoading.value).toBe(true);
      await expect(api.runPluginPrompt("p", "y.md")).rejects.toThrow(/in flight/i);
      expect(mockWsSendFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("HTTP fallback", () => {
    it("POSTs to /api/plugins/:pluginName/run-prompt and resolves with body", async () => {
      const final = {
        content: "ok",
        usage: null,
        chapterUpdated: true,
        appendedTag: "UpdateVariable",
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(final),
            headers: new Headers(),
          }),
        ),
      );
      const api = await getApi();
      const result = await api.runPluginPrompt("state", "state-recompute.md", {
        series: "S",
        name: "T",
        append: true,
        appendTag: "UpdateVariable",
      });
      expect(result).toEqual(final);
      expect(api.streamingContent.value).toBe("");
      expect(api.isLoading.value).toBe(false);
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      expect(fetchMock.mock.calls[0]![0]).toContain("/api/plugins/state/run-prompt");
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.append).toBe(true);
      expect(body.appendTag).toBe("UpdateVariable");
    });

    it("rejects on non-OK response with detail surfaced into errorMessage", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            ok: false,
            status: 400,
            json: () => Promise.resolve({ detail: "invalid prompt path" }),
            headers: new Headers(),
          }),
        ),
      );
      const api = await getApi();
      await expect(api.runPluginPrompt("p", "../x.md")).rejects.toThrow(
        /invalid prompt path/,
      );
      expect(api.errorMessage.value).toContain("invalid");
      expect(api.isLoading.value).toBe(false);
    });

    it("forwards replace: true in the HTTP POST body", async () => {
      const final = {
        content: "polished",
        usage: null,
        chapterUpdated: false,
        chapterReplaced: true,
        appendedTag: null,
      };
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve({
            ok: true,
            status: 200,
            json: () => Promise.resolve(final),
            headers: new Headers(),
          }),
        ),
      );
      const api = await getApi();
      const result = await api.runPluginPrompt("polish", "polish-instruction.md", {
        replace: true,
      });
      expect(result.chapterReplaced).toBe(true);
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const init = fetchMock.mock.calls[0]![1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.replace).toBe(true);
      expect(body).not.toHaveProperty("append");
      expect(body).not.toHaveProperty("appendTag");
    });

    it("abortCurrentRequest aborts the underlying fetch", async () => {
      let signal: AbortSignal | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn((_url: string, init?: RequestInit) => {
          signal = init?.signal as AbortSignal | undefined;
          return new Promise((_resolve, reject) => {
            signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        }),
      );
      const api = await getApi();
      const p = api.runPluginPrompt("p", "x.md");
      // Microtask gap so fetch is invoked
      await Promise.resolve();
      api.abortCurrentRequest();
      await expect(p).rejects.toThrow();
      expect(signal?.aborted).toBe(true);
    });
  });
});
