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

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { executeChat, executeContinue } from "../../../writer/lib/chat-shared.ts";
import { ChatError } from "../../../writer/lib/chat-types.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { resetLlmTransportCache } from "../../../writer/lib/llm-transport.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import type {
  AppConfig,
  BuildPromptResult,
  ContinuePromptResult,
  LlmApiMode,
  PostResponsePayload,
} from "../../../writer/types.ts";

const BASE_URL = "https://example.test/v1";
const RESPONSES_URL = `${BASE_URL}/responses`;
const CHAT_URL = `${BASE_URL}/chat/completions`;

function buildConfig(tmpDir: string, overrides: { baseUrl?: string; mode?: LlmApiMode } = {}) {
  return {
    ROOT_DIR: "/x",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/x",
    PLUGINS_DIR: "/x",
    PORT: 0,
    LLM_API_BASE_URL: overrides.baseUrl ?? BASE_URL,
    LLM_API_MODE: overrides.mode ?? "auto",
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
    llmDefaults: {
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
    },
    THEME_DIR: "./themes/",
    PROMPT_FILE: "x",
  } as unknown as AppConfig;
}

function chatChunks(text: string, usage = false): string[] {
  const chunks = [`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`];
  if (usage) {
    chunks.push(
      'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":40,"total_tokens":120}}\n\n',
    );
  }
  chunks.push("data: [DONE]\n\n");
  return chunks;
}

function responsesChunks(events: Array<Record<string, unknown>>): string[] {
  return [...events.map((event) => `data: ${JSON.stringify(event)}\n\n`), "data: [DONE]\n\n"];
}

function sseResponse(chunks: string[], status = 200): Response {
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status },
  );
}

interface RecordedRequest {
  readonly url: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown>;
}

interface StubbedFetch {
  readonly requests: RecordedRequest[];
  readonly restore: () => void;
}

