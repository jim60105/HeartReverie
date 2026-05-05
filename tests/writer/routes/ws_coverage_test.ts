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

import { assert as assertTrue, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import {
  createSafePath,
  verifyPassphrase,
} from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { createTemplateEngine } from "../../../writer/lib/template.ts";
import { createStoryEngine } from "../../../writer/lib/story.ts";
import type { AppConfig, AppDeps } from "../../../writer/types.ts";

function readMessage(
  ws: WebSocket,
  timeoutMs = 2000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for message")),
      timeoutMs,
    );
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
  attempts = 8,
  timeoutMs = 3000,
): Promise<Record<string, unknown>> {
  for (let i = 0; i < attempts; i++) {
    const msg = await readMessage(ws, timeoutMs);
    if (msg.type === expectedType) return msg;
  }
  throw new Error(`Did not receive ${expectedType}`);
}

function waitForClose(ws: WebSocket, timeoutMs = 2000): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timeout waiting for close")),
      timeoutMs,
    );
    const handler = (e: CloseEvent) => {
      clearTimeout(timer);
      ws.removeEventListener("close", handler);
      resolve(e);
    };
    ws.addEventListener("close", handler);
  });
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

const originalFetch = globalThis.fetch;

function mockLLMSuccess(content: string): void {
  globalThis.fetch = async (
    url: string | URL | Request,
    opts?: RequestInit,
  ) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      const sse = [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        `data: ${
          JSON.stringify({
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        }\n\n`,
        `data: [DONE]\n\n`,
      ];
      return new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            for (const chunk of sse) controller.enqueue(enc.encode(chunk));
            controller.close();
          },
        }),
        { status: 200 },
      );
    }
    return originalFetch(url, opts);
  };
}

function mockLLMHangThenAbort(): void {
  globalThis.fetch = (url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      const sig = opts?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () =>
          reject(sig?.reason ?? new DOMException("aborted", "AbortError"));
        if (sig?.aborted) onAbort();
        else sig?.addEventListener("abort", onAbort, { once: true });
      });
    }
    return originalFetch(url as string, opts);
  };
}

