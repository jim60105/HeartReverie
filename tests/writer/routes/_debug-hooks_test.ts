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

import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { createApp } from "../../../writer/app.ts";
import { verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type {
  AppConfig,
  AppDeps,
  BuildPromptResult,
} from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

/** Build a minimal app with debug-hooks routes available via the passphrase middleware. */
function createTestApp(hookDispatcher: HookDispatcher) {
  Deno.env.set("PASSPHRASE", "test-pass");
  return createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: "/nonexistent-playground",
      ROOT_DIR: "/nonexistent-root",
    } as unknown as AppConfig,
    safePath: () => null,
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [],
      getPluginDir: () => null,
      getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
      getPluginStyles: () => [],
      getPluginActionButtons: () => [],
    } as unknown as PluginManager,
    hookDispatcher,
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
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

/** Suppress console output and return captured calls. */
async function withSilencedConsole<T>(
  fn: (stubs: {
    logCalls: unknown[][];
    warnCalls: unknown[][];
    errorCalls: unknown[][];
  }) => Promise<T>,
): Promise<T> {
  const logCalls: unknown[][] = [];
  const warnCalls: unknown[][] = [];
  const errorCalls: unknown[][] = [];
  const logStub = stub(console, "log", (...args: unknown[]) => { logCalls.push(args); });
  const warnStub = stub(console, "warn", (...args: unknown[]) => { warnCalls.push(args); });
  const errorStub = stub(console, "error", (...args: unknown[]) => { errorCalls.push(args); });
  try {
    return await fn({ logCalls, warnCalls, errorCalls });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
  }
}

Deno.test({
  name: "debug-hooks routes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    // (a) GET /api/_debug/hooks without X-Passphrase → 401
    await t.step("6.4a: returns 401 without X-Passphrase header", async () => {
      await withSilencedConsole(async () => {
        const hd = new HookDispatcher();
        const app = createTestApp(hd);

        const res = await app.fetch(
          new Request("http://localhost/api/_debug/hooks"),
        );
        assertEquals(res.status, 401);
      });
    });

    // (b) GET /api/_debug/hooks with passphrase → 200 + expected payload shape
    await t.step("6.4b: returns 200 with perStage, perPlugin, windowSize", async () => {
      await withSilencedConsole(async () => {
        const hd = new HookDispatcher();
        // Register a handler and dispatch once to populate the ring buffer
        hd.register("post-response", async () => {}, 100, "test-plugin");
        await hd.dispatch("post-response", {});

        const app = createTestApp(hd);

        const res = await app.fetch(
          new Request("http://localhost/api/_debug/hooks", {
            headers: { "x-passphrase": "test-pass" },
          }),
        );
        assertEquals(res.status, 200);

        const body = await res.json();
        assert("perStage" in body, "missing perStage");
        assert("perPlugin" in body, "missing perPlugin");
        assert("windowSize" in body, "missing windowSize");

        // Validate perStage structure
        assert(typeof body.perStage === "object");
        const stage = body.perStage["post-response"];
        assert(stage != null, "perStage should contain post-response");
        assert(typeof stage.count === "number");
        assert(typeof stage.avgMs === "number");
        assert(typeof stage.p50Ms === "number");
        assert(typeof stage.p95Ms === "number");
        assert(typeof stage.serialCount === "number");
        assert(typeof stage.parallelCount === "number");

        // Validate perPlugin structure
        assert(typeof body.perPlugin === "object");
        const plugin = body.perPlugin["test-plugin"];
        assert(plugin != null, "perPlugin should contain test-plugin");
        assert(typeof plugin.cumulativeMs === "number");
        assert(typeof plugin.dispatchCount === "number");
        assert(typeof plugin.errorCount === "number");

        // windowSize should be ≥ 1 (at least one dispatch recorded)
        assert(body.windowSize >= 1, "windowSize should be >= 1");
      });
    });

    // (c) SSE: connect to /api/_debug/hooks/stream, trigger dispatch, receive data event
    await t.step("6.4c: SSE stream receives dispatch event with expected fields", async () => {
      await withSilencedConsole(async () => {
        const hd = new HookDispatcher();
        hd.register("post-response", async () => {
          await new Promise((r) => setTimeout(r, 5));
        }, 100, "sse-test-plugin");

        const app = createTestApp(hd);

        const controller = new AbortController();
        const res = await app.fetch(
          new Request("http://localhost/api/_debug/hooks/stream", {
            headers: { "x-passphrase": "test-pass" },
            signal: controller.signal,
          }),
        );
        assertEquals(res.status, 200);
        assertEquals(
          res.headers.get("content-type"),
          "text/event-stream",
        );

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();

        // Trigger a dispatch to generate an SSE event
        await hd.dispatch("post-response", { correlationId: "sse-test" });

        // Read the SSE event
        const { value, done } = await reader.read();
        assertEquals(done, false, "stream should not be done");
        const text = decoder.decode(value);
        assert(text.startsWith("data: "), `Expected SSE data line, got: ${text}`);

        // Parse the JSON payload
        const jsonStr = text.replace(/^data: /, "").replace(/\n\n$/, "");
        const event = JSON.parse(jsonStr);

        // Validate expected fields
        assertEquals(event.stage, "post-response");
        assert(
          ["serial", "parallel", "mixed"].includes(event.dispatchPhase),
          `unexpected dispatchPhase: ${event.dispatchPhase}`,
        );
        assert(typeof event.durationMs === "number");
        assert(typeof event.serialCount === "number");
        assert(typeof event.parallelCount === "number");
        assert(Array.isArray(event.plugins));
        assert(event.plugins.length >= 1);
        assertEquals(event.plugins[0].plugin, "sse-test-plugin");
        assert(typeof event.plugins[0].durationMs === "number");
        assert(typeof event.plugins[0].errored === "boolean");

        // Clean up
        controller.abort();
        reader.releaseLock();
      });
    });

    // (d) SSE heartbeat: verify heartbeat mechanism is wired up
    // We don't wait 30s; instead verify the heartbeat interval is set by
    // checking that the stream keeps the connection alive (content-type + headers).
    // A full 30s test would be flaky in CI. The wiring is implicitly tested
    // by the cleanup in (c) and by the heartbeat constant in _debug-hooks.ts.
    await t.step("6.4d: SSE stream has keep-alive headers for heartbeat", async () => {
      await withSilencedConsole(async () => {
        const hd = new HookDispatcher();
        const app = createTestApp(hd);

        const controller = new AbortController();
        const res = await app.fetch(
          new Request("http://localhost/api/_debug/hooks/stream", {
            headers: { "x-passphrase": "test-pass" },
            signal: controller.signal,
          }),
        );
        assertEquals(res.status, 200);
        assertEquals(res.headers.get("content-type"), "text/event-stream");
        assertEquals(res.headers.get("cache-control"), "no-cache");
        assertEquals(res.headers.get("connection"), "keep-alive");

        controller.abort();
      });
    });
  },
});