function stubUrlMap(handlers: Record<string, () => Response>): StubbedFetch {
  const original = globalThis.fetch;
  const requests: RecordedRequest[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    const rawBody = typeof init?.body === "string" ? init.body : "";
    requests.push({
      url: target,
      headers: new Headers(init?.headers),
      body: rawBody ? JSON.parse(rawBody) as Record<string, unknown> : {},
    });
    const handler = handlers[target];
    if (!handler) return Promise.reject(new TypeError(`unexpected fetch: ${target}`));
    return Promise.resolve(handler());
  }) as typeof fetch;
  return {
    requests,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function buildPromptStub() {
  return (): Promise<BuildPromptResult> =>
    Promise.resolve({
      messages: [{ role: "user" as const, content: "test prompt" }],
      previousContext: [],
      isFirstRound: true,
      ventoError: null,
      chapterFiles: [],
      chapters: [],
    } as BuildPromptResult);
}

async function makeStoryDir(prefix: string): Promise<string> {
  const tmpDir = await Deno.makeTempDir({ prefix });
  await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
  return tmpDir;
}

Deno.test({
  name: "llm-transport – chat-shared integration",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("LLM_API_KEY", "test-key");

    await t.step(
      "auto: Responses 404/405/501 falls back to Chat Completions for the same generation",
      async () => {
        for (const status of [404, 405, 501]) {
          resetLlmTransportCache();
          const tmpDir = await makeStoryDir(`transport-fallback-${status}-`);
          const hd = new HookDispatcher();
          let observedTransport: string | undefined;
          let observedMetadata: Record<string, unknown> | undefined;
          hd.register("pre-llm-fetch", (ctx) => {
            observedTransport = ctx.transport as string;
            observedMetadata = ctx.requestMetadata as Record<string, unknown>;
            return Promise.resolve();
          });
          const postEndpoints: string[] = [];
          hd.register("post-response", (ctx) => {
            const payload = ctx as unknown as PostResponsePayload;
            postEndpoints.push(payload.endpoint);
            return Promise.resolve();
          });
          const stub = stubUrlMap({
            [RESPONSES_URL]: () => new Response(`no responses (${status})`, { status }),
            [CHAT_URL]: () => sseResponse(chatChunks("hello", true)),
          });
          try {
            const result = await executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: hd,
              buildPromptFromStory: buildPromptStub(),
            });

            assertEquals(stub.requests.length, 2, `status ${status}`);
            assertEquals(stub.requests[0]!.url, RESPONSES_URL);
            assertEquals(stub.requests[1]!.url, CHAT_URL);

            // Identical request identity across the retry.
            assertEquals(
              stub.requests[0]!.headers.get("authorization"),
              stub.requests[1]!.headers.get("authorization"),
            );
            assertEquals(stub.requests[0]!.headers.get("authorization"), "Bearer test-key");
            assertEquals(stub.requests[0]!.body.model, "default-model");
            assertEquals(stub.requests[1]!.body.model, "default-model");
            assertEquals(stub.requests[1]!.body.messages, stub.requests[0]!.body.input);

            // Responses shapes the first body, Chat Completions the second.
            assert("input" in stub.requests[0]!.body);
            assert(!("messages" in stub.requests[0]!.body));
            assert(!("input" in stub.requests[1]!.body));
            assert("messages" in stub.requests[1]!.body);

            // The hook fired once, on the first attempt only.
            assertEquals(observedTransport, "responses");
            assert(observedMetadata !== undefined);
            assert(!("input" in observedMetadata));
            assert(!("messages" in observedMetadata));

            assertEquals(result.content, "hello");
            const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
            assertEquals(onDisk, "hello");
            assertEquals(result.usage?.totalTokens, 120);
            assertEquals(postEndpoints, [CHAT_URL]);
          } finally {
            stub.restore();
            resetLlmTransportCache();
            await Deno.remove(tmpDir, { recursive: true });
          }
        }
      },
    );

    await t.step("auto: 400 and 422 are terminal and never fall back", async () => {
      for (const status of [400, 422]) {
        resetLlmTransportCache();
        const tmpDir = await makeStoryDir(`transport-terminal-${status}-`);
        const stub = stubUrlMap({
          [RESPONSES_URL]: () => new Response(`bad (${status})`, { status }),
          [CHAT_URL]: () => sseResponse(chatChunks("never")),
        });
        try {
          const error = await assertRejects(
            () =>
              executeChat({
                series: "s1",
                name: "n1",
                message: "Hi",
                config: buildConfig(tmpDir),
                safePath: createSafePath(tmpDir),
                hookDispatcher: new HookDispatcher(),
                buildPromptFromStory: buildPromptStub(),
              }),
            ChatError,
          );
          assertEquals(error.httpStatus, status);
          assertEquals(stub.requests.length, 1);
          assertEquals(stub.requests[0]!.url, RESPONSES_URL);
        } finally {
          stub.restore();
          resetLlmTransportCache();
          await Deno.remove(tmpDir, { recursive: true });
        }
      }
    });

    await t.step("auto: a Responses network error is terminal", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-network-");
      const original = globalThis.fetch;
      const urls: string[] = [];
      globalThis.fetch = ((url: string | URL | Request) => {
        urls.push(String(url));
        return Promise.reject(new TypeError("connection refused"));
      }) as typeof fetch;
      try {
        const error = await assertRejects(
          () =>
            executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub(),
            }),
          ChatError,
        );
        assertEquals(error.code, "llm-api");
        assertEquals(urls, [RESPONSES_URL]);
      } finally {
        globalThis.fetch = original;
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("auto: a fallback failure surfaces the Chat Completions error", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-fallback-fail-");
      const stub = stubUrlMap({
        [RESPONSES_URL]: () => new Response("no responses", { status: 404 }),
        [CHAT_URL]: () => new Response("unauthorized", { status: 401 }),
      });
      try {
        const error = await assertRejects(
          () =>
            executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub(),
            }),
          ChatError,
        );
        assertEquals(error.httpStatus, 401);
        assertEquals(stub.requests.map((r) => r.url), [RESPONSES_URL, CHAT_URL]);
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("auto: later generations skip the Responses probe after a fallback", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-cache-");
      let responsesHits = 0;
      const stub = stubUrlMap({
        [RESPONSES_URL]: () => {
          responsesHits++;
          return new Response("no responses", { status: 404 });
        },
        [CHAT_URL]: () => sseResponse(chatChunks("hello")),
      });
      const run = (message: string) =>
        executeChat({
          series: "s1",
          name: "n1",
          message,
          config: buildConfig(tmpDir),
          safePath: createSafePath(tmpDir),
          hookDispatcher: new HookDispatcher(),
          buildPromptFromStory: buildPromptStub(),
        });
      try {
        await run("first");
        assertEquals(responsesHits, 1);
        const second = await run("second");
        assertEquals(responsesHits, 1, "the second generation must not probe Responses");
        assertEquals(second.content, "hello");
        assertEquals(stub.requests.at(-1)!.url, CHAT_URL);
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("auto: a bodyless fallback response is an error and is not cached", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-no-body-");
      const stub = stubUrlMap({
        [RESPONSES_URL]: () => new Response("no responses", { status: 404 }),
        [CHAT_URL]: () => new Response(null, { status: 204 }),
      });
      try {
        const error = await assertRejects(
          () =>
            executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub(),
            }),
          ChatError,
        );
        assertEquals(error.code, "no-body");

        // The failed attempt must not poison the capability cache.
        const retry = stubUrlMap({
          [RESPONSES_URL]: () =>
            sseResponse(responsesChunks([
              { type: "response.output_text.delta", delta: "direct" },
            ])),
          [CHAT_URL]: () => sseResponse(chatChunks("chat")),
        });
        try {
          const result = await executeChat({
            series: "s1",
            name: "n1",
            message: "Again",
            config: buildConfig(tmpDir),
            safePath: createSafePath(tmpDir),
            hookDispatcher: new HookDispatcher(),
            buildPromptFromStory: buildPromptStub(),
          });
          assertEquals(retry.requests.length, 1);
          assertEquals(retry.requests[0]!.url, RESPONSES_URL);
          assertEquals(result.content, "direct");
        } finally {
          retry.restore();
        }
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("mode=responses: content and usage come from the Responses stream", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-responses-");
      const hd = new HookDispatcher();
      const postEndpoints: string[] = [];
      hd.register("post-response", (ctx) => {
        const payload = ctx as unknown as PostResponsePayload;
        postEndpoints.push(payload.endpoint);
        return Promise.resolve();
      });
      const stub = stubUrlMap({
        [RESPONSES_URL]: () =>
          sseResponse(responsesChunks([
            { type: "response.created", response: {} },
            { type: "response.output_text.delta", delta: "Hello " },
            { type: "response.output_text.delta", delta: "world" },
            {
              type: "response.completed",
              response: {
                usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
              },
            },
          ])),
        [CHAT_URL]: () => sseResponse(chatChunks("should not be used")),
      });
      try {
        const result = await executeChat({
          series: "s1",
          name: "n1",
          message: "Hi",
          config: buildConfig(tmpDir, { mode: "responses" }),
          safePath: createSafePath(tmpDir),
          hookDispatcher: hd,
          buildPromptFromStory: buildPromptStub(),
        });

        assertEquals(stub.requests.length, 1, "mode=responses must never call Chat Completions");
        assertEquals(stub.requests[0]!.url, RESPONSES_URL);
        assertEquals(result.content, "Hello world");
        assertEquals(result.usage?.promptTokens, 10);
        assertEquals(result.usage?.completionTokens, 5);
        assertEquals(result.usage?.totalTokens, 15);
        assertEquals(postEndpoints, [RESPONSES_URL]);
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk, "Hello world");
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("mode=responses: reasoning summary becomes a single think block", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-summary-");
      const stub = stubUrlMap({
        [RESPONSES_URL]: () =>
          sseResponse(responsesChunks([
            { type: "response.reasoning_summary_part.added", summary_index: 0 },
            { type: "response.reasoning_summary_text.delta", delta: "Think" },
            { type: "response.reasoning_summary_part.added", summary_index: 1 },
            { type: "response.reasoning_summary_text.delta", delta: "Deep" },
            { type: "response.output_text.delta", delta: "answer" },
          ])),
      });
      try {
        const result = await executeChat({
          series: "s1",
          name: "n1",
          message: "Hi",
          config: buildConfig(tmpDir, { mode: "responses" }),
          safePath: createSafePath(tmpDir),
          hookDispatcher: new HookDispatcher(),
          buildPromptFromStory: buildPromptStub(),
        });
        assertEquals(result.content, "answer");
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assertEquals(onDisk.split("Think").length - 1, 1, `reasoning must appear once: ${onDisk}`);
        assert(onDisk.includes("Think\n\nDeep"), `expected a summary part separator: ${onDisk}`);
        assert(onDisk.endsWith("answer"), `content must follow the think block: ${onDisk}`);
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("mode=chat-completions: never requests /responses", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-chat-");
      const stub = stubUrlMap({
        [RESPONSES_URL]: () => new Response("must not be called", { status: 200 }),
        [CHAT_URL]: () => sseResponse(chatChunks("hello")),
      });
      try {
        const result = await executeChat({
          series: "s1",
          name: "n1",
          message: "Hi",
          config: buildConfig(tmpDir, { mode: "chat-completions" }),
          safePath: createSafePath(tmpDir),
          hookDispatcher: new HookDispatcher(),
          buildPromptFromStory: buildPromptStub(),
        });
        assertEquals(stub.requests.length, 1);
        assertEquals(stub.requests[0]!.url, CHAT_URL);
        assertEquals(result.content, "hello");
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("mode=responses: a 404 is terminal", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-forced-404-");
      const stub = stubUrlMap({
        [RESPONSES_URL]: () => new Response("no responses", { status: 404 }),
        [CHAT_URL]: () => sseResponse(chatChunks("never")),
      });
      try {
        const error = await assertRejects(
          () =>
            executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir, { mode: "responses" }),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub(),
            }),
          ChatError,
        );
        assertEquals(error.httpStatus, 404);
        assertEquals(stub.requests.map((r) => r.url), [RESPONSES_URL]);
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("auto: continue-last-chapter is pinned to Chat Completions", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-continue-");
      const dir = join(tmpDir, "s1", "n1");
      const existingContent = "<user_message>q</user_message>\n\nseed";
      await Deno.writeTextFile(join(dir, "001.md"), existingContent);
      const stub = stubUrlMap({
        [RESPONSES_URL]: () => new Response("must not be called", { status: 200 }),
        [CHAT_URL]: () => sseResponse(chatChunks(" extra")),
      });
      try {
        await executeContinue({
          series: "s1",
          name: "n1",
          config: buildConfig(tmpDir),
          safePath: createSafePath(tmpDir),
          hookDispatcher: new HookDispatcher(),
          buildContinuePromptFromStory: () =>
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
            } as ContinuePromptResult),
        });
        assertEquals(stub.requests.length, 1);
        assertEquals(stub.requests[0]!.url, CHAT_URL);
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("mode=responses: a mid-stream error preserves the partial chapter", async () => {
      resetLlmTransportCache();
      const tmpDir = await makeStoryDir("transport-stream-error-");
      const stub = stubUrlMap({
        [RESPONSES_URL]: () =>
          sseResponse(responsesChunks([
            { type: "response.output_text.delta", delta: "partial" },
            { type: "error", code: "server_error", message: "upstream died" },
          ])),
        [CHAT_URL]: () => sseResponse(chatChunks("never")),
      });
      try {
        const error = await assertRejects(
          () =>
            executeChat({
              series: "s1",
              name: "n1",
              message: "Hi",
              config: buildConfig(tmpDir, { mode: "responses" }),
              safePath: createSafePath(tmpDir),
              hookDispatcher: new HookDispatcher(),
              buildPromptFromStory: buildPromptStub(),
            }),
          ChatError,
        );
        assertEquals(error.code, "llm-stream");
        assertEquals(error.httpStatus, 502);
        assertEquals(stub.requests.length, 1);
        const onDisk = await Deno.readTextFile(join(tmpDir, "s1", "n1", "001.md"));
        assert(onDisk.endsWith("partial"), `expected preserved partial bytes: ${onDisk}`);
      } finally {
        stub.restore();
        resetLlmTransportCache();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  },
});
