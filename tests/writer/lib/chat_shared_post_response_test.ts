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

import { assert, assertEquals, assertStrictEquals, assertThrows } from "@std/assert";
import { join } from "@std/path";
import {
  executeChat,
  executeContinue,
  streamLlmAndPersist,
} from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import { readUsage } from "../../../writer/lib/usage.ts";
import type {
  AppConfig,
  BuildPromptResult,
  ContinuePromptResult,
  LlmConfig,
  PostResponsePayload,
  TokenUsageRecord,
} from "../../../writer/types.ts";

const ENDPOINT = "https://example.test/v1/chat/completions";

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
    LLM_API_URL: ENDPOINT,
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
    THEME_DIR: "./themes/",
    PROMPT_FILE: "x",
  } as unknown as AppConfig;
}

type FetchFn = typeof fetch;

function stubFetch(chunks: string[]): () => void {
  const original: FetchFn = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, _opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              const enc = new TextEncoder();
              for (const chunk of chunks) c.enqueue(enc.encode(chunk));
              c.close();
            },
          }),
          { status: 200 },
        ),
      );
    }
    return original(url as string, _opts);
  }) as FetchFn;
  return () => {
    globalThis.fetch = original;
  };
}

function fullUsageChunks(): string[] {
  return [
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":40,"total_tokens":120}}\n\n',
    "data: [DONE]\n\n",
  ];
}

function noUsageChunks(): string[] {
  return [
    'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
    "data: [DONE]\n\n",
  ];
}

function buildPromptStub() {
  return (): Promise<BuildPromptResult> =>
    Promise.resolve({
      messages: [{ role: "user" as const, content: "p" }],
      previousContext: [],
      isFirstRound: true,
      ventoError: null,
      chapterFiles: [],
      chapters: [],
    } as BuildPromptResult);
}

function buildContinuePromptStub(existingContent: string) {
  return (): Promise<ContinuePromptResult> =>
    Promise.resolve({
      messages: [
        { role: "system" as const, content: "sys" },
        { role: "user" as const, content: "q" },
      ],
      ventoError: null,
      targetChapterNumber: 1,
      existingContent,
      userMessageText: "q",
      assistantPrefill: "",
    });
}

function captureNextPostResponse(hd: HookDispatcher): { current: PostResponsePayload | undefined } {
  const captured: { current: PostResponsePayload | undefined } = { current: undefined };
  hd.register("post-response", (ctx) => {
    captured.current = ctx as unknown as PostResponsePayload;
    return Promise.resolve();
  });
  return captured;
}

