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

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type {
  AppConfig,
  AppDeps,
  BuildContinuePromptFn,
  BuildPromptResult,
} from "../../../writer/types.ts";
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

function openWs(addr: Deno.NetAddr): Promise<WebSocket> {
  const ws = new WebSocket(`ws://localhost:${addr.port}/api/ws`);
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(e);
  });
}

async function authenticate(ws: WebSocket): Promise<void> {
  ws.send(JSON.stringify({ type: "auth", passphrase: "test-pass" }));
  const msg = await readMessage(ws);
  assertEquals(msg.type, "auth:ok");
}

// The structured Vento payload `buildPromptFromStory` returns; `executeChat`
// converts a non-null `ventoError` into `ChatError("vento", …, 422, ventoError)`.
const VENTO_ERROR = {
  stage: "prompt-assembly",
  message: "rendered template emitted no user-role message",
  source: "system.md",
  line: null,
  title: "Missing User Message",
};

Deno.test({
  name: "ws chat:error carries structured ventoError for a template error",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmpDir = await Deno.makeTempDir({ prefix: "ws-vento-err-" });
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
      // Returning a non-null ventoError makes executeChat throw a vento ChatError.
      buildPromptFromStory: async () =>
        ({
          messages: [],
          ventoError: VENTO_ERROR,
          chapterFiles: [],
          chapters: [],
          previousContext: [],
          isFirstRound: true,
        }) as unknown as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({
        messages: [],
        ventoError: VENTO_ERROR,
        targetChapterNumber: 0,
        existingContent: "",
        userMessageText: "",
        assistantPrefill: "",
      })) as unknown as BuildContinuePromptFn,
      templateEngine: null,
      verifyPassphrase,
    } as AppDeps);

    const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
    const addr = server.addr;

    try {
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });

      await t.step("chat:send vento error → chat:error with ventoError payload", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({
          type: "chat:send",
          id: "vento-1",
          series: "s1",
          story: "n1",
          message: "hello",
        }));

        const msg = await readUntilType(ws, "chat:error");
        assertEquals(msg.id, "vento-1");
        assertEquals(msg.detail, "Template rendering error");
        assertEquals(msg.ventoError, { type: "vento-error", ...VENTO_ERROR });

        ws.close();
      });

      await t.step("chat:continue vento error → chat:error with ventoError payload", async () => {
        const ws = await openWs(addr);
        await authenticate(ws);

        ws.send(JSON.stringify({
          type: "chat:continue",
          id: "vento-2",
          series: "s1",
          story: "n1",
        }));

        const msg = await readUntilType(ws, "chat:error");
        assertEquals(msg.id, "vento-2");
        assertEquals(msg.detail, "Template rendering error");
        assertEquals(msg.ventoError, { type: "vento-error", ...VENTO_ERROR });

        ws.close();
      });
    } finally {
      await server.shutdown();
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
    }
  },
});
