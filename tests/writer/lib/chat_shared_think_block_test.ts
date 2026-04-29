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

import { assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ChatAbortError, ChatError, executeChat } from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import { _resetLogger, initLogger } from "../../../writer/lib/logger.ts";
import type { AppConfig, BuildPromptResult } from "../../../writer/types.ts";

function buildConfig(tmpDir: string): AppConfig {
  return {
    ROOT_DIR: "/x",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/x",
    PLUGINS_DIR: "/x",
    PORT: 0,
    CERT_FILE: undefined,
    KEY_FILE: undefined,
    LLM_API_URL: "https://example.test/chat/completions",
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
    },
    BACKGROUND_IMAGE: "/bg",
    PROMPT_FILE: "x",
  } as unknown as AppConfig;
}

function mockFetchFromChunks(chunks: string[]): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      return Promise.resolve(new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            for (const c of chunks) controller.enqueue(enc.encode(c));
            controller.close();
          },
        }),
        { status: 200 },
      ));
    }
    return original(url as string, opts);
  }) as typeof fetch;
  return () => { globalThis.fetch = original; };
}

interface RunOpts {
  chunks: string[];
  hookDispatcher?: HookDispatcher;
  onDelta?: (s: string) => void;
  signal?: AbortSignal;
}

async function runChat(tmpDir: string, opts: RunOpts) {
  await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
  const restore = mockFetchFromChunks(opts.chunks);
  try {
    return await executeChat({
      series: "s1",
      name: "n1",
      message: "Hi",
      config: buildConfig(tmpDir),
      safePath: createSafePath(tmpDir),
      hookDispatcher: opts.hookDispatcher ?? new HookDispatcher(),
      buildPromptFromStory: (() => Promise.resolve({
        prompt: "test prompt",
        previousContext: [],
        isFirstRound: true,
        ventoError: null,
        chapterFiles: [],
        chapters: [],
      } as BuildPromptResult)),
      onDelta: opts.onDelta,
      signal: opts.signal,
    });
  } finally {
    restore();
  }
}

