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
import type { AppDeps, AppConfig, BuildPromptResult } from "../../../writer/types.ts";
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

Deno.test({ name: "ws routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
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
    buildPromptFromStory: async () => ({
      prompt: "test prompt",
      ventoError: null,
      chapterFiles: [],
      chapters: [],
      previousContext: [],
      statusContent: "",
      isFirstRound: true,
    }) as unknown as BuildPromptResult,
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

    await t.step("auth: non-auth message before auth returns error", async () => {
      const ws = await openWs(addr);
      ws.send(JSON.stringify({ type: "subscribe", series: "s", story: "t" }));
      const msg = await readMessage(ws);
      assertEquals(msg.type, "error");
      assertEquals(msg.detail, "Not authenticated");
      ws.close();
      await waitForClose(ws);
    });

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
}});
