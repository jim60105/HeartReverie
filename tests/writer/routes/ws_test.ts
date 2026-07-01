// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { getLiveWsConnectionCount } from "../../../writer/routes/ws.ts";
import type { AppConfig, AppDeps, BuildPromptResult } from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

/** Read one WebSocket message with a timeout. */
function readMessage(ws: WebSocket, timeoutMs = 2000): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for message")), timeoutMs);
    const handler = (e: MessageEvent) => {
      clearTimeout(timer);
      ws.removeEventListener("message", handler);
      resolve(JSON.parse(e.data as string));
    };
    ws.addEventListener("message", handler);
  });
}

async function readUntilType(
  ws: WebSocket,
  expectedType: string,
  attempts = 6,
  timeoutMs = 2500,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < attempts; i++) {
    const msg = await readMessage(ws, timeoutMs);
    if (msg.type === expectedType) return msg;
  }
  throw new Error(`Did not receive ${expectedType}`);
}

/** Wait for a WebSocket close event. */
function waitForClose(ws: WebSocket, timeoutMs = 2000): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timeout waiting for close")), timeoutMs);
    const handler = (e: CloseEvent) => {
      clearTimeout(timer);
      ws.removeEventListener("close", handler);
      resolve(e);
    };
    ws.addEventListener("close", handler);
  });
}

