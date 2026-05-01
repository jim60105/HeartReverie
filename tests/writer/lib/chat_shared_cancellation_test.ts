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

import { assert, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import {
  ChatAbortError,
  ChatError,
  executeChat,
} from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import { _resetLogger, initLogger } from "../../../writer/lib/logger.ts";
import type {
  AppConfig,
  BuildPromptResult,
  LlmConfig,
} from "../../../writer/types.ts";

// ── Helpers ─────────────────────────────────────────────────────

function buildConfig(tmpDir: string): AppConfig {
  const llmDefaults: LlmConfig = {
    model: "default-model",
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
  };
  return {
    ROOT_DIR: "/x",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/x",
    PLUGINS_DIR: "/x",
    PORT: 0,
    CERT_FILE: undefined,
    KEY_FILE: undefined,
    LLM_API_URL: "https://example.test/chat/completions",
    LLM_MODEL: "default-model",
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
    llmDefaults,
    BACKGROUND_IMAGE: "/bg",
    PROMPT_FILE: "x",
  } as unknown as AppConfig;
}

const buildPromptStub = () =>
  Promise.resolve({
    messages: [{ role: "user" as const, content: "p" }],
    previousContext: [],
    isFirstRound: true,
    ventoError: null,
    chapterFiles: [],
    chapters: [],
  } as BuildPromptResult);

/**
 * Stub `globalThis.fetch` so its returned Response body is a controllable
 * ReadableStream. Returns `enqueue`/`closeStream` helpers and a `restore` fn.
 */
function controllableFetchStub(): {
  restore: () => void;
  enqueue: (s: string) => void;
  closeStream: () => void;
  errorStream: (err: Error) => void;
  signalSeen: () => AbortSignal | null;
} {
  const original = globalThis.fetch;
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let signalSeenRef: AbortSignal | null = null;
  const enc = new TextEncoder();
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      signalSeenRef = (init?.signal as AbortSignal | undefined) ?? null;
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c;
          // Wire the abort signal so reader.read() rejects when the client
          // aborts — this mirrors real fetch behavior where cancelling the
          // request also cancels the body stream.
          if (signalSeenRef) {
            const sig = signalSeenRef;
            const onAbort = () => {
              try {
                c.error(sig.reason ?? new DOMException("aborted", "AbortError"));
              } catch { /* already closed */ }
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
  return {
    restore: () => { globalThis.fetch = original; },
    enqueue: (s: string) => controller?.enqueue(enc.encode(s)),
    closeStream: () => controller?.close(),
    errorStream: (err: Error) => controller?.error(err),
    signalSeen: () => signalSeenRef,
  };
}

/** Read the LLM log file (JSONL) and return parsed entries. */
async function readLlmLog(path: string): Promise<Array<Record<string, unknown>>> {
  // Yield a few microtasks so the async write queue inside the logger has a
  // chance to flush before the test inspects the file.
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5));
  let text = "";
  try {
    text = await Deno.readTextFile(path);
  } catch {
    return [];
  }
  return text.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as Record<string, unknown>);
}

async function withInitLogger(llmLogPath: string, fn: () => Promise<void>): Promise<void> {
  _resetLogger();
  await initLogger({ level: "error", filePath: null, llmFilePath: llmLogPath });
  try {
    await fn();
  } finally {
    _resetLogger();
  }
}

// ── Tests ───────────────────────────────────────────────────────

