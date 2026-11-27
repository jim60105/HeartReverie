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

import { assertEquals } from "@std/assert";
import {
  parseChatCompletionsFrame,
  parseResponsesFrame,
} from "../../../writer/lib/llm-stream-frames.ts";

const EMPTY = { content: "", reasoning: "", reasoningKind: null, usage: null, error: null };

Deno.test("frames/chat – content and thought-free deltas", () => {
  assertEquals(parseChatCompletionsFrame({ choices: [{ delta: { content: "Hi" } }] }), {
    ...EMPTY,
    content: "Hi",
  });
  assertEquals(parseChatCompletionsFrame({ choices: [{ delta: {} }] }), EMPTY);
  assertEquals(parseChatCompletionsFrame({ choices: [] }), EMPTY);
  assertEquals(parseChatCompletionsFrame(null), EMPTY);
  assertEquals(parseChatCompletionsFrame("nope"), EMPTY);
});

Deno.test("frames/chat – reasoning priority reasoning > reasoning_content > reasoning_details", () => {
  assertEquals(
    parseChatCompletionsFrame({
      choices: [{
        delta: {
          reasoning: "direct",
          reasoning_content: "content-field",
          reasoning_details: [{ text: "details" }],
        },
      }],
    }),
    { ...EMPTY, reasoning: "direct", reasoningKind: "text" },
  );

  assertEquals(
    parseChatCompletionsFrame({
      choices: [{
        delta: { reasoning_content: "deepseek", reasoning_details: [{ text: "details" }] },
      }],
    }),
    { ...EMPTY, reasoning: "deepseek", reasoningKind: "text" },
  );

  assertEquals(
    parseChatCompletionsFrame({
      choices: [{
        delta: {
          reasoning_details: [
            { type: "reasoning.text", text: "Counting " },
            { type: "reasoning.signature", signature: "abc" },
            { type: "reasoning.text", text: "letters." },
          ],
        },
      }],
    }),
    { ...EMPTY, reasoning: "Counting letters.", reasoningKind: "text" },
  );

  // Empty string reasoning falls through to the next source.
  assertEquals(
    parseChatCompletionsFrame({
      choices: [{ delta: { reasoning: "", reasoning_content: "second" } }],
    }),
    { ...EMPTY, reasoning: "second", reasoningKind: "text" },
  );
  // Non-string reasoning is ignored.
  assertEquals(
    parseChatCompletionsFrame({ choices: [{ delta: { reasoning: 42 as unknown as string } }] }),
    EMPTY,
  );
});

Deno.test("frames/chat – error detection and message rules", () => {
  assertEquals(
    parseChatCompletionsFrame({ error: { message: "boom", code: 502 } }),
    { ...EMPTY, error: "boom" },
  );
  // A code without a message stringifies only when defined.
  assertEquals(
    parseChatCompletionsFrame({ error: { code: 429 } }),
    { ...EMPTY, error: "429" },
  );
  assertEquals(
    parseChatCompletionsFrame({ error: {} }),
    { ...EMPTY, error: "Mid-stream provider error" },
  );
  // finish_reason: "error" is an error even without an error object.
  assertEquals(
    parseChatCompletionsFrame({ choices: [{ finish_reason: "error", delta: {} }] }),
    { ...EMPTY, error: "Mid-stream provider error" },
  );
  // Empty message string falls through to the code.
  assertEquals(
    parseChatCompletionsFrame({ error: { message: "", code: "rate_limit" } }),
    { ...EMPTY, error: "rate_limit" },
  );
});

Deno.test("frames/chat – usage mapping with the cost guard", () => {
  assertEquals(
    parseChatCompletionsFrame({
      choices: [],
      usage: { prompt_tokens: 11, completion_tokens: 22, total_tokens: 33, cost: 0.0123 },
    }),
    { ...EMPTY, usage: { prompt: 11, completion: 22, total: 33, cost: 0.0123 } },
  );
  for (const cost of [-1, Number.NaN, Number.POSITIVE_INFINITY, "0.01"]) {
    assertEquals(
      parseChatCompletionsFrame({
        choices: [],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3, cost },
      }),
      { ...EMPTY, usage: { prompt: 1, completion: 2, total: 3, cost: null } },
    );
  }
  assertEquals(parseChatCompletionsFrame({ choices: [], usage: { total_tokens: 3 } }), {
    ...EMPTY,
    usage: { prompt: null, completion: null, total: 3, cost: null },
  });
});

