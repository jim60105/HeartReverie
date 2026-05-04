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
  executeContinue,
  streamLlmAndPersist,
} from "../../../writer/lib/chat-shared.ts";
import { ContinuePromptError } from "../../../writer/lib/story.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import type {
  AppConfig,
  ContinuePromptResult,
  LlmConfig,
} from "../../../writer/types.ts";

function buildConfig(tmpDir: string): AppConfig {
  const llmDefaults: LlmConfig = {
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
  };
  return {
    ROOT_DIR: "/nonexistent-root",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/nonexistent-reader",
    PLUGINS_DIR: "/nonexistent-plugins",
    PORT: 0,
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
    LLM_MAX_COMPLETION_TOKENS: 4096,
    llmDefaults,
    BACKGROUND_IMAGE: "/bg.webp",
    PROMPT_FILE: "nonexistent",
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

/** Wraps a chapter file path to a known story dir. */
async function setupStory(tmpDir: string, series: string, name: string, chapterContent: string): Promise<string> {
  const dir = join(tmpDir, series, name);
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "001.md"), chapterContent);
  return dir;
}

/** Build a ContinuePromptResult that matches what `buildContinuePromptFromStory` would return. */
function makePromptResult(existingContent: string, prefill: string, userMsg: string): ContinuePromptResult {
  const messages = [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: userMsg },
  ];
  if (prefill.trim().length > 0) {
    messages.push({ role: "assistant" as const, content: prefill } as never);
  }
  return {
    messages,
    ventoError: null,
    targetChapterNumber: 1,
    existingContent,
    userMessageText: userMsg,
    assistantPrefill: prefill,
  };
}