Deno.test({
  name: "reasoning think-block – chat-shared streaming",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("LLM_API_KEY", "test-key");

    await t.step("6.1.2 content-only stream is byte-identical to baseline", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-content-only-" });
      try {
        const result = await runChat(tmpDir, {
          chunks: [
            'data: {"choices":[{"delta":{"content":"Hello "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        assertEquals(result.content, "Hello world");
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "Hello world");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.3 reasoning then content: canonical byte order, content excludes <think>", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-reason-then-content-" });
      try {
        const deltas: string[] = [];
        const result = await runChat(tmpDir, {
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"reasoning":"Let me think. "}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning":"Three rs."}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"There are "}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"three rs."}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "<think>\nLet me think. Three rs.\n</think>\n\nThere are three rs.");
        // ChatResult.content excludes the <think> block (no preContent here since
        // user-message plugin is not registered in this test).
        assertEquals(result.content, "There are three rs.");
        // onDelta receives the framing verbatim, in order.
        assertEquals(deltas[0], "<think>\n");
        assertEquals(deltas[1], "Let me think. ");
        assertEquals(deltas[2], "Three rs.");
        assertEquals(deltas[3], "\n</think>\n\n");
        assertEquals(deltas[4], "There are ");
        assertEquals(deltas[5], "three rs.");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.4 interleaved reasoning ↔ content emits multiple <think> blocks", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-interleaved-" });
      try {
        await runChat(tmpDir, {
          chunks: [
            'data: {"choices":[{"delta":{"reasoning":"A"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"X"}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning":"B"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"Y"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "<think>\nA\n</think>\n\nX<think>\nB\n</think>\n\nY");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.5 single SSE chunk with both reasoning and content: reasoning → close → content", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-single-chunk-" });
      try {
        const deltas: string[] = [];
        await runChat(tmpDir, {
          onDelta: (d) => deltas.push(d),
          chunks: [
            'data: {"choices":[{"delta":{"reasoning":"A","content":"X"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "<think>\nA\n</think>\n\nX");
        assertEquals(deltas, ["<think>\n", "A", "\n</think>\n\n", "X"]);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.1 reasoning-only stream throws no-content but closes <think>", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-reason-only-" });
      try {
        const err = await assertRejects(
          () => runChat(tmpDir, {
            chunks: [
              'data: {"choices":[{"delta":{"reasoning":"only-thinking"}}]}\n\n',
              "data: [DONE]\n\n",
            ],
          }),
          ChatError,
        );
        assertEquals(err.code, "no-content");
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "<think>\nonly-thinking\n</think>\n");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.6 abort during reasoning closes the <think> block", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-abort-reasoning-" });
      try {
        // Controllable fetch stub that wires the AbortSignal to the underlying
        // ReadableStream so reader.read() rejects when the client aborts.
        const original = globalThis.fetch;
        let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
        const enc = new TextEncoder();
        // Local alias avoids `null` narrowing when accessed across closure boundaries.
        const setController = (c: ReadableStreamDefaultController<Uint8Array>) => { controller = c; };
        globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
          if (typeof url === "string" && url.includes("chat/completions")) {
            const sig = (init?.signal as AbortSignal | undefined) ?? null;
            const stream = new ReadableStream<Uint8Array>({
              start(c) {
                setController(c);
                if (sig) {
                  const onAbort = () => {
                    try { c.error(sig.reason ?? new DOMException("aborted", "AbortError")); } catch { /* */ }
                  };
                  if (sig.aborted) onAbort();
                  else sig.addEventListener("abort", onAbort, { once: true });
                }
              },
            });
            return Promise.resolve(new Response(stream, { status: 200 }));
          }
          return original(url as string, init);
        }) as typeof fetch;

        try {
          const ctrl = new AbortController();
          let firstSeen = false;
          const onDelta = (s: string): void => {
            // Once we see the reasoning text, abort the client. The
            // controllable stub's abort handler then errors the stream so the
            // narrow catch around `reader.read()` observes signal.aborted=true.
            if (s === "partial-reasoning" && !firstSeen) {
              firstSeen = true;
              queueMicrotask(() => ctrl.abort());
            }
          };

          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const promise = executeChat({
            series: "s1",
            name: "n1",
            message: "Hi",
            config: buildConfig(tmpDir),
            safePath: createSafePath(tmpDir),
            hookDispatcher: new HookDispatcher(),
            buildPromptFromStory: (() => Promise.resolve({
              prompt: "p",
              previousContext: [],
              isFirstRound: true,
              ventoError: null,
              chapterFiles: [],
              chapters: [],
            } as BuildPromptResult)),
            signal: ctrl.signal,
            onDelta,
          });
          // Yield to let executeChat open the file and start reading.
          await new Promise((r) => setTimeout(r, 10));
          (controller as ReadableStreamDefaultController<Uint8Array> | null)?.enqueue(enc.encode('data: {"choices":[{"delta":{"reasoning":"partial-reasoning"}}]}\n\n'));
          await assertRejects(() => promise, ChatAbortError);
        } finally {
          globalThis.fetch = original;
        }

        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        // Streaming finally must have closed the <think> block before file.close().
        assertEquals(onDisk, "<think>\npartial-reasoning\n</think>\n");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.7 mid-stream error during reasoning closes <think> and throws ChatError", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-stream-err-reasoning-" });
      try {
        const err = await assertRejects(
          () => runChat(tmpDir, {
            chunks: [
              'data: {"choices":[{"delta":{"reasoning":"thinking"}}]}\n\n',
              'data: {"error":{"message":"upstream-fail","code":429}}\n\n',
            ],
          }),
          ChatError,
        );
        assertEquals(err.code, "llm-stream");
        assertEquals(err.httpStatus, 502);
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "<think>\nthinking\n</think>\n");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.9 malformed reasoning_details: no <think> emitted, content streams normally", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-malformed-details-" });
      try {
        await runChat(tmpDir, {
          chunks: [
            'data: {"choices":[{"delta":{"reasoning_details":123,"content":"answer"}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_details":[{"signature":"opaque-only"},{"text":42}]}}]}\n\n',
            'data: {"choices":[{"delta":{"reasoning_details":[{"text":""}]}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "answer");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.2 response-stream hook is NOT dispatched for reasoning deltas", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-hook-bypass-" });
      try {
        const seen: string[] = [];
        const hd = new HookDispatcher();
        hd.register("response-stream", (ctx) => {
          seen.push(ctx.chunk as string);
          ctx.chunk = (ctx.chunk as string).toUpperCase();
          return Promise.resolve();
        });
        await runChat(tmpDir, {
          hookDispatcher: hd,
          chunks: [
            'data: {"choices":[{"delta":{"reasoning":"thinking"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        // Hook saw only the content delta, not the reasoning delta.
        assertEquals(seen, ["answer"]);
        // Reasoning text is preserved lowercase on disk (hook didn't run on it);
        // content is uppercased by the hook.
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "<think>\nthinking\n</think>\n\nANSWER");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.8 reasoning_details fallback: text fields concatenated, signature ignored", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-details-fallback-" });
      try {
        await runChat(tmpDir, {
          chunks: [
            'data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.text","text":"step-1 "},{"type":"reasoning.signature","signature":"opaque"},{"type":"reasoning.text","text":"step-2"}]}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"done"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "<think>\nstep-1 step-2\n</think>\n\ndone");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.10 priority: delta.reasoning wins over reasoning_details", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-priority-" });
      try {
        await runChat(tmpDir, {
          chunks: [
            'data: {"choices":[{"delta":{"reasoning":"direct","reasoning_details":[{"text":"fallback"}]}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
            "data: [DONE]\n\n",
          ],
        });
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        // Only the direct text appears in <think>, the fallback is suppressed.
        assertEquals(onDisk, "<think>\ndirect\n</think>\n\nanswer");
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("6.1.11 reasoningLength is recorded in success and no-content log entries", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "tb-log-reasoning-len-" });
      const llmLogPath = join(tmpDir, "llm.jsonl");
      try {
        _resetLogger();
        await initLogger({ level: "error", filePath: null, llmFilePath: llmLogPath });
        try {
          // Run 1: reasoning + content → success log.
          await runChat(tmpDir, {
            chunks: [
              'data: {"choices":[{"delta":{"reasoning":"abc"}}]}\n\n',
              'data: {"choices":[{"delta":{"content":"X"}}]}\n\n',
              "data: [DONE]\n\n",
            ],
          });
          // Yield microtasks so logger flush completes.
          for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
          const text1 = await Deno.readTextFile(llmLogPath);
          const lines1 = text1.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);
          const success = lines1.find((e) => {
            const data = e.data as Record<string, unknown> | undefined;
            return data?.type === "response" && data?.aborted !== true;
          });
          const successData = success?.data as Record<string, unknown>;
          assertEquals(successData?.reasoningLength, 3);

          // Run 2: reasoning-only → no-content log.
          // Recreate the story dir since runChat creates 002.md after 001.md exists.
          await assertRejects(
            () => runChat(tmpDir, {
              chunks: [
                'data: {"choices":[{"delta":{"reasoning":"only"}}]}\n\n',
                "data: [DONE]\n\n",
              ],
            }),
            ChatError,
          );
          for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
          const text2 = await Deno.readTextFile(llmLogPath);
          const lines2 = text2.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);
          const noContent = lines2.find((e) => {
            const data = e.data as Record<string, unknown> | undefined;
            return data?.errorCode === "no-content";
          });
          const noContentData = noContent?.data as Record<string, unknown>;
          assertEquals(noContentData?.reasoningLength, 4);
        } finally {
          _resetLogger();
        }
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    Deno.env.delete("LLM_API_KEY");
  },
});