Deno.test({
  name: "chat-shared: streaming cancellation correctness",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const previousKey = Deno.env.get("LLM_API_KEY");
    Deno.env.set("LLM_API_KEY", "k");
    try {
      await t.step("abort while initial fetch is pending throws ChatAbortError and creates no chapter file", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-1-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const original = globalThis.fetch;
          // Fetch resolves only when the signal aborts (rejects with the reason).
          globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              const sig = init?.signal as AbortSignal | undefined;
              if (!sig) {
                reject(new Error("test fetch stub requires signal"));
                return;
              }
              const onAbort = () => reject(sig.reason ?? new DOMException("aborted", "AbortError"));
              if (sig.aborted) onAbort();
              else sig.addEventListener("abort", onAbort, { once: true });
            })) as typeof fetch;
          const ctrl = new AbortController();
          const promise = executeChat({
            series: "s1",
            name: "n1",
            message: "Hi",
            config: buildConfig(tmpDir),
            safePath: createSafePath(tmpDir),
            hookDispatcher: new HookDispatcher(),
            buildPromptFromStory: buildPromptStub,
            signal: ctrl.signal,
          });
          // Yield to let executeChat enter the fetch.
          await new Promise((r) => setTimeout(r, 5));
          ctrl.abort();
          try {
            await assertRejects(() => promise, ChatAbortError);
          } finally {
            globalThis.fetch = original;
          }
          // No chapter file should exist.
          let exists = true;
          try {
            await Deno.stat(join(tmpDir, "s1", "n1", "001.md"));
          } catch (err) {
            if (err instanceof Deno.errors.NotFound) exists = false;
            else throw err;
          }
          assertEquals(exists, false, "no chapter file should be created on initial-fetch abort");
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("pre-aborted controller throws ChatAbortError", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-2-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const ctrl = new AbortController();
          ctrl.abort();
          // fetch should not even be invoked by the runtime due to pre-aborted signal,
          // but we stub it to return a never-resolving promise just in case.
          const original = globalThis.fetch;
          globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
            new Promise<Response>((_, reject) => {
              const sig = init?.signal as AbortSignal | undefined;
              if (sig?.aborted) reject(sig.reason ?? new DOMException("aborted", "AbortError"));
            })) as typeof fetch;
          try {
            await assertRejects(
              () => executeChat({
                series: "s1",
                name: "n1",
                message: "Hi",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: new HookDispatcher(),
                buildPromptFromStory: buildPromptStub,
                signal: ctrl.signal,
              }),
              ChatAbortError,
            );
          } finally {
            globalThis.fetch = original;
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("abort during streaming preserves partial chapter and logs aborted=true", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-3-" });
        const llmLogPath = join(tmpDir, "llm.jsonl");
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          await withInitLogger(llmLogPath, async () => {
            const stub = controllableFetchStub();
            const ctrl = new AbortController();
            let firstSeen = false;
            const onDelta = (s: string): void => {
              if (s === "hello " && !firstSeen) {
                firstSeen = true;
                queueMicrotask(() => ctrl.abort());
              }
            };
            try {
              const promise = executeChat({
                series: "s1",
                name: "n1",
                message: "Hi",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: new HookDispatcher(),
                buildPromptFromStory: buildPromptStub,
                signal: ctrl.signal,
                onDelta,
              });
              // Push the first chunk only; abort fires inside onDelta.
              // Yield several microtasks so executeChat opens the file and starts reading.
              await new Promise((r) => setTimeout(r, 10));
              stub.enqueue('data: {"choices":[{"delta":{"content":"hello "}}]}\n\n');
              await assertRejects(() => promise, ChatAbortError);
            } finally {
              stub.restore();
            }

            const fileContent = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
            assertStringIncludes(fileContent, "hello ");
            assertEquals(fileContent.includes("world"), false, "post-abort chunks must not appear");

            const logEntries = await readLlmLog(llmLogPath);
            const abortedEntries = logEntries.filter((e) => {
              const data = e.data as Record<string, unknown> | undefined;
              return data?.aborted === true;
            });
            assert(abortedEntries.length >= 1, "expected at least one log entry with aborted: true");
          });
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("abort with custom Error reason still produces ChatAbortError", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-4-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const stub = controllableFetchStub();
          const ctrl = new AbortController();
          let firstSeen = false;
          const onDelta = (s: string): void => {
            if (s === "hello " && !firstSeen) {
              firstSeen = true;
              queueMicrotask(() => ctrl.abort(new Error("legacy custom reason")));
            }
          };
          try {
            const promise = executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub,
              signal: ctrl.signal,
              onDelta,
            });
            await new Promise((r) => setTimeout(r, 10));
            stub.enqueue('data: {"choices":[{"delta":{"content":"hello "}}]}\n\n');
            const err = await assertRejects(() => promise, ChatAbortError);
            // Confirm a fresh ChatAbortError was constructed (not the rethrown reason).
            assertEquals(err.message, "Generation aborted by client");
          } finally {
            stub.restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("mid-stream error chunk surfaces as ChatError(llm-stream)", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-5-" });
        const llmLogPath = join(tmpDir, "llm.jsonl");
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          await withInitLogger(llmLogPath, async () => {
            const stub = controllableFetchStub();
            try {
              const promise = executeChat({
                series: "s1",
                name: "n1",
                message: "Hi",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: new HookDispatcher(),
                buildPromptFromStory: buildPromptStub,
              });
              await new Promise((r) => setTimeout(r, 10));
              stub.enqueue('data: {"choices":[{"delta":{"content":"partial "}}]}\n\n');
              await new Promise((r) => setTimeout(r, 5));
              stub.enqueue('data: {"id":"x","object":"chat.completion.chunk","created":1,"error":{"message":"Provider connection lost","code":502},"choices":[{"finish_reason":"error","delta":{}}]}\n\n');
              stub.enqueue("data: [DONE]\n\n");
              stub.closeStream();
              const err = await assertRejects(() => promise, ChatError);
              assertEquals(err.code, "llm-stream");
              assertEquals(err.message, "Provider connection lost");
              assertEquals(err.httpStatus, 502);
            } finally {
              stub.restore();
            }

            const fileContent = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
            assertStringIncludes(fileContent, "partial ");

            const logEntries = await readLlmLog(llmLogPath);
            const streamErrorEntries = logEntries.filter((e) => {
              const data = e.data as Record<string, unknown> | undefined;
              return data?.errorCode === "stream-error";
            });
            assertEquals(streamErrorEntries.length, 1, "expected exactly one stream-error log entry");
            const duplicateStream = logEntries.filter((e) => {
              const data = e.data as Record<string, unknown> | undefined;
              return data?.errorCode === "stream";
            });
            assertEquals(duplicateStream.length, 0, "must not log a duplicate generic 'stream' error");
          });
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("mid-stream error without explicit message falls back to a non-empty string", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-6-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const stub = controllableFetchStub();
          try {
            const promise = executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub,
            });
            await new Promise((r) => setTimeout(r, 10));
            stub.enqueue('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
            await new Promise((r) => setTimeout(r, 5));
            stub.enqueue('data: {"error":{"code":502},"choices":[{"finish_reason":"error","delta":{}}]}\n\n');
            stub.closeStream();
            const err = await assertRejects(() => promise, ChatError);
            assertEquals(err.code, "llm-stream");
            assert(err.message.length > 0, "ChatError message must be non-empty");
          } finally {
            stub.restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("mid-stream error indicated only by finish_reason", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-7-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const stub = controllableFetchStub();
          try {
            const promise = executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub,
            });
            await new Promise((r) => setTimeout(r, 10));
            stub.enqueue('data: {"choices":[{"delta":{"content":"x"}}]}\n\n');
            await new Promise((r) => setTimeout(r, 5));
            stub.enqueue('data: {"choices":[{"finish_reason":"error","delta":{}}]}\n\n');
            stub.closeStream();
            const err = await assertRejects(() => promise, ChatError);
            assertEquals(err.code, "llm-stream");
          } finally {
            stub.restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("downstream error during streaming (non-abort) is NOT misclassified as abort", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-8-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const stub = controllableFetchStub();
          // onDelta is called inside persistChunk (outside the narrow abort
          // try around reader.read()); throwing from it must propagate as
          // itself rather than being misclassified as a client abort.
          const failingOnDelta = (_s: string): void => {
            throw new Error("simulated downstream failure");
          };
          try {
            const promise = executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub,
              onDelta: failingOnDelta,
            });
            await new Promise((r) => setTimeout(r, 10));
            stub.enqueue('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
            stub.closeStream();
            const err = await assertRejects(() => promise, Error);
            // Must NOT be misclassified as ChatAbortError or ChatError.
            assertEquals(err instanceof ChatAbortError, false, "non-abort error must not be misclassified as ChatAbortError");
            assertEquals(err instanceof ChatError, false, "non-abort error must not be wrapped as ChatError");
            assertStringIncludes(err.message, "simulated downstream failure");
          } finally {
            stub.restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("downstream error during streaming concurrent with abort is NOT misclassified as ChatAbortError", async () => {
        // Critical regression guard for the narrowed-catch design: if a
        // downstream operation (onDelta / hook / file write) throws AT THE
        // SAME TIME as the client abort, the original error MUST propagate
        // — it must NOT be silently swallowed as a ChatAbortError.
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-cancel-9-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const stub = controllableFetchStub();
          const ctrl = new AbortController();
          const concurrentOnDelta = (_s: string): void => {
            // First abort, then throw — both happen "concurrently" relative to
            // the streaming catch from the executor's point of view.
            ctrl.abort();
            throw new Error("downstream failure during abort");
          };
          try {
            const promise = executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub,
              signal: ctrl.signal,
              onDelta: concurrentOnDelta,
            });
            await new Promise((r) => setTimeout(r, 10));
            stub.enqueue('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n');
            const err = await assertRejects(() => promise, Error);
            assertEquals(
              err instanceof ChatAbortError,
              false,
              "concurrent-abort downstream error must not be silently misclassified as ChatAbortError",
            );
            assertStringIncludes(err.message, "downstream failure during abort");
          } finally {
            stub.restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });
    } finally {
      if (previousKey === undefined) {
        Deno.env.delete("LLM_API_KEY");
      } else {
        Deno.env.set("LLM_API_KEY", previousKey);
      }
    }
  },
});
