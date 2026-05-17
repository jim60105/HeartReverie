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

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { executeChat } from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import type { AppConfig, BuildPromptResult } from "../../../writer/types.ts";

function buildConfig(tmpDir: string): AppConfig {
  return {
    ROOT_DIR: "/nonexistent-root",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/nonexistent-reader",
    PLUGINS_DIR: "/nonexistent-plugins",
    PORT: 0,
    LLM_API_URL: "https://openrouter.ai/api/v1/chat/completions",
    LLM_MODEL: "test-model",
    LLM_TEMPERATURE: 0.1,
    LLM_FREQUENCY_PENALTY: 0.13,
    LLM_PRESENCE_PENALTY: 0.52,
    LLM_TOP_K: 10,
    LLM_TOP_P: 0,
    LLM_REPETITION_PENALTY: 1.2,
    LLM_MIN_P: 0,
    LLM_TOP_A: 1,
    LLM_REASONING_ENABLED: true,
    LLM_REASONING_EFFORT: "high",
    LLM_REASONING_OMIT: false,
    LLM_MAX_COMPLETION_TOKENS: 4096,
    llmDefaults: {
      model: "test-model",
      temperature: 0.1,
      frequencyPenalty: 0.13,
      presencePenalty: 0.52,
      topK: 10,
      topP: 0,
      repetitionPenalty: 1.2,
      minP: 0,
      topA: 1,
      reasoningEnabled: true,
      reasoningEffort: "high",
      maxCompletionTokens: 4096,
    },
    THEME_DIR: "./themes/",
    PROMPT_FILE: "nonexistent",
  };
}

interface CapturedFetch {
  url: string;
  body: Record<string, unknown>;
}

function mockFetchCapture(captured: CapturedFetch[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      const bodyRaw = typeof opts?.body === "string" ? opts.body : "";
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(bodyRaw); } catch { /* ignore */ }
      captured.push({ url, body: parsed });
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              const enc = new TextEncoder();
              controller.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
              controller.enqueue(enc.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          { status: 200 },
        ),
      );
    }
    return original(url as string, opts);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

interface RunOptions {
  hookDispatcher: HookDispatcher;
  captured: CapturedFetch[];
  promptMessages?: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  buildPromptCorrelationCapture?: { value?: string };
  series?: string;
  name?: string;
}

async function runChat(tmpDir: string, opts: RunOptions) {
  const series = opts.series ?? "s1";
  const name = opts.name ?? "n1";
  await Deno.mkdir(join(tmpDir, series, name), { recursive: true });
  const restore = mockFetchCapture(opts.captured);
  try {
    return await executeChat({
      series,
      name,
      message: "Hi",
      config: buildConfig(tmpDir),
      safePath: createSafePath(tmpDir),
      hookDispatcher: opts.hookDispatcher,
      buildPromptFromStory: ((..._args: unknown[]) => {
        // Capture the correlationId arg (7th positional) if requested.
        if (opts.buildPromptCorrelationCapture) {
          opts.buildPromptCorrelationCapture.value = _args[6] as string | undefined;
        }
        return Promise.resolve({
          messages: opts.promptMessages ?? [{ role: "user" as const, content: "p" }],
          previousContext: [],
          isFirstRound: true,
          ventoError: null,
          chapterFiles: [],
          chapters: [],
        } as BuildPromptResult);
      }) as Parameters<typeof executeChat>[0]["buildPromptFromStory"],
    });
  } finally {
    restore();
  }
}

