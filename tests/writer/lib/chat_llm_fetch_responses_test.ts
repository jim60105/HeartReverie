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

import { assert, assertEquals, assertInstanceOf, assertRejects } from "@std/assert";
import { buildResponsesRequestBody, performLlmFetch } from "../../../writer/lib/chat-llm-fetch.ts";
import {
  ChatAbortError,
  ChatError,
  LlmTransportUnsupportedError,
} from "../../../writer/lib/chat-types.ts";
import type { Logger } from "../../../writer/lib/logger.ts";
import type { ChatMessage, LlmConfig } from "../../../writer/types.ts";

const BASE_CONFIG: LlmConfig = {
  model: "test/model",
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

const MESSAGES: ChatMessage[] = [
  { role: "system", content: "sys" },
  { role: "user", content: "hello" },
];

interface RecordingLogger {
  readonly logger: Logger;
  readonly entries: Array<{ level: string; message: string }>;
}

function recordingLogger(): RecordingLogger {
  const entries: Array<{ level: string; message: string }> = [];
  const record = (level: string) => (message: string) => {
    entries.push({ level, message });
  };
  const logger = {
    debug: record("debug"),
    info: record("info"),
    warn: record("warn"),
    error: record("error"),
  } as unknown as Logger;
  return { logger, entries };
}

type FetchHandler = (url: string, init: RequestInit | undefined) => Response;

function stubFetch(handler: FetchHandler): { restore: () => void; urls: string[] } {
  const original = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const target = String(url);
    urls.push(target);
    return Promise.resolve(handler(target, init));
  }) as typeof fetch;
  return {
    urls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

const FETCH_ARGS = {
  apiUrl: "https://openrouter.ai/api/v1/responses",
  requestBody: { model: "test/model", stream: true },
  signal: undefined,
  llmStartTime: 0,
  model: "test/model",
};

Deno.test("responses body – sampler subset, token cap and stream flags", () => {
  const body = buildResponsesRequestBody(
    { ...BASE_CONFIG, temperature: 0.7, maxCompletionTokens: 4096 },
    MESSAGES,
    false,
  );
  assertEquals(body.model, "test/model");
  assertEquals(body.input, MESSAGES);
  assertEquals(body.stream, true);
  assertEquals(body.store, false);
  assertEquals(body.temperature, 0.7);
  assertEquals(body.max_output_tokens, 4096);
  assertEquals(body.top_p, BASE_CONFIG.topP);
  assertEquals(body.top_k, BASE_CONFIG.topK);
  assertEquals(body.frequency_penalty, BASE_CONFIG.frequencyPenalty);
  assertEquals(body.presence_penalty, BASE_CONFIG.presencePenalty);
});

Deno.test("responses body – null token cap omits max_output_tokens", () => {
  const body = buildResponsesRequestBody(
    { ...BASE_CONFIG, maxCompletionTokens: null },
    MESSAGES,
    false,
  );
  assert(!("max_output_tokens" in body));
});

Deno.test("responses body – Chat-Completions-only keys are absent", () => {
  const body = buildResponsesRequestBody(BASE_CONFIG, MESSAGES, false);
  for (
    const key of [
      "messages",
      "max_completion_tokens",
      "repetition_penalty",
      "min_p",
      "top_a",
      "usage",
      "stream_options",
    ]
  ) {
    assert(!(key in body), `expected ${key} to be absent from the Responses body`);
  }
});

Deno.test("responses body – reasoning parameter shapes", () => {
  assertEquals(
    buildResponsesRequestBody(
      { ...BASE_CONFIG, reasoningEnabled: true, reasoningEffort: "high" },
      MESSAGES,
      false,
    ).reasoning,
    { effort: "high", summary: "auto" },
  );
  assertEquals(
    buildResponsesRequestBody({ ...BASE_CONFIG, reasoningEnabled: false }, MESSAGES, false)
      .reasoning,
    { effort: "none" },
  );
  const omitted = buildResponsesRequestBody(BASE_CONFIG, MESSAGES, true);
  assert(!("reasoning" in omitted));
});

Deno.test("performLlmFetch – unsupported status with a fallback set rejects with the transport error", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("unread body"));
    },
    cancel() {
      cancelled = true;
    },
  });
  const stub = stubFetch(() => new Response(body, { status: 404 }));
  const req = recordingLogger();
  const llm = recordingLogger();
  try {
    const error = await assertRejects(
      () =>
        performLlmFetch({
          ...FETCH_ARGS,
          reqLog: req.logger,
          llmLog: llm.logger,
          fallbackStatuses: new Set([404, 405, 501]),
        }),
      LlmTransportUnsupportedError,
    );
    assertEquals(error.status, 404);
    assertEquals(cancelled, true, "the unsupported response body must be cancelled");
    assert(
      req.entries.some((e) => e.message.includes("falling back to Chat Completions")),
      "expected a fallback warning on the request logger",
    );
    assertEquals(llm.entries.length, 0, "a fallback attempt must not log a terminal LLM error");
  } finally {
    stub.restore();
  }
});

Deno.test("performLlmFetch – 500 with a fallback set stays a terminal ChatError", async () => {
  const stub = stubFetch(() => new Response("boom", { status: 500 }));
  const req = recordingLogger();
  const llm = recordingLogger();
  try {
    const error = await assertRejects(
      () =>
        performLlmFetch({
          ...FETCH_ARGS,
          reqLog: req.logger,
          llmLog: llm.logger,
          fallbackStatuses: new Set([404, 405, 501]),
        }),
      ChatError,
    );
    assertEquals(error.code, "llm-api");
    assertEquals(error.httpStatus, 500);
    assertEquals(req.entries.filter((e) => e.level === "warn").length, 0);
    assert(llm.entries.some((e) => e.message === "LLM error"));
  } finally {
    stub.restore();
  }
});

Deno.test("performLlmFetch – 404 without a fallback set stays a terminal ChatError", async () => {
  const stub = stubFetch(() => new Response("missing", { status: 404 }));
  try {
    const error = await assertRejects(
      () =>
        performLlmFetch({
          ...FETCH_ARGS,
          reqLog: recordingLogger().logger,
          llmLog: recordingLogger().logger,
        }),
      ChatError,
    );
    assertEquals(error.code, "llm-api");
    assertEquals(error.httpStatus, 404);
    assertEquals(stub.urls.length, 1);
  } finally {
    stub.restore();
  }
});

Deno.test("performLlmFetch – an already-aborted signal wins over the fallback", async () => {
  const stub = stubFetch(() => new Response("missing", { status: 404 }));
  const controller = new AbortController();
  controller.abort();
  const llm = recordingLogger();
  try {
    await assertRejects(
      () =>
        performLlmFetch({
          ...FETCH_ARGS,
          signal: controller.signal,
          reqLog: recordingLogger().logger,
          llmLog: llm.logger,
          fallbackStatuses: new Set([404]),
        }),
      ChatAbortError,
    );
    assert(
      llm.entries.some((e) => e.message === "LLM error"),
      "the abort must be reported on the LLM logger",
    );
  } finally {
    stub.restore();
  }
});

Deno.test("performLlmFetch – a 2xx with a body is returned untouched", async () => {
  const stub = stubFetch(() =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
      { status: 200 },
    )
  );
  try {
    const response = await performLlmFetch({
      ...FETCH_ARGS,
      reqLog: recordingLogger().logger,
      llmLog: recordingLogger().logger,
      fallbackStatuses: new Set([404]),
    });
    assertEquals(response.status, 200);
    assertInstanceOf(response.body, ReadableStream);
  } finally {
    stub.restore();
  }
});
