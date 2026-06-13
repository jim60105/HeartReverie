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
import { translateChatError } from "../../../writer/lib/chat-error-translate.ts";
import { ChatAbortError, ChatError } from "../../../writer/lib/chat-types.ts";

Deno.test("translateChatError", async (t) => {
  await t.step("aborted: ChatAbortError → aborted outcome", () => {
    const result = translateChatError(new ChatAbortError("stopped"), "fallback");
    assertEquals(result.kind, "aborted");
  });

  await t.step("vento: ChatError code=vento with ventoError → 422 vento body", () => {
    const ventoError = { stage: "prompt-assembly", message: "bad template" };
    const result = translateChatError(
      new ChatError("vento", "Template rendering error", 422, ventoError),
      "fallback",
    );
    if (result.kind !== "vento") throw new Error(`expected vento, got ${result.kind}`);
    assertEquals(result.status, 422);
    assertEquals(result.body, { type: "vento-error", ...ventoError });
    assertEquals(result.logFields.code, "vento");
    assertEquals(result.logFields.ventoError, ventoError);
  });

  await t.step("chat: known code maps to title with status passthrough", () => {
    const result = translateChatError(
      new ChatError("llm-api", "AI service request failed: 502", 502),
      "fallback",
    );
    if (result.kind !== "chat") throw new Error(`expected chat, got ${result.kind}`);
    assertEquals(result.status, 502);
    assertEquals(result.problem.title, "AI Service Error");
    assertEquals(result.problem.status, 502);
    assertEquals(result.problem.detail, "AI service request failed: 502");
    assertEquals(result.logFields.code, "llm-api");
  });

  await t.step("chat: unknown code falls back to default title", () => {
    const result = translateChatError(
      // deno-lint-ignore no-explicit-any -- exercise an unmapped code at runtime
      new ChatError("totally-unknown-code" as any, "boom", 503),
      "fallback",
    );
    if (result.kind !== "chat") throw new Error(`expected chat, got ${result.kind}`);
    assertEquals(result.problem.title, "Internal Server Error");
    assertEquals(result.status, 503);
  });

  await t.step("chat: vento code WITHOUT ventoError → chat (not vento) outcome", () => {
    const result = translateChatError(
      new ChatError("vento", "Template rendering error", 422),
      "fallback",
    );
    if (result.kind !== "chat") throw new Error(`expected chat, got ${result.kind}`);
    assertEquals(result.problem.title, "Unprocessable Entity");
    assertEquals(result.status, 422);
  });

  await t.step("unexpected: non-ChatError → 500 with fallbackDetail", () => {
    const result = translateChatError(
      new Error("kaboom"),
      "Failed to process chat request",
    );
    if (result.kind !== "unexpected") throw new Error(`expected unexpected, got ${result.kind}`);
    assertEquals(result.status, 500);
    assertEquals(result.problem.title, "Internal Server Error");
    assertEquals(result.problem.detail, "Failed to process chat request");
    assertEquals(result.logFields.error, "kaboom");
  });
});