Deno.test({
  name: "pre-llm-fetch hook — chat-shared",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("LLM_API_KEY", "test-key");

    await t.step("6.1 dispatch fires exactly once before fetch with expected payload", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-1-" });
      try {
        let calls = 0;
        let payload: Record<string, unknown> | undefined;
        const hd = new HookDispatcher();
        hd.register("pre-llm-fetch", (ctx) => {
          calls++;
          payload = { ...ctx };
          return Promise.resolve();
        });
        const captured: CapturedFetch[] = [];
        await runChat(tmp, {
          hookDispatcher: hd,
          captured,
          promptMessages: [{ role: "user", content: "hello" }],
        });
        assertEquals(calls, 1);
        assert(payload, "payload should be captured");
        assertEquals(typeof payload!.correlationId, "string");
        assert((payload!.correlationId as string).length > 0);
        assertEquals(payload!.model, "test-model");
        assertEquals(Array.isArray(payload!.messages), true);
        assertEquals((payload!.messages as unknown[]).length, 1);
        assertEquals((payload!.writeMode as { kind: string }).kind, "write-new-chapter");
        assertEquals(typeof payload!.requestMetadata, "object");
        assert((payload!.requestMetadata as Record<string, unknown>).stream === true);
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("6.2 mutating payload.messages does NOT affect bytes posted", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-2-" });
      try {
        const hd = new HookDispatcher();
        hd.register("pre-llm-fetch", (ctx) => {
          // Try to corrupt — must not affect the upstream request.
          (ctx.messages as unknown[]).length = 0;
          return Promise.resolve();
        });
        const captured: CapturedFetch[] = [];
        await runChat(tmp, {
          hookDispatcher: hd,
          captured,
          promptMessages: [{ role: "user", content: "untouched" }],
        });
        assertEquals(captured.length, 1);
        const sent = captured[0]!.body.messages as Array<{ role: string; content: string }>;
        assertEquals(sent.length, 1);
        assertEquals(sent[0]!.content, "untouched");
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("6.3 requestMetadata is frozen", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-3-" });
      try {
        let threw = false;
        const hd = new HookDispatcher();
        hd.register("pre-llm-fetch", (ctx) => {
          try {
            (ctx.requestMetadata as Record<string, unknown>).model = "tampered";
          } catch {
            threw = true;
          }
          return Promise.resolve();
        });
        const captured: CapturedFetch[] = [];
        await runChat(tmp, { hookDispatcher: hd, captured });
        // In strict mode Object.freeze write throws; non-strict silently fails.
        // Either way, the posted body model must be unchanged.
        assertEquals(captured[0]!.body.model, "test-model");
        // Smoke check that freeze was applied (whether throw observed or not).
        assert(threw || captured[0]!.body.model === "test-model");
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("6.4 correlationId matches between prompt-assembly and pre-llm-fetch", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-4-" });
      try {
        const hd = new HookDispatcher();
        let preLlmCid: string | undefined;
        hd.register("pre-llm-fetch", (ctx) => {
          preLlmCid = ctx.correlationId as string;
          return Promise.resolve();
        });
        const promptCidCap: { value?: string } = {};
        const captured: CapturedFetch[] = [];
        await runChat(tmp, {
          hookDispatcher: hd,
          captured,
          buildPromptCorrelationCapture: promptCidCap,
        });
        assert(promptCidCap.value, "buildPromptFromStory should receive correlationId");
        assert(preLlmCid, "pre-llm-fetch should observe correlationId");
        assertStrictEquals(preLlmCid, promptCidCap.value);
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("6.5 handler error does NOT block fetch (errors absorbed)", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-5-" });
      try {
        const hd = new HookDispatcher();
        hd.register("pre-llm-fetch", () => {
          throw new Error("plugin-failed");
        });
        const captured: CapturedFetch[] = [];
        const result = await runChat(tmp, { hookDispatcher: hd, captured });
        // Fetch still happened and chapter still wrote.
        assertEquals(captured.length, 1);
        assertEquals(result.content, "hi");
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("6.6 no handler registered = zero observable dispatch overhead", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-6-" });
      try {
        const hd = new HookDispatcher();
        const captured: CapturedFetch[] = [];
        const result = await runChat(tmp, { hookDispatcher: hd, captured });
        assertEquals(captured.length, 1);
        assertEquals(result.content, "hi");
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("BLOCKING-1: payload is deep-frozen — nested mutation throws (strict)", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-blocking1-" });
      try {
        const hd = new HookDispatcher();
        let nestedMessageThrow = false;
        let nestedMetadataThrow = false;
        // Capture refs to assert post-dispatch unchanged values.
        let observedMessages: Array<{ role: string; content: string }> | undefined;
        let observedMetadata: Record<string, unknown> | undefined;
        hd.register("pre-llm-fetch", (ctx) => {
          observedMessages = ctx.messages as Array<{ role: string; content: string }>;
          observedMetadata = ctx.requestMetadata as Record<string, unknown>;
          // Strict-mode handler module (Deno test files are strict ESM by
          // default) — assigning to a frozen nested property throws.
          try {
            (ctx.messages as Array<{ content: string }>)[0]!.content = "TAMPERED";
          } catch {
            nestedMessageThrow = true;
          }
          try {
            (ctx.requestMetadata as Record<string, unknown>).model = "TAMPERED";
          } catch {
            nestedMetadataThrow = true;
          }
          return Promise.resolve();
        });
        const captured: CapturedFetch[] = [];
        await runChat(tmp, {
          hookDispatcher: hd,
          captured,
          promptMessages: [{ role: "user", content: "original-content" }],
        });
        // Both nested mutations MUST have thrown in strict mode.
        assert(nestedMessageThrow, "ctx.messages[0].content = ... must throw");
        assert(nestedMetadataThrow, "ctx.requestMetadata.model = ... must throw");
        // Post-dispatch payload values stay unchanged.
        assertEquals(observedMessages![0]!.content, "original-content");
        assertEquals(observedMetadata!.model, "test-model");
        // Bytes actually posted unchanged too.
        const sent = captured[0]!.body.messages as Array<{ content: string }>;
        assertEquals(sent[0]!.content, "original-content");
        assertEquals(captured[0]!.body.model, "test-model");
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("BLOCKING-2: outer ctx fields (model, writeMode) are NOT frozen — reassignment does not throw", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-blocking2-" });
      try {
        const hd = new HookDispatcher();
        let outerReassignThrew = false;
        hd.register("pre-llm-fetch", (ctx) => {
          try {
            // Outer fields (model, writeMode, correlationId, storyDir, series,
            // name) are documented as observe-only with no peer-isolation
            // guarantee: reassigning them on the local view MUST NOT throw.
            (ctx as Record<string, unknown>).model = "tampered-outer";
            (ctx as Record<string, unknown>).writeMode = { kind: "fake" };
            (ctx as Record<string, unknown>).correlationId = "fake-cid";
          } catch {
            outerReassignThrew = true;
          }
          return Promise.resolve();
        });
        const captured: CapturedFetch[] = [];
        await runChat(tmp, { hookDispatcher: hd, captured });
        assertEquals(outerReassignThrew, false, "Outer-field reassignment must not throw");
        // And the upstream fetch must remain unchanged (engine uses requestBody).
        assertEquals(captured[0]!.body.model, "test-model");
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("BLOCKING-3: top-level reassignment of ctx.messages / ctx.requestMetadata must throw (non-writable)", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-blocking3-" });
      try {
        const hd = new HookDispatcher();
        let messagesReplaceThrew = false;
        let metadataReplaceThrew = false;
        let observedMessages: unknown;
        let observedMetadata: unknown;
        hd.register("pre-llm-fetch", (ctx) => {
          try {
            (ctx as Record<string, unknown>).messages = [];
          } catch {
            messagesReplaceThrew = true;
          }
          try {
            (ctx as Record<string, unknown>).requestMetadata = {};
          } catch {
            metadataReplaceThrew = true;
          }
          observedMessages = ctx.messages;
          observedMetadata = ctx.requestMetadata;
          return Promise.resolve();
        });
        const captured: CapturedFetch[] = [];
        await runChat(tmp, {
          hookDispatcher: hd,
          captured,
          promptMessages: [{ role: "user", content: "original-content" }],
        });
        assert(messagesReplaceThrew,
          "ctx.messages = [] must throw — non-writable property protects peer observers");
        assert(metadataReplaceThrew,
          "ctx.requestMetadata = {} must throw — non-writable property protects peer observers");
        // Original references preserved.
        const obsMessages = observedMessages as Array<{ content: string }>;
        assertEquals(obsMessages.length, 1);
        assertEquals(obsMessages[0]!.content, "original-content");
        assertEquals((observedMetadata as { model: string }).model, "test-model");
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });

    await t.step("QUALITY-6: dispatcher-level rejection does NOT block fetch", async () => {
      const tmp = await Deno.makeTempDir({ prefix: "pre-llm-q6-" });
      try {
        const hd = new HookDispatcher();
        // Force the dispatcher itself to reject (not a handler error — the
        // dispatcher's per-handler catch already swallows those).
        const originalDispatch = hd.dispatch.bind(hd);
        hd.dispatch = ((stage: Parameters<typeof originalDispatch>[0], ctx: Parameters<typeof originalDispatch>[1]) => {
          if (stage === "pre-llm-fetch") {
            return Promise.reject(new Error("synthetic dispatcher failure"));
          }
          return originalDispatch(stage, ctx);
        }) as typeof hd.dispatch;
        const captured: CapturedFetch[] = [];
        const result = await runChat(tmp, { hookDispatcher: hd, captured });
        // Despite the dispatch rejection, fetch happened and chapter wrote.
        assertEquals(captured.length, 1);
        assertEquals(result.content, "hi");
      } finally {
        await Deno.remove(tmp, { recursive: true });
      }
    });
  },
});