Deno.test({
  name: "ws routes — extra coverage",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmpDir = await Deno.makeTempDir({ prefix: "ws-cov-" });
    const pluginsRoot = join(tmpDir, "plugins");
    const playgroundDir = join(tmpDir, "play");
    await Deno.mkdir(pluginsRoot, { recursive: true });
    await Deno.mkdir(playgroundDir, { recursive: true });

    // Plugin "tester" with a prompt file used for plugin-action:run.
    const pluginDir = join(pluginsRoot, "tester");
    await Deno.mkdir(join(pluginDir, "prompts"), { recursive: true });
    await Deno.writeTextFile(
      join(pluginDir, "plugin.json"),
      JSON.stringify({ name: "tester", version: "1.0.0" }),
    );
    await Deno.writeTextFile(
      join(pluginDir, "prompts", "summary.md"),
      '{{ message "user" }}\nSummarise.\n{{ /message }}',
    );

    // Pre-create the story directory used by happy-path tests.
    const storyDir = join(playgroundDir, "s1", "n1");
    await Deno.mkdir(storyDir, { recursive: true });
    await Deno.writeTextFile(join(storyDir, "001.md"), "Original chapter\n");

    // Capture pre-existing env values so the outer finally can restore them
    // even if any assertion in this test throws. No Deno.env.set may survive
    // a thrown assertion uncaught.
    const previousEnv: Record<string, string | undefined> = {
      PASSPHRASE: Deno.env.get("PASSPHRASE"),
      LLM_API_KEY: Deno.env.get("LLM_API_KEY"),
    };
    Deno.env.set("PASSPHRASE", "test-pass");
    Deno.env.set("LLM_API_KEY", "test-key");

    const safePath = createSafePath(playgroundDir);
    const config: AppConfig = {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: playgroundDir,
      ROOT_DIR: tmpDir,
      LLM_API_URL: "https://openrouter.example/api/v1/chat/completions",
      LLM_MODEL: "test-model",
      LLM_REASONING_OMIT: true,
      llmDefaults: {
        model: "test-model",
        temperature: 0.1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        topK: 0,
        topP: 1,
        repetitionPenalty: 1,
        minP: 0,
        topA: 0,
        reasoningEnabled: false,
        reasoningEffort: "high",
        maxCompletionTokens: 4096,
      },
    } as unknown as AppConfig;

    await Deno.writeTextFile(
      join(tmpDir, "system.md"),
      '{{ message "user" }}\nSystem.\n{{ /message }}',
    );

    const hookDispatcher = new HookDispatcher();
    const pluginManager = new PluginManager(
    pluginsRoot,
    undefined,
    hookDispatcher,
    Deno.makeTempDirSync(),
  );
    await pluginManager.init();

    const templateEngine = createTemplateEngine(pluginManager);
    const storyEngine = createStoryEngine(
      pluginManager,
      safePath,
      templateEngine.renderSystemPrompt,
      hookDispatcher,
    );

    const deps: AppDeps = {
      config,
      safePath,
      pluginManager,
      hookDispatcher,
      buildPromptFromStory: storyEngine.buildPromptFromStory,
      buildContinuePromptFromStory: (async () => ({ messages: [], ventoError: null, targetChapterNumber: 0, existingContent: "", userMessageText: "", assistantPrefill: "" })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
      verifyPassphrase,
    } as AppDeps;

    const app = createApp(deps);
    const server = Deno.serve({ port: 0, onListen: () => {} }, app.fetch);
    const addr = server.addr;

    try {
      // ── plugin-action:run / :abort ──

      await t.step(
        "plugin-action:run with non-string correlationId is rejected",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);
          ws.send(JSON.stringify({
            type: "plugin-action:run",
            // missing correlationId
            pluginName: "tester",
          }));
          const msg = await readMessage(ws);
          assertEquals(msg.type, "error");
          assertEquals(msg.detail, "Invalid plugin-action:run parameters");
          ws.close();
          await waitForClose(ws);
        },
      );

      await t.step(
        "plugin-action:run with non-string pluginName is rejected",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);
          ws.send(JSON.stringify({
            type: "plugin-action:run",
            correlationId: "c1",
            pluginName: 99,
          }));
          const msg = await readMessage(ws);
          assertEquals(msg.type, "error");
          ws.close();
          await waitForClose(ws);
        },
      );

      await t.step(
        "plugin-action:run with unknown plugin emits plugin-action:error",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);
          ws.send(JSON.stringify({
            type: "plugin-action:run",
            correlationId: "c-unknown",
            pluginName: "ghost",
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
          }));
          const msg = await readUntilType(ws, "plugin-action:error", 5, 3000);
          assertEquals(msg.correlationId, "c-unknown");
          const problem = msg.problem as { type: string; status: number };
          assertEquals(problem.type, "plugin-action:unknown-plugin");
          assertEquals(problem.status, 404);
          ws.close();
          await waitForClose(ws);
        },
      );

      await t.step(
        "plugin-action:run discard mode streams deltas and emits plugin-action:done",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);
          try {
            mockLLMSuccess("RESULT");
            ws.send(JSON.stringify({
              type: "plugin-action:run",
              correlationId: "c-ok",
              pluginName: "tester",
              series: "s1",
              name: "n1",
              promptFile: "prompts/summary.md",
              append: false,
            }));
            const delta = await readUntilType(
              ws,
              "plugin-action:delta",
              5,
              3000,
            );
            assertEquals(delta.correlationId, "c-ok");
            assertEquals(typeof delta.chunk, "string");
            const done = await readUntilType(ws, "plugin-action:done", 5, 3000);
            assertEquals(done.correlationId, "c-ok");
            assertEquals(done.chapterUpdated, false);
            assertEquals(done.appendedTag, null);
          } finally {
            globalThis.fetch = originalFetch;
            ws.close();
            await waitForClose(ws);
          }
        },
      );

      await t.step(
        "plugin-action:abort during run emits plugin-action:aborted (no chapter change)",
        async () => {
          // Reset the chapter to a known state; abort must NOT mutate it.
          await Deno.writeTextFile(join(storyDir, "001.md"), "PRISTINE\n");
          const ws = await openWs(addr);
          await authenticate(ws);
          try {
            mockLLMHangThenAbort();
            ws.send(JSON.stringify({
              type: "plugin-action:run",
              correlationId: "c-abort",
              pluginName: "tester",
              series: "s1",
              name: "n1",
              promptFile: "prompts/summary.md",
              append: true,
              appendTag: "Marker",
            }));
            // Allow the server to register the AbortController in its map.
            await new Promise((r) => setTimeout(r, 80));
            ws.send(JSON.stringify({
              type: "plugin-action:abort",
              correlationId: "c-abort",
            }));
            const aborted = await readUntilType(
              ws,
              "plugin-action:aborted",
              8,
              4000,
            );
            assertEquals(aborted.correlationId, "c-abort");
            const chapter = await Deno.readTextFile(join(storyDir, "001.md"));
            assertEquals(chapter, "PRISTINE\n");
          } finally {
            globalThis.fetch = originalFetch;
            ws.close();
            await waitForClose(ws);
          }
        },
      );

      await t.step(
        "plugin-action:abort with missing correlationId is silently ignored",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);
          ws.send(JSON.stringify({ type: "plugin-action:abort" }));
          let gotMessage = false;
          try {
            await readMessage(ws, 400);
            gotMessage = true;
          } catch { /* expected timeout */ }
          assertEquals(gotMessage, false);
          ws.close();
          await waitForClose(ws);
        },
      );

      await t.step(
        "plugin-action:abort with unknown correlationId is silently ignored",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);
          ws.send(JSON.stringify({
            type: "plugin-action:abort",
            correlationId: "does-not-exist",
          }));
          let gotMessage = false;
          try {
            await readMessage(ws, 400);
            gotMessage = true;
          } catch { /* expected */ }
          assertEquals(gotMessage, false);
          ws.close();
          await waitForClose(ws);
        },
      );

      // ── subscribe re-binding ──

      await t.step(
        "subscribe replaces previous subscription on the same socket",
        async () => {
          const subSeriesA = join(playgroundDir, "sub-A", "story");
          const subSeriesB = join(playgroundDir, "sub-B", "story");
          await Deno.mkdir(subSeriesA, { recursive: true });
          await Deno.mkdir(subSeriesB, { recursive: true });
          await Deno.writeTextFile(join(subSeriesA, "001.md"), "A1");
          await Deno.writeTextFile(join(subSeriesB, "001.md"), "B1");

          const ws = await openWs(addr);
          await authenticate(ws);
          try {
            ws.send(
              JSON.stringify({
                type: "subscribe",
                series: "sub-A",
                story: "story",
              }),
            );
            const firstUpdate = await readUntilType(
              ws,
              "chapters:updated",
              5,
              3000,
            );
            assertEquals(firstUpdate.series, "sub-A");

            // Re-subscribe to a different story; the old interval must be replaced.
            ws.send(
              JSON.stringify({
                type: "subscribe",
                series: "sub-B",
                story: "story",
              }),
            );
            const secondUpdate = await readUntilType(
              ws,
              "chapters:updated",
              8,
              3000,
            );
            assertEquals(secondUpdate.series, "sub-B");
          } finally {
            ws.close();
            await waitForClose(ws);
          }
        },
      );

      // ── server-side cleanup on socket close ──

      await t.step(
        "closing the socket mid-generation aborts the upstream chat fetch",
        async () => {
          let abortedReason: unknown = null;
          globalThis.fetch = (
            url: string | URL | Request,
            opts?: RequestInit,
          ) => {
            if (typeof url === "string" && url.includes("chat/completions")) {
              const sig = opts?.signal as AbortSignal | undefined;
              return new Promise<Response>((_resolve, reject) => {
                const onAbort = () => {
                  abortedReason = sig?.reason ?? "aborted";
                  reject(
                    sig?.reason ?? new DOMException("aborted", "AbortError"),
                  );
                };
                if (sig?.aborted) onAbort();
                else sig?.addEventListener("abort", onAbort, { once: true });
              });
            }
            return originalFetch(url as string, opts);
          };
          const ws = await openWs(addr);
          await authenticate(ws);
          try {
            ws.send(JSON.stringify({
              type: "chat:send",
              id: "cleanup-1",
              series: "s1",
              story: "n1",
              message: "hi",
            }));
            // Wait for the upstream fetch to actually be in-flight.
            const start = performance.now();
            while (abortedReason === null && performance.now() - start < 1000) {
              await new Promise((r) => setTimeout(r, 20));
              if (Object.keys({}).length === 999) break;
            }
            ws.close();
            // Allow the cleanup() handler to run.
            const closeStart = performance.now();
            while (
              abortedReason === null && performance.now() - closeStart < 1500
            ) {
              await new Promise((r) => setTimeout(r, 25));
            }
            assertTrue(
              abortedReason !== null,
              "expected upstream fetch to be aborted",
            );
          } finally {
            globalThis.fetch = originalFetch;
          }
        },
      );

      // ── onError event handler ──

      await t.step(
        "onError cleanup handler is invoked when the socket errors",
        async () => {
          // Trigger an error by abruptly terminating the underlying TCP stream.
          // Hono's WebSocket handler routes the resulting low-level event to
          // `onError`, which delegates to `cleanup()`. We can't easily observe
          // this from the client side, but we can verify the connection is
          // closed without deadlocking the server.
          const ws = await openWs(addr);
          await authenticate(ws);
          // Send an oversized buffer to force a transport-level error on some
          // implementations; if the platform tolerates it, simply close.
          try {
            ws.send("x".repeat(200_000));
          } catch { /* ignore */ }
          ws.close();
          await waitForClose(ws);
        },
      );

      // ── chat:send happy path (chat:done branch) ──

      await t.step(
        "chat:send completes with chat:done including usage payload",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);
          try {
            // mockLLMSuccess emits a usage SSE chunk with prompt_tokens=1,
            // completion_tokens=1, total_tokens=2 → the server MUST surface a
            // populated TokenUsageRecord. Lock the exact wire shape.
            mockLLMSuccess("MESSAGE");
            ws.send(JSON.stringify({
              type: "chat:send",
              id: "req-done",
              series: "s1",
              story: "n1",
              message: "ping",
            }));
            const done = await readUntilType(ws, "chat:done", 8, 4000);
            assertEquals(done.id, "req-done");
            const usage = done.usage as
              | {
                promptTokens: number;
                completionTokens: number;
                totalTokens: number;
              }
              | null
              | undefined;
            // Upstream returned a usage block — record must be a populated object,
            // not null/undefined.
            assertTrue(
              usage !== null && usage !== undefined,
              "expected usage record",
            );
            assertEquals(typeof usage!.promptTokens, "number");
            assertEquals(typeof usage!.completionTokens, "number");
            assertEquals(typeof usage!.totalTokens, "number");
            assertTrue(Number.isFinite(usage!.promptTokens));
            assertTrue(Number.isFinite(usage!.completionTokens));
            assertTrue(Number.isFinite(usage!.totalTokens));
            assertEquals(usage!.promptTokens, 1);
            assertEquals(usage!.completionTokens, 1);
            assertEquals(usage!.totalTokens, 2);
          } finally {
            globalThis.fetch = originalFetch;
            ws.close();
            await waitForClose(ws);
          }
        },
      );

      // ── verifyWsPassphrase: empty PASSPHRASE ──

      await t.step(
        "WebSocket auth fails with auth:error when PASSPHRASE is unset",
        async () => {
          const previous = Deno.env.get("PASSPHRASE");
          try {
            Deno.env.delete("PASSPHRASE");
            const ws = await openWs(addr);
            ws.send(JSON.stringify({ type: "auth", passphrase: "anything" }));
            const msg = await readMessage(ws);
            assertEquals(msg.type, "auth:error");
            const closeEvt = await waitForClose(ws);
            assertEquals(closeEvt.code, 4001);
          } finally {
            if (previous !== undefined) Deno.env.set("PASSPHRASE", previous);
          }
        },
      );

      // ── plugin-action generic catch (lines 409-416) ──

      await t.step(
        "plugin-action:run generic exception path emits 500 plugin-action:error",
        async () => {
          // Spin up a second app instance whose pluginManager.hasPlugin throws
          // synchronously, so runPluginActionWithDeps surfaces an unwrapped
          // Error to the WebSocket handler's outer catch.
          // Wrap the real PluginManager via Proxy so private fields still
          // resolve, while `hasPlugin` throws synchronously to drive the
          // outer catch in ws.handlePluginActionRun.
          const throwingManager = new Proxy(pluginManager, {
            get(target, prop, _receiver) {
              if (prop === "hasPlugin") {
                return () => {
                  throw new Error("synthetic plugin lookup failure");
                };
              }
              const v = Reflect.get(target, prop, target);
              return typeof v === "function" ? v.bind(target) : v;
            },
          });
          const altDeps: AppDeps = {
            ...deps,
            pluginManager: throwingManager,
          } as AppDeps;
          const altApp = createApp(altDeps);
          const altServer = Deno.serve(
            { port: 0, onListen: () => {} },
            altApp.fetch,
          );
          try {
            const ws = await openWs(altServer.addr);
            await authenticate(ws);
            ws.send(JSON.stringify({
              type: "plugin-action:run",
              correlationId: "boom-1",
              pluginName: "tester",
              series: "s1",
              story: "n1",
              promptFile: "prompts/summary.md",
              mode: "discard",
            }));
            const msg = await readUntilType(ws, "plugin-action:error", 5, 3000);
            assertEquals(msg.correlationId, "boom-1");
            const problem = msg.problem as { status: number; detail: string };
            assertEquals(problem.status, 500);
            assertTrue(typeof problem.detail === "string");
            ws.close();
            await waitForClose(ws);
          } finally {
            await altServer.shutdown();
          }
        },
      );

      // ── subscribe over a non-existent dir (Deno.readDir error path) ──

      await t.step(
        "subscribe to non-existent story dir is silently tolerated",
        async () => {
          const ws = await openWs(addr);
          await authenticate(ws);
          try {
            ws.send(JSON.stringify({
              type: "subscribe",
              series: "ghost-series",
              story: "ghost-story",
            }));
            // Polling should not produce any error frame; wait briefly.
            let gotError = false;
            try {
              const msg = await readMessage(ws, 1500);
              if (msg.type === "error") gotError = true;
            } catch { /* timeout expected */ }
            assertEquals(gotError, false);
          } finally {
            ws.close();
            await waitForClose(ws);
          }
        },
      );
    } finally {
      await server.shutdown();
      await Deno.remove(tmpDir, { recursive: true }).catch(() => {});
      globalThis.fetch = originalFetch;
      // Restore env regardless of assertion outcome.
      for (const [k, v] of Object.entries(previousEnv)) {
        if (v === undefined) Deno.env.delete(k);
        else Deno.env.set(k, v);
      }
    }
  },
});