Deno.test({
  name: "executeContinue / streamLlmAndPersist – continue mode",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const previousKey = Deno.env.get("LLM_API_KEY");
    Deno.env.set("LLM_API_KEY", "test-key");

    try {
      // ───────────────────────────────────────────────────────────
      await t.step("happy path: stream content appended; chapterContentAfter = existing + streamed", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_continue_happy_" });
        try {
          const original = "<user_message>q</user_message>\n\nseed";
          await setupStory(tmpDir, "s1", "n1", original);

          let postSource: string | null = null;
          let postContent: string | null = null;
          let preWriteFired = false;
          const hd = new HookDispatcher();
          hd.register("post-response", (ctx) => {
            postSource = ctx.source as string;
            postContent = ctx.content as string;
            return Promise.resolve();
          });
          hd.register("pre-write", () => {
            preWriteFired = true;
            return Promise.resolve();
          });

          const restore = mockFetchFromChunks([
            'data: {"choices":[{"delta":{"content":" extra"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" tail"}}]}\n\n',
            "data: [DONE]\n\n",
          ]);
          try {
            const result = await executeContinue({
              series: "s1",
              name: "n1",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: hd,
              buildContinuePromptFromStory: () =>
                Promise.resolve(makePromptResult(original, "seed", "q")),
            });

            assertEquals(result.chapter, 1);
            assertEquals(
              result.content,
              original + " extra tail",
              "HTTP content must be the FULL chapter (existing + streamed bytes)",
            );
            const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
            assertEquals(onDisk, original + " extra tail");

            assertEquals(postSource, "continue", "post-response must fire with source: continue");
            assertEquals(postContent, original + " extra tail");
            assertEquals(preWriteFired, false, "pre-write must NOT fire in continue mode");
          } finally {
            restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step("<think> framing: reasoning bytes wrapped like write-new-chapter", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_continue_think_" });
        try {
          const original = "<user_message>q</user_message>\n\nseed";
          await setupStory(tmpDir, "s1", "n1", original);

          const hd = new HookDispatcher();
          const restore = mockFetchFromChunks([
            'data: {"choices":[{"delta":{"reasoning":"thinking…"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":" body"}}]}\n\n',
            "data: [DONE]\n\n",
          ]);
          try {
            await executeContinue({
              series: "s1",
              name: "n1",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: hd,
              buildContinuePromptFromStory: () =>
                Promise.resolve(makePromptResult(original, "seed", "q")),
            });

            const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
            assertStringIncludes(onDisk, "<think>\nthinking…\n</think>\n\n");
            assert(onDisk.startsWith(original), "original bytes must be preserved at file head");
            assert(onDisk.endsWith(" body"), "trailing content delta must be appended after </think>");
          } finally {
            restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step("snapshot guard: existingContent mismatch → ChatError(conflict, 409)", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_continue_conflict_" });
        try {
          const onDisk = "DIFFERENT bytes on disk";
          await setupStory(tmpDir, "s1", "n1", onDisk);

          // Snapshot guard runs after the LLM fetch in the current
          // implementation, so provide a successful empty stream upstream.
          const restore = mockFetchFromChunks(["data: [DONE]\n\n"]);
          try {
            const err = await assertRejects(
              () =>
                streamLlmAndPersist({
                  messages: [
                    { role: "system", content: "sys" },
                    { role: "user", content: "q" },
                  ],
                  llmConfig: buildConfig(tmpDir).llmDefaults,
                  series: "s1",
                  name: "n1",
                  storyDir: join(tmpDir, "s1", "n1"),
                  rootDir: "/nonexistent-root",
                  writeMode: {
                    kind: "continue-last-chapter",
                    targetChapterNumber: 1,
                    existingContent: "STALE bytes captured at parse time",
                  },
                  hookDispatcher: new HookDispatcher(),
                  config: buildConfig(tmpDir),
                }),
              ChatError,
            );
            assertEquals(err.code, "conflict");
            assertEquals(err.httpStatus, 409);
            // File unchanged on disk.
            assertEquals(await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md")), onDisk);
          } finally {
            restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step("Deno.errors.NotFound on chapter file → ChatError(no-chapter, 400)", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_continue_notfound_" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          // Deliberately do NOT create 001.md.

          const restore = mockFetchFromChunks(["data: [DONE]\n\n"]);
          try {
            const err = await assertRejects(
              () =>
                streamLlmAndPersist({
                  messages: [
                    { role: "system", content: "sys" },
                    { role: "user", content: "q" },
                  ],
                  llmConfig: buildConfig(tmpDir).llmDefaults,
                  series: "s1",
                  name: "n1",
                  storyDir: join(tmpDir, "s1", "n1"),
                  rootDir: "/nonexistent-root",
                  writeMode: {
                    kind: "continue-last-chapter",
                    targetChapterNumber: 1,
                    existingContent: "anything",
                  },
                  hookDispatcher: new HookDispatcher(),
                  config: buildConfig(tmpDir),
                }),
              ChatError,
            );
            assertEquals(err.code, "no-chapter");
            assertEquals(err.httpStatus, 400);
          } finally {
            restore();
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step("executeContinue translates ContinuePromptError(no-chapter) → ChatError(no-chapter, 400)", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_continue_xlate_nc_" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const err = await assertRejects(
            () =>
              executeContinue({
                series: "s1",
                name: "n1",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: new HookDispatcher(),
                buildContinuePromptFromStory: () => {
                  throw new ContinuePromptError("no-chapter", "no chapter", 400);
                },
              }),
            ChatError,
          );
          assertEquals(err.code, "no-chapter");
          assertEquals(err.httpStatus, 400);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      await t.step("executeContinue translates ContinuePromptError(no-content) → ChatError(no-content, 400)", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_continue_xlate_no_" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const err = await assertRejects(
            () =>
              executeContinue({
                series: "s1",
                name: "n1",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: new HookDispatcher(),
                buildContinuePromptFromStory: () => {
                  throw new ContinuePromptError("no-content", "empty chapter", 400);
                },
              }),
            ChatError,
          );
          assertEquals(err.code, "no-content");
          assertEquals(err.httpStatus, 400);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step("concurrent generation lock: second executeContinue → ChatError(concurrent, 409)", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_continue_concurrent_" });
        try {
          const original = "<user_message>q</user_message>\n\nseed";
          await setupStory(tmpDir, "s1", "n1", original);

          // Use a fetch stub whose body never closes until we tell it to. This
          // keeps the first executeContinue mid-flight while we kick off a
          // second invocation that must collide with the per-story lock.
          const originalFetch = globalThis.fetch;
          let firstStreamController: ReadableStreamDefaultController<Uint8Array> | null = null;
          globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) => {
            if (typeof url === "string" && url.includes("chat/completions")) {
              const sig = opts?.signal as AbortSignal | undefined;
              return Promise.resolve(new Response(
                new ReadableStream<Uint8Array>({
                  start(c) {
                    firstStreamController = c;
                    if (sig) {
                      const onAbort = () => {
                        try { c.error(sig.reason ?? new DOMException("aborted", "AbortError")); } catch { /* */ }
                      };
                      if (sig.aborted) onAbort();
                      else sig.addEventListener("abort", onAbort, { once: true });
                    }
                  },
                }),
                { status: 200 },
              ));
            }
            return originalFetch(url as string, opts);
          }) as typeof fetch;

          try {
            const buildPrompt = () => Promise.resolve(makePromptResult(original, "seed", "q"));
            const ctrl = new AbortController();
            const first = executeContinue({
              series: "s1",
              name: "n1",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildContinuePromptFromStory: buildPrompt,
              signal: ctrl.signal,
            });
            // Yield so the first call has marked the generation lock.
            await new Promise((r) => setTimeout(r, 30));

            const err = await assertRejects(
              () =>
                executeContinue({
                  series: "s1",
                  name: "n1",
                  config: buildConfig(tmpDir),
                  safePath: createSafePath(tmpDir),
                  hookDispatcher: new HookDispatcher(),
                  buildContinuePromptFromStory: buildPrompt,
                }),
              ChatError,
            );
            assertEquals(err.code, "concurrent");
            assertEquals(err.httpStatus, 409);

            // Release the first call so it can finish and clear the lock.
            ctrl.abort();
            try { (firstStreamController as ReadableStreamDefaultController<Uint8Array> | null)?.error(new DOMException("aborted", "AbortError")); } catch { /* */ }
            await first.catch(() => {});
          } finally {
            globalThis.fetch = originalFetch;
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step("abort signal aborts the stream → ChatAbortError", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "hr_test_continue_abort_" });
        try {
          const original = "<user_message>q</user_message>\n\nseed";
          await setupStory(tmpDir, "s1", "n1", original);

          const originalFetch = globalThis.fetch;
          globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
            new Promise<Response>((_, reject) => {
              const sig = init?.signal as AbortSignal | undefined;
              if (!sig) { reject(new Error("test fetch stub requires signal")); return; }
              const onAbort = () => reject(sig.reason ?? new DOMException("aborted", "AbortError"));
              if (sig.aborted) onAbort();
              else sig.addEventListener("abort", onAbort, { once: true });
            })) as typeof fetch;

          try {
            const ctrl = new AbortController();
            const promise = executeContinue({
              series: "s1",
              name: "n1",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildContinuePromptFromStory: () =>
                Promise.resolve(makePromptResult(original, "seed", "q")),
              signal: ctrl.signal,
            });
            await new Promise((r) => setTimeout(r, 5));
            ctrl.abort();
            await assertRejects(() => promise, ChatAbortError);
            // File untouched.
            assertEquals(await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md")), original);
          } finally {
            globalThis.fetch = originalFetch;
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });
    } finally {
      if (previousKey === undefined) Deno.env.delete("LLM_API_KEY");
      else Deno.env.set("LLM_API_KEY", previousKey);
    }
  },
});