/** Open a WebSocket to the given server and wait for the connection to open. */
function openWs(addr: Deno.NetAddr): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${addr.port}/api/ws`);
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
  });
}

/** Authenticate a WebSocket connection and assert auth:ok. */
async function authenticate(ws: WebSocket): Promise<void> {
  ws.send(JSON.stringify({ type: "auth", passphrase: "test-pass" }));
  const msg = await readMessage(ws);
  assertEquals(msg.type, "auth:ok");
}

/** Build a minimal app instance for WebSocket-focused tests. */
function makeWsApp(tmpDir: string) {
  const safePath = createSafePath(tmpDir);
  return createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: "/nonexistent-root",
      LLM_API_URL: "http://localhost:1/nonexistent",
      LLM_MODEL: "test-model",
      PROMPT_FILE: "",
    } as unknown as AppConfig,
    safePath,
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [],
      getPluginDir: () => null,
      getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () =>
      ({
        messages: [{ role: "user" as const, content: "test prompt" }],
        ventoError: null,
        chapterFiles: [],
        chapters: [],
        previousContext: [],
        isFirstRound: true,
      }) as unknown as BuildPromptResult,
    buildContinuePromptFromStory: (async () => ({
      messages: [],
      ventoError: null,
      targetChapterNumber: 0,
      existingContent: "",
      userMessageText: "",
      assistantPrefill: "",
    })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
    templateEngine: null,
    verifyPassphrase,
  } as AppDeps);
}

Deno.test({
  name: "ws routes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmpDir = await Deno.makeTempDir({ prefix: "ws-test-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key-for-validation");

    const safePath = createSafePath(tmpDir);
    const app = createApp({
      config: {
        READER_DIR: "/nonexistent-reader",
        PLAYGROUND_DIR: tmpDir,
        ROOT_DIR: "/nonexistent-root",
        LLM_API_URL: "http://localhost:1/nonexistent",
        LLM_MODEL: "test-model",
        PROMPT_FILE: "",
      } as unknown as AppConfig,
      safePath,
      pluginManager: {
        getPlugins: () => [],
        getParameters: () => [],
        getPluginDir: () => null,
        getBuiltinDir: () => "/nonexistent-plugins",
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () =>
        ({
          messages: [{ role: "user" as const, content: "test prompt" }],
          ventoError: null,
          chapterFiles: [],
          chapters: [],
          previousContext: [],
          isFirstRound: true,
        }) as unknown as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({
        messages: [],
        ventoError: null,
        targetChapterNumber: 0,
        existingContent: "",
        userMessageText: "",
        assistantPrefill: "",
      })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
      templateEngine: null,
      verifyPassphrase,
    } as AppDeps);

    const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
    const addr = server.addr;

    try {
      // ── 8.1: WebSocket upgrade ──

      await t.step("connects via WebSocket upgrade", async () => {
        const ws = await openWs(addr);
        assertExists(ws);
        assertEquals(ws.readyState, WebSocket.OPEN);
        ws.close();
        await waitForClose(ws);
      });

      // ── 8.2: First-message authentication ──

      await t.step("auth: valid passphrase returns auth:ok", async () => {
        const ws = await openWs(addr);
        ws.send(JSON.stringify({ type: "auth", passphrase: "test-pass" }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "auth:ok");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("auth: invalid passphrase returns auth:error and closes 4001", async () => {
        const ws = await openWs(addr);
        ws.send(JSON.stringify({ type: "auth", passphrase: "wrong-pass" }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "auth:error");
        const closeEvt = await waitForClose(ws);
        assertEquals(closeEvt.code, 4001);
      });

      await t.step(
        "auth: non-auth message before auth returns error and closes 4001",
        async () => {
          const ws = await openWs(addr);
          ws.send(JSON.stringify({ type: "subscribe", series: "s", story: "t" }));
          const msg = await readMessage(ws);
          assertEquals(msg.type, "error");
          assertEquals(msg.detail, "Not authenticated");
          const closeEvt = await waitForClose(ws);
          assertEquals(closeEvt.code, 4001);
        },
      );

      await t.step(
        "auth: oversized pre-auth payload closes 1009 without processing",
        async () => {
          const ws = await openWs(addr);
          // Payload well over the 4096-byte pre-auth cap.
          ws.send(JSON.stringify({ type: "auth", passphrase: "x".repeat(5000) }));
          const closeEvt = await waitForClose(ws);
          assertEquals(closeEvt.code, 1009);
        },
      );

      await t.step(
        "auth: large binary pre-auth frame closes 1003 (cannot bypass cap)",
        async () => {
          const ws = await openWs(addr);
          // A multi-KiB binary frame would stringify to "[object ...]" (tiny)
          // and bypass a string-length cap — the server must reject it as binary.
          ws.send(new Uint8Array(6000));
          const closeEvt = await waitForClose(ws);
          assertEquals(closeEvt.code, 1003);
        },
      );

      await t.step(
        "auth: a realistic auth message is within the pre-auth cap",
        async () => {
          const ws = await openWs(addr);
          ws.send(JSON.stringify({ type: "auth", passphrase: "test-pass" }));
          const msg = await readMessage(ws);
          assertEquals(msg.type, "auth:ok");
          ws.close();
          await waitForClose(ws);
        },
      );

      // ── 8.3: Subscribe ──

      await t.step("subscribe: valid params accepted without error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        await Deno.mkdir(join(tmpDir, "sub-series", "sub-story"), { recursive: true });
        ws.send(JSON.stringify({ type: "subscribe", series: "sub-series", story: "sub-story" }));

        // No error should come back; verify by sending another message that we can read
        // Use a short timeout — if no message arrives, subscribe succeeded silently
        let gotError = false;
        try {
          const msg = await readMessage(ws, 500);
          if (msg.type === "error") gotError = true;
        } catch {
          // Timeout is the expected path: subscribe sends no response on success
        }
        assertEquals(gotError, false);
        ws.close();
        await waitForClose(ws);
      });

      await t.step("subscribe: invalid params returns error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({ type: "subscribe" }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "error");
        assertEquals(msg.detail, "Invalid subscribe parameters");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("subscribe: path-traversal series returns error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({ type: "subscribe", series: "../etc", story: "passwd" }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "error");
        ws.close();
        await waitForClose(ws);
      });

      await t.step(
        "subscribe: polling pushes chapter count and content/stateDiff updates",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);

          const storyDir = join(tmpDir, "sub-watch", "story");
          await Deno.mkdir(storyDir, { recursive: true });
          await Deno.writeTextFile(join(storyDir, "001.md"), "Initial content");
          await Deno.writeTextFile(
            join(storyDir, "001-state-diff.yaml"),
            "entries:\n  - category: mood\n    item: tone\n    before: calm\n    after: tense\n",
          );
          ws.send(JSON.stringify({ type: "subscribe", series: "sub-watch", story: "story" }));

          const updated = await readUntilType(ws, "chapters:updated", 5, 2500);
          assertEquals(updated.count, 1);
          const content = await readUntilType(ws, "chapters:content", 5, 2500);
          assertEquals(content.chapter, 1);
          assertEquals(content.content, "Initial content");
          assertEquals(
            Array.isArray((content.stateDiff as { entries?: unknown[] })?.entries),
            true,
          );

          await Deno.writeTextFile(join(storyDir, "001.md"), "Changed content");
          const updatedContent = await readUntilType(ws, "chapters:content", 5, 2500);
          assertEquals(updatedContent.content, "Changed content");

          ws.close();
          await waitForClose(ws);
        },
      );

      // ── 8.4: chat:send ──

      await t.step("chat:send: fails with unreachable LLM API", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({
          type: "chat:send",
          id: "req-1",
          series: "s1",
          story: "n1",
          message: "hello",
        }));
        const msg = await readMessage(ws, 5000);
        assertEquals(msg.type, "chat:error");
        assertEquals(msg.id, "req-1");
      });

      await t.step("chat:send: invalid params returns error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({ type: "chat:send", id: "req-2" }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "error");
        assertEquals(msg.detail, "Invalid chat:send parameters");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("chat:send: invalid story naming returns chat:error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({
          type: "chat:send",
          id: "req-invalid-name",
          series: "bad/name",
          story: "n1",
          message: "hello",
        }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "chat:error");
        assertEquals(msg.id, "req-invalid-name");
        assertEquals(msg.detail, "Invalid series or story name");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("chat:send: oversized message returns chat:error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({
          type: "chat:send",
          id: "req-long",
          series: "s1",
          story: "n1",
          message: "x".repeat(100_001),
        }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "chat:error");
        assertEquals(msg.id, "req-long");
        assertEquals(msg.detail, "Message exceeds maximum length");
        ws.close();
        await waitForClose(ws);
      });

      // ── 8.5: chat:resend ──

      await t.step("chat:resend: non-existent story returns chat:error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({
          type: "chat:resend",
          id: "req-3",
          series: "no-series",
          story: "no-story",
          message: "hello",
        }));
        const msg = await readMessage(ws, 3000);
        assertEquals(msg.type, "chat:error");
        assertEquals(msg.id, "req-3");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("chat:resend: empty story dir returns no-chapters error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        await Deno.mkdir(join(tmpDir, "resend-s", "resend-n"), { recursive: true });
        ws.send(JSON.stringify({
          type: "chat:resend",
          id: "req-4",
          series: "resend-s",
          story: "resend-n",
          message: "hello",
        }));
        const msg = await readMessage(ws, 3000);
        assertEquals(msg.type, "chat:error");
        assertEquals(msg.id, "req-4");
        assertEquals(msg.detail, "No chapters to delete");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("chat:resend: invalid params returns error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({ type: "chat:resend", id: "req-5" }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "error");
        assertEquals(msg.detail, "Invalid chat:resend parameters");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("chat:resend: invalid story naming returns chat:error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({
          type: "chat:resend",
          id: "req-resend-invalid-name",
          series: "bad/name",
          story: "n1",
          message: "hello",
        }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "chat:error");
        assertEquals(msg.id, "req-resend-invalid-name");
        assertEquals(msg.detail, "Invalid series or story name");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("chat:resend: oversized message returns chat:error", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({
          type: "chat:resend",
          id: "req-resend-long",
          series: "s1",
          story: "n1",
          message: "x".repeat(100_001),
        }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "chat:error");
        assertEquals(msg.id, "req-resend-long");
        assertEquals(msg.detail, "Message exceeds maximum length");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("chat:resend: deletes last chapter state artifacts before send", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        const storyDir = join(tmpDir, "resend-cleanup", "story");
        await Deno.mkdir(storyDir, { recursive: true });
        await Deno.writeTextFile(join(storyDir, "001.md"), "Chapter 1");
        await Deno.writeTextFile(join(storyDir, "002.md"), "Chapter 2");
        await Deno.writeTextFile(join(storyDir, "001-state.yaml"), "state: keep");
        await Deno.writeTextFile(join(storyDir, "002-state.yaml"), "state: remove");
        await Deno.writeTextFile(join(storyDir, "002-state-diff.yaml"), "diff: remove");
        await Deno.writeTextFile(join(storyDir, "current-status.yaml"), "status: remove");

        ws.send(JSON.stringify({
          type: "chat:resend",
          id: "req-5-cleanup",
          series: "resend-cleanup",
          story: "story",
          message: "retry",
        }));
        const msg = await readMessage(ws, 5000);
        assertEquals(msg.type, "chat:error");
        assertEquals(msg.id, "req-5-cleanup");

        const entries: string[] = [];
        for await (const entry of Deno.readDir(storyDir)) {
          entries.push(entry.name);
        }
        entries.sort();
        assertEquals(entries.includes("001.md"), true);
        assertEquals(entries.includes("001-state.yaml"), true);
        assertEquals(entries.includes("002.md"), false);
        assertEquals(entries.includes("002-state.yaml"), false);
        assertEquals(entries.includes("002-state-diff.yaml"), false);
        assertEquals(entries.includes("current-status.yaml"), false);

        ws.close();
        await waitForClose(ws);
      });

      // ── chat:abort ──

      await t.step("chat:abort: unknown id is silently ignored", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({ type: "chat:abort", id: "nonexistent-id" }));
        // Unknown id returns silently — no response expected
        let gotMessage = false;
        try {
          await readMessage(ws, 500);
          gotMessage = true;
        } catch {
          // Timeout expected: unknown id produces no response
        }
        assertEquals(gotMessage, false);
        ws.close();
        await waitForClose(ws);
      });

      await t.step("chat:abort: missing id is silently ignored", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({ type: "chat:abort" }));
        let gotMessage = false;
        try {
          await readMessage(ws, 500);
          gotMessage = true;
        } catch {
          // Timeout expected: missing id produces no response
        }
        assertEquals(gotMessage, false);
        ws.close();
        await waitForClose(ws);
      });

      await t.step(
        "chat:abort during initial fetch resolves as chat:aborted (not chat:error)",
        async () => {
          // Stub fetch so the upstream chat/completions request hangs until the
          // signal aborts — this exercises the fix that abort during initial
          // fetch resolution is no longer mis-routed to a 502 / chat:error.
          const originalFetch = globalThis.fetch;
          globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
            if (typeof url === "string" && url.includes("nonexistent")) {
              return new Promise<Response>((_resolve, reject) => {
                const sig = init?.signal as AbortSignal | undefined;
                if (!sig) {
                  reject(new Error("test fetch stub requires signal"));
                  return;
                }
                const onAbort = () =>
                  reject(sig.reason ?? new DOMException("aborted", "AbortError"));
                if (sig.aborted) onAbort();
                else sig.addEventListener("abort", onAbort, { once: true });
              });
            }
            return originalFetch(url as string, init);
          }) as typeof fetch;
          try {
            await Deno.mkdir(join(tmpDir, "abort-fetch-series", "abort-fetch-story"), {
              recursive: true,
            });
            const ws = await openWs(addr);
            await authenticate(ws);
            try {
              ws.send(JSON.stringify({
                type: "chat:send",
                id: "abort-during-fetch-1",
                series: "abort-fetch-series",
                story: "abort-fetch-story",
                message: "hi",
              }));
              // Yield so the server registers the AbortController in its map.
              await new Promise((r) => setTimeout(r, 50));
              ws.send(JSON.stringify({ type: "chat:abort", id: "abort-during-fetch-1" }));

              // Read messages and explicitly fail if a chat:error arrives before
              // chat:aborted (the bug we are guarding against).
              let sawAborted = false;
              for (let i = 0; i < 6 && !sawAborted; i++) {
                const msg = await readMessage(ws, 2500);
                if (msg.type === "chat:error") {
                  throw new Error(
                    `regression: received chat:error before chat:aborted (detail=${
                      String(msg.detail)
                    })`,
                  );
                }
                if (msg.type === "chat:aborted") {
                  assertEquals(msg.id, "abort-during-fetch-1");
                  sawAborted = true;
                  break;
                }
              }
              assertEquals(sawAborted, true, "expected chat:aborted message");
            } finally {
              ws.close();
              await waitForClose(ws);
            }
          } finally {
            globalThis.fetch = originalFetch;
          }
        },
      );

      // ── 8.6: Connection lifecycle ──

      await t.step("connection closes cleanly", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);
        ws.close();
        const closeEvt = await waitForClose(ws);
        // 1000 = normal closure, 1005 = no status received (Deno WebSocket impl detail)
        assertEquals([1000, 1005].includes(closeEvt.code), true);
      });

      // ── 8.7: JSON protocol ──

      await t.step("malformed JSON returns error", async () => {
        const ws = await openWs(addr);
        ws.send("not-json{{{");
        const msg = await readMessage(ws);
        assertEquals(msg.type, "error");
        assertEquals(msg.detail, "Invalid JSON");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("JSON without type field returns error", async () => {
        const ws = await openWs(addr);
        ws.send(JSON.stringify({ foo: "bar" }));
        const msg = await readMessage(ws);
        assertEquals(msg.type, "error");
        assertEquals(msg.detail, "Invalid JSON");
        ws.close();
        await waitForClose(ws);
      });

      await t.step("unknown type after auth is silently ignored", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({ type: "totally-unknown" }));
        let gotMessage = false;
        try {
          await readMessage(ws, 500);
          gotMessage = true;
        } catch {
          // Timeout expected: unknown types produce no response
        }
        assertEquals(gotMessage, false);
        ws.close();
        await waitForClose(ws);
      });
    } finally {
      await server.shutdown();
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "ws auth-deadline (Finding 3)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "ws-deadline-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key-for-validation");
    // Short deadline so the test is fast; pre-auth messages must not extend it.
    Deno.env.set("WS_AUTH_DEADLINE_MS", "600");

    const app = makeWsApp(tmpDir);
    const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
    const addr = server.addr;

    try {
      const ws = await openWs(addr);
      // The client authenticates never; sending periodic *valid-JSON, non-auth*
      // frames does NOT reset the auth deadline. But a non-auth frame closes 4001
      // immediately per the protocol rule, so to isolate the deadline we send
      // nothing and just wait — the deadline must fire with 4002.
      const closeEvt = await waitForClose(ws, 3000);
      assertEquals(closeEvt.code, 4002);
    } finally {
      Deno.env.delete("WS_AUTH_DEADLINE_MS");
      await server.shutdown();
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "ws concurrent-connection cap (Finding 3)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "ws-cap-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key-for-validation");
    Deno.env.set("MAX_WS_CONNECTIONS", "2");
    // Generous auth deadline so it doesn't interfere with the cap assertions.
    Deno.env.set("WS_AUTH_DEADLINE_MS", "10000");

    const app = makeWsApp(tmpDir);
    const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
    const addr = server.addr;

    try {
      // Fill the cap (2 connections), authenticating each so they stay open.
      const ws1 = await openWs(addr);
      await authenticate(ws1);
      const ws2 = await openWs(addr);
      await authenticate(ws2);

      // Third connection is over the cap → server closes it with 1013.
      const ws3 = await openWs(addr);
      const closeEvt3 = await waitForClose(ws3, 3000);
      assertEquals(closeEvt3.code, 1013);

      // Free a slot; a new connection now succeeds (counter recovered).
      ws1.close();
      await waitForClose(ws1);
      // Small settle so onClose runs on the server before we reopen.
      await new Promise((r) => setTimeout(r, 100));

      const ws4 = await openWs(addr);
      await authenticate(ws4);
      ws4.close();
      await waitForClose(ws4);
      ws2.close();
      await waitForClose(ws2);

      // After all sockets close, the live count returns to 0 (no leak).
      await new Promise((r) => setTimeout(r, 150));
      assertEquals(getLiveWsConnectionCount(), 0);
    } finally {
      Deno.env.delete("MAX_WS_CONNECTIONS");
      Deno.env.delete("WS_AUTH_DEADLINE_MS");
      await server.shutdown();
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "ws live-count released on abnormal pre-auth closes (Finding 3)",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "ws-leak-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key-for-validation");
    Deno.env.set("WS_AUTH_DEADLINE_MS", "10000");

    const app = makeWsApp(tmpDir);
    const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
    const addr = server.addr;

    try {
      // Failed auth → 4001
      const wsBad = await openWs(addr);
      wsBad.send(JSON.stringify({ type: "auth", passphrase: "wrong" }));
      await waitForClose(wsBad);

      // Oversized pre-auth → 1009
      const wsBig = await openWs(addr);
      wsBig.send(JSON.stringify({ type: "auth", passphrase: "x".repeat(5000) }));
      await waitForClose(wsBig);

      // Binary pre-auth → 1003
      const wsBin = await openWs(addr);
      wsBin.send(new Uint8Array(6000));
      await waitForClose(wsBin);

      // Each admitted then released exactly once — count back to 0.
      await new Promise((r) => setTimeout(r, 150));
      assertEquals(getLiveWsConnectionCount(), 0);
    } finally {
      Deno.env.delete("WS_AUTH_DEADLINE_MS");
      await server.shutdown();
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  },
});