Deno.test("frames/responses – output text deltas", () => {
  assertEquals(
    parseResponsesFrame({ type: "response.output_text.delta", delta: "Hel" }),
    { ...EMPTY, content: "Hel" },
  );
  assertEquals(parseResponsesFrame({ type: "response.output_text.delta", delta: "" }), EMPTY);
  assertEquals(parseResponsesFrame({ type: "response.output_text.delta", delta: 5 }), EMPTY);
});

Deno.test("frames/responses – reasoning channels and summary separators", () => {
  assertEquals(
    parseResponsesFrame({ type: "response.reasoning_text.delta", delta: "raw" }),
    { ...EMPTY, reasoning: "raw", reasoningKind: "text" },
  );
  assertEquals(
    parseResponsesFrame({ type: "response.reasoning_summary_text.delta", delta: "sum" }),
    { ...EMPTY, reasoning: "sum", reasoningKind: "summary" },
  );
  assertEquals(
    parseResponsesFrame({ type: "response.reasoning_summary_part.added", summary_index: 1 }),
    { ...EMPTY, reasoning: "\n\n", reasoningKind: "summary" },
  );
  assertEquals(
    parseResponsesFrame({ type: "response.reasoning_summary_part.added", summary_index: 0 }),
    EMPTY,
  );
});

Deno.test("frames/responses – usage from completed and incomplete events", () => {
  const usage = { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost: 0.002 };
  for (const type of ["response.completed", "response.incomplete"]) {
    assertEquals(parseResponsesFrame({ type, response: { usage } }), {
      ...EMPTY,
      usage: { prompt: 10, completion: 5, total: 15, cost: 0.002 },
    });
  }
  assertEquals(
    parseResponsesFrame({ type: "response.completed", response: { usage: { cost: -3 } } }),
    { ...EMPTY, usage: { prompt: null, completion: null, total: null, cost: null } },
  );
  assertEquals(parseResponsesFrame({ type: "response.completed", response: {} }), EMPTY);
  assertEquals(
    parseResponsesFrame({ type: "response.completed", response: { usage: null } }),
    EMPTY,
  );
  assertEquals(parseResponsesFrame({ type: "response.completed" }), EMPTY);
});

Deno.test("frames/responses – error events", () => {
  assertEquals(
    parseResponsesFrame({
      type: "response.failed",
      response: { error: { code: "server_error", message: "Upstream died" } },
    }),
    { ...EMPTY, error: "Upstream died" },
  );
  assertEquals(
    parseResponsesFrame({ type: "response.failed", response: { error: { code: "server_error" } } }),
    { ...EMPTY, error: "server_error" },
  );
  assertEquals(parseResponsesFrame({ type: "response.failed" }), {
    ...EMPTY,
    error: "Mid-stream provider error",
  });
  assertEquals(parseResponsesFrame({ type: "error", code: "rate_limit" }), {
    ...EMPTY,
    error: "rate_limit",
  });
  assertEquals(parseResponsesFrame({ type: "error", message: "nope", code: 1 }), {
    ...EMPTY,
    error: "nope",
  });
  // A top-level error object wins over the event type.
  assertEquals(
    parseResponsesFrame({
      type: "response.output_text.delta",
      delta: "x",
      error: { message: "dead" },
    }),
    { ...EMPTY, error: "dead" },
  );
});

Deno.test("frames/responses – unknown events are ignored", () => {
  for (
    const event of [
      { type: "response.created", response: {} },
      { type: "response.in_progress" },
      { type: "[DONE]" },
      {},
      { type: "response.reasoning_summary_part.done", summary_index: 3 },
    ]
  ) {
    assertEquals(parseResponsesFrame(event), EMPTY);
  }
});