Deno.test({
  name: "post-response payload — usage + endpoint fields",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const previousKey = Deno.env.get("LLM_API_KEY");
    Deno.env.set("LLM_API_KEY", "k");
    try {
      // ───────────────────────────────────────────────────────────
      await t.step(
        "4.1 write-new-chapter: usage populated, source=chat, endpoint set",
        async () => {
          const tmpDir = await Deno.makeTempDir({ prefix: "post-resp-new-" });
          try {
            await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const restore = stubFetch(fullUsageChunks());
            try {
              await executeChat({
                series: "s1",
                name: "n1",
                message: "Hi",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: hd,
                buildPromptFromStory: buildPromptStub(),
              });
            } finally {
              restore();
            }
            const p = cap.current;
            assert(p, "post-response payload must be captured");
            assertEquals(p!.source, "chat");
            assertEquals(p!.endpoint, ENDPOINT);
            assert(p!.usage, "usage must be non-null");
            assertEquals(p!.usage!.promptTokens, 80);
            assertEquals(p!.usage!.completionTokens, 40);
            assertEquals(p!.usage!.totalTokens, 120);
            assertEquals(p!.usage!.chapter, 1);
            assertEquals(p!.usage!.model, "default-model");
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );

      // ───────────────────────────────────────────────────────────
      await t.step("4.1b continue-last-chapter: source=continue, usage populated", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "post-resp-cont-" });
        try {
          const dir = join(tmpDir, "s1", "n1");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "<user_message>q</user_message>\n\nseed");
          const hd = new HookDispatcher();
          const cap = captureNextPostResponse(hd);
          const restore = stubFetch([
            'data: {"choices":[{"delta":{"content":" extra"}}]}\n\n',
            'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":40,"total_tokens":120}}\n\n',
            "data: [DONE]\n\n",
          ]);
          try {
            await executeContinue({
              series: "s1",
              name: "n1",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: hd,
              buildContinuePromptFromStory: buildContinuePromptStub(
                "<user_message>q</user_message>\n\nseed",
              ),
            });
          } finally {
            restore();
          }
          const p = cap.current;
          assert(p);
          assertEquals(p!.source, "continue");
          assertEquals(p!.endpoint, ENDPOINT);
          assert(p!.usage);
          assertEquals(p!.usage!.totalTokens, 120);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step(
        "4.2 + 4.3 append-to-existing-chapter: source=plugin-action, usage+appendedTag, _usage.json grows",
        async () => {
          const tmpDir = await Deno.makeTempDir({ prefix: "post-resp-append-" });
          try {
            const dir = join(tmpDir, "s1", "n1");
            await Deno.mkdir(dir, { recursive: true });
            await Deno.writeTextFile(join(dir, "001.md"), "existing\n");
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const config = buildConfig(tmpDir);
            const restore = stubFetch(fullUsageChunks());
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: {
                  kind: "append-to-existing-chapter",
                  appendTag: "UpdateVariable",
                  pluginName: "my-plugin",
                },
                hookDispatcher: hd,
                config,
                correlationId: "test-corr-append",
              });
            } finally {
              restore();
            }
            const p = cap.current;
            assert(p);
            assertEquals(p!.source, "plugin-action");
            assertEquals(p!.pluginName, "my-plugin");
            assertEquals(p!.appendedTag, "UpdateVariable");
            assertEquals(p!.endpoint, ENDPOINT);
            assert(p!.usage);
            assertEquals(p!.usage!.totalTokens, 120);
            // Regression: _usage.json must grow by exactly one record after plugin-action append
            const records = await readUsage(dir);
            assertEquals(records.length, 1);
            assertEquals(records[0]!.totalTokens, 120);
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );

      // ───────────────────────────────────────────────────────────
      await t.step(
        "4.1c replace-last-chapter: source=chat (plugin-action source literal)",
        async () => {
          const tmpDir = await Deno.makeTempDir({ prefix: "post-resp-replace-" });
          try {
            const dir = join(tmpDir, "s1", "n1");
            await Deno.mkdir(dir, { recursive: true });
            await Deno.writeTextFile(join(dir, "001.md"), "original\n");
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const config = buildConfig(tmpDir);
            const restore = stubFetch(fullUsageChunks());
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: { kind: "replace-last-chapter", pluginName: "polish" },
                hookDispatcher: hd,
                config,
                correlationId: "test-corr-replace",
              });
            } finally {
              restore();
            }
            const p = cap.current;
            assert(p);
            assertEquals(p!.source, "plugin-action");
            assertEquals(p!.pluginName, "polish");
            assertEquals(p!.endpoint, ENDPOINT);
            assert(p!.usage);
            assertEquals(p!.usage!.totalTokens, 120);
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );

      // ───────────────────────────────────────────────────────────
      await t.step("4.4 usage is explicitly null when upstream omits token counts", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "post-resp-null-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const hd = new HookDispatcher();
          const cap = captureNextPostResponse(hd);
          const restore = stubFetch(noUsageChunks());
          try {
            await executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: hd,
              buildPromptFromStory: buildPromptStub(),
            });
          } finally {
            restore();
          }
          const p = cap.current;
          assert(p);
          // Must be explicitly null, not undefined / missing.
          assertStrictEquals(p!.usage, null);
          assert("usage" in (p as unknown as Record<string, unknown>));
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step(
        "4.5a payload is fully frozen — usage reassignment + content reassignment + nested mutation throw",
        async () => {
          const tmpDir = await Deno.makeTempDir({ prefix: "post-resp-nowrite1-" });
          try {
            await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const restore = stubFetch(fullUsageChunks());
            try {
              await executeChat({
                series: "s1",
                name: "n1",
                message: "Hi",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: hd,
                buildPromptFromStory: buildPromptStub(),
              });
            } finally {
              restore();
            }
            const p = cap.current as unknown as PostResponsePayload;
            assert(p);
            // The whole payload is frozen.
            assert(Object.isFrozen(p), "PostResponsePayload must be Object.isFrozen");
            assert(Object.isFrozen(p.usage), "non-null usage value must also be frozen");
            // Reassigning any top-level slot must throw.
            assertThrows(() => {
              (p as unknown as { usage: TokenUsageRecord | null }).usage = null;
            }, TypeError);
            assertThrows(() => {
              (p as unknown as { content: string }).content = "mutated";
            }, TypeError);
            assertThrows(() => {
              (p as unknown as { endpoint: string }).endpoint = "https://evil.test";
            }, TypeError);
            // Nested mutation on usage must throw.
            assertThrows(() => {
              (p.usage as unknown as { totalTokens: number }).totalTokens = 0;
            }, TypeError);
            assertThrows(() => {
              (p.usage as unknown as Record<string, unknown>).cost = 0.0042;
            }, TypeError);
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );

      // ───────────────────────────────────────────────────────────
      await t.step("4.5b + 4.6 payload is frozen even when usage is null", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "post-resp-nowrite2-" });
        try {
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          const hd = new HookDispatcher();
          const cap = captureNextPostResponse(hd);
          const restore = stubFetch(noUsageChunks());
          try {
            await executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: hd,
              buildPromptFromStory: buildPromptStub(),
            });
          } finally {
            restore();
          }
          const p = cap.current as unknown as PostResponsePayload;
          assert(p);
          assert(Object.isFrozen(p), "PostResponsePayload must be frozen even when usage is null");
          assertStrictEquals(p.usage, null);
          // 4.6: the frozen payload still rejects reassignment when value was null.
          assertThrows(() => {
            (p as unknown as { usage: TokenUsageRecord | null }).usage = {
              chapter: 1,
              promptTokens: 1,
              completionTokens: 1,
              totalTokens: 2,
              model: "x",
              timestamp: "2024-01-01T00:00:00.000Z",
            };
          }, TypeError);
          assertThrows(() => {
            (p as unknown as { content: string }).content = "mutated";
          }, TypeError);
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });

      // ───────────────────────────────────────────────────────────
      await t.step("4.7 endpoint equals config.LLM_API_URL across all four branches", async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "post-resp-endpoint-" });
        try {
          // write-new-chapter
          await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
          {
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const restore = stubFetch(fullUsageChunks());
            try {
              await executeChat({
                series: "s1",
                name: "n1",
                message: "Hi",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: hd,
                buildPromptFromStory: buildPromptStub(),
              });
            } finally {
              restore();
            }
            assertEquals(cap.current!.endpoint, ENDPOINT);
            assert(Object.isFrozen(cap.current), "write-new-chapter payload must be frozen");
          }
          // append-to-existing-chapter
          const dir = join(tmpDir, "s1", "n1");
          {
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const config = buildConfig(tmpDir);
            const restore = stubFetch(fullUsageChunks());
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: { kind: "append-to-existing-chapter", appendTag: "T", pluginName: "p" },
                hookDispatcher: hd,
                config,
                correlationId: "c-app",
              });
            } finally {
              restore();
            }
            assertEquals(cap.current!.endpoint, ENDPOINT);
            assert(
              Object.isFrozen(cap.current),
              "append-to-existing-chapter payload must be frozen",
            );
          }
          // continue-last-chapter
          {
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const config = buildConfig(tmpDir);
            const existing = await Deno.readTextFile(join(dir, "001.md"));
            const restore = stubFetch(fullUsageChunks());
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: {
                  kind: "continue-last-chapter",
                  targetChapterNumber: 1,
                  existingContent: existing,
                },
                hookDispatcher: hd,
                config,
                correlationId: "c-con",
              });
            } finally {
              restore();
            }
            assertEquals(cap.current!.endpoint, ENDPOINT);
            assert(Object.isFrozen(cap.current), "continue-last-chapter payload must be frozen");
          }
          // replace-last-chapter
          {
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const config = buildConfig(tmpDir);
            const restore = stubFetch(fullUsageChunks());
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: { kind: "replace-last-chapter", pluginName: "polish" },
                hookDispatcher: hd,
                config,
                correlationId: "c-rep",
              });
            } finally {
              restore();
            }
            assertEquals(cap.current!.endpoint, ENDPOINT);
            assert(Object.isFrozen(cap.current), "replace-last-chapter payload must be frozen");
          }
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      });
    } finally {
      if (previousKey !== undefined) Deno.env.set("LLM_API_KEY", previousKey);
      else Deno.env.delete("LLM_API_KEY");
    }
  },
});
