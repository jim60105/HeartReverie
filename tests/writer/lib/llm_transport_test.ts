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
import {
  buildLlmEndpoints,
  planLlmTransports,
  recordChatCompletionsFallback,
  resetLlmTransportCache,
  RESPONSES_UNSUPPORTED_STATUSES,
  transportUrl,
} from "../../../writer/lib/llm-transport.ts";

const DEFAULT_ENDPOINTS = buildLlmEndpoints("https://openrouter.ai/api/v1");

Deno.test("llm-transport – buildLlmEndpoints appends the transport paths", () => {
  assertEquals(DEFAULT_ENDPOINTS, {
    chatCompletionsUrl: "https://openrouter.ai/api/v1/chat/completions",
    responsesUrl: "https://openrouter.ai/api/v1/responses",
  });
});

Deno.test("llm-transport – buildLlmEndpoints strips every trailing slash", () => {
  for (const base of ["http://127.0.0.1:11434/v1/", "http://127.0.0.1:11434/v1//"]) {
    assertEquals(buildLlmEndpoints(base), {
      chatCompletionsUrl: "http://127.0.0.1:11434/v1/chat/completions",
      responsesUrl: "http://127.0.0.1:11434/v1/responses",
    });
  }
});

Deno.test("llm-transport – transportUrl resolves each concrete transport", () => {
  assertEquals(transportUrl("responses", DEFAULT_ENDPOINTS), DEFAULT_ENDPOINTS.responsesUrl);
  assertEquals(
    transportUrl("chat-completions", DEFAULT_ENDPOINTS),
    DEFAULT_ENDPOINTS.chatCompletionsUrl,
  );
});

Deno.test("llm-transport – RESPONSES_UNSUPPORTED_STATUSES is exactly 404/405/501", () => {
  assertEquals([...RESPONSES_UNSUPPORTED_STATUSES].sort(), [404, 405, 501]);
});

Deno.test("llm-transport – forced modes never mix transports", () => {
  resetLlmTransportCache();
  for (const kind of ["write-new-chapter", "continue-last-chapter"] as const) {
    assertEquals(planLlmTransports("chat-completions", DEFAULT_ENDPOINTS, "m", kind), [
      "chat-completions",
    ]);
    assertEquals(planLlmTransports("responses", DEFAULT_ENDPOINTS, "m", kind), ["responses"]);
  }
});

Deno.test("llm-transport – auto tries Responses then Chat Completions", () => {
  resetLlmTransportCache();
  assertEquals(planLlmTransports("auto", DEFAULT_ENDPOINTS, "m", "write-new-chapter"), [
    "responses",
    "chat-completions",
  ]);
});

Deno.test("llm-transport – auto pins continue-last-chapter to Chat Completions", () => {
  resetLlmTransportCache();
  assertEquals(planLlmTransports("auto", DEFAULT_ENDPOINTS, "m", "continue-last-chapter"), [
    "chat-completions",
  ]);
});

Deno.test("llm-transport – cached fallback is keyed per model", () => {
  resetLlmTransportCache();
  recordChatCompletionsFallback(DEFAULT_ENDPOINTS, "m");
  assertEquals(planLlmTransports("auto", DEFAULT_ENDPOINTS, "m", "write-new-chapter"), [
    "chat-completions",
  ]);
  assertEquals(planLlmTransports("auto", DEFAULT_ENDPOINTS, "n", "write-new-chapter"), [
    "responses",
    "chat-completions",
  ]);
  resetLlmTransportCache();
});

Deno.test("llm-transport – cached fallback is keyed per Responses URL", () => {
  resetLlmTransportCache();
  recordChatCompletionsFallback(DEFAULT_ENDPOINTS, "m");
  const otherEndpoints = buildLlmEndpoints("https://self-hosted.example/v1");
  assertEquals(planLlmTransports("auto", otherEndpoints, "m", "write-new-chapter"), [
    "responses",
    "chat-completions",
  ]);
  resetLlmTransportCache();
});

Deno.test("llm-transport – resetLlmTransportCache clears every entry", () => {
  resetLlmTransportCache();
  recordChatCompletionsFallback(DEFAULT_ENDPOINTS, "m");
  assert(planLlmTransports("auto", DEFAULT_ENDPOINTS, "m", "write-new-chapter").length === 1);
  resetLlmTransportCache();
  assertEquals(planLlmTransports("auto", DEFAULT_ENDPOINTS, "m", "write-new-chapter"), [
    "responses",
    "chat-completions",
  ]);
});
