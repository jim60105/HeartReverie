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

import type { WSContext } from "@hono/hono/ws";
import { errorMessage } from "../lib/errors.ts";
import { isValidParam } from "../lib/middleware.ts";
import { createLogger } from "../lib/logger.ts";
import { executeChat, executeContinue } from "../lib/chat-shared.ts";
import { translateChatError } from "../lib/chat-error-translate.ts";
import type { TranslatedChatError } from "../lib/chat-error-translate.ts";
import { deleteLastChapter } from "../lib/story-chapter-io.ts";
import { isGenerationActive } from "../lib/generation-registry.ts";
import { MAX_MESSAGE_LENGTH } from "./ws-auth.ts";
import type { WsConnection } from "./ws-connection.ts";

const log = createLogger("ws");
const fileLog = createLogger("file");

/**
 * Send a translated chat error over the WebSocket. An `aborted` outcome maps to
 * `chat:aborted`; every other outcome is logged with `event: "chat:error"` plus
 * the translator's structured `logFields`, then sent as a `chat:error` envelope.
 * For `vento` errors the structured payload rides additively in `ventoError`
 * while `detail` carries a short human-readable string.
 *
 * @param conn Active WebSocket connection wrapper.
 * @param ws Underlying socket context.
 * @param id Client-supplied request id to echo back.
 * @param t Translated chat-error outcome.
 * @param logMessage Log message string for non-aborted outcomes.
 * @param logCtx Extra structured fields to merge into the log entry.
 */
function sendChatError(
  conn: WsConnection,
  ws: WSContext,
  id: string,
  t: TranslatedChatError,
  logMessage: string,
  logCtx: Record<string, unknown>,
): void {
  if (t.kind === "aborted") {
    conn.wsSend(ws, { type: "chat:aborted", id });
    return;
  }
  log.error(logMessage, { event: "chat:error", id, ...logCtx, ...t.logFields });
  if (t.kind === "vento") {
    conn.wsSend(ws, {
      type: "chat:error",
      id,
      detail: t.detail,
      ventoError: t.body,
    });
    return;
  }
  conn.wsSend(ws, { type: "chat:error", id, detail: t.problem.detail });
}

export async function handleChatSend(
  conn: WsConnection,
  ws: WSContext,
  msg: Record<string, unknown>,
): Promise<void> {
  const id = msg.id;
  const series = msg.series;
  const story = msg.story;
  const message = msg.message;

  if (
    typeof id !== "string" ||
    typeof series !== "string" ||
    typeof story !== "string" ||
    typeof message !== "string"
  ) {
    conn.wsSend(ws, { type: "error", detail: "Invalid chat:send parameters" });
    return;
  }

  if (!isValidParam(series) || !isValidParam(story)) {
    conn.wsSend(ws, { type: "chat:error", id, detail: "Invalid series or story name" });
    return;
  }

  if (message.length > MAX_MESSAGE_LENGTH) {
    conn.wsSend(ws, { type: "chat:error", id, detail: "Message exceeds maximum length" });
    return;
  }

  const signal = conn.startGeneration(id);
  try {
    const { config, safePath, hookDispatcher, buildPromptFromStory } = conn.deps;
    const result = await executeChat({
      series,
      name: story,
      message,
      config,
      safePath,
      hookDispatcher,
      buildPromptFromStory,
      onDelta: (content) => {
        conn.wsSend(ws, { type: "chat:delta", id, content });
      },
      signal,
    });
    conn.wsSend(ws, { type: "chat:done", id, usage: result.usage });
  } catch (err: unknown) {
    const t = translateChatError(err, "Failed to process chat request");
    const logMessage = t.kind === "unexpected"
      ? "Chat request failed (unexpected)"
      : "Chat request failed";
    sendChatError(conn, ws, id, t, logMessage, { series, story });
  } finally {
    conn.endGeneration(id, ws);
  }
}

export async function handleChatContinue(
  conn: WsConnection,
  ws: WSContext,
  msg: Record<string, unknown>,
): Promise<void> {
  const id = msg.id;
  const series = msg.series;
  const story = msg.story;

  if (
    typeof id !== "string" ||
    typeof series !== "string" ||
    typeof story !== "string"
  ) {
    conn.wsSend(ws, { type: "error", detail: "Invalid chat:continue parameters" });
    return;
  }

  if (!isValidParam(series) || !isValidParam(story)) {
    conn.wsSend(ws, { type: "chat:error", id, detail: "Invalid series or story name" });
    return;
  }

  // Reuse the same abortControllers map keyed by `id` so a single chat:abort
  // (and the connection-close cleanup loop) cancels chat:send and chat:continue alike.
  const signal = conn.startGeneration(id);
  try {
    const { config, safePath, hookDispatcher, buildContinuePromptFromStory } = conn.deps;
    const result = await executeContinue({
      series,
      name: story,
      config,
      safePath,
      hookDispatcher,
      buildContinuePromptFromStory,
      onDelta: (content) => {
        conn.wsSend(ws, { type: "chat:delta", id, content });
      },
      signal,
    });
    conn.wsSend(ws, { type: "chat:done", id, usage: result.usage });
  } catch (err: unknown) {
    const t = translateChatError(err, "Failed to process chat request");
    const logMessage = t.kind === "unexpected"
      ? "Continue request failed (unexpected)"
      : "Continue request failed";
    sendChatError(conn, ws, id, t, logMessage, { series, story });
  } finally {
    conn.endGeneration(id, ws);
  }
}

export async function handleChatResend(
  conn: WsConnection,
  ws: WSContext,
  msg: Record<string, unknown>,
): Promise<void> {
  const id = msg.id;
  const series = msg.series;
  const story = msg.story;

  if (
    typeof id !== "string" ||
    typeof series !== "string" ||
    typeof story !== "string" ||
    typeof msg.message !== "string"
  ) {
    conn.wsSend(ws, { type: "error", detail: "Invalid chat:resend parameters" });
    return;
  }

  if (!isValidParam(series) || !isValidParam(story)) {
    conn.wsSend(ws, { type: "chat:error", id, detail: "Invalid series or story name" });
    return;
  }

  if ((msg.message as string).length > MAX_MESSAGE_LENGTH) {
    conn.wsSend(ws, { type: "chat:error", id, detail: "Message exceeds maximum length" });
    return;
  }

  // Delete last chapter before re-sending. Validate the path first so an
  // invalid identifier resolves to "Invalid path" before any business guard.
  const storyDir = conn.deps.safePath(series, story);
  if (!storyDir) {
    conn.wsSend(ws, { type: "chat:error", id, detail: "Invalid path" });
    return;
  }

  // Reject deletion while a generation is streaming into this story so the
  // resend cannot unlink the chapter file mid-stream.
  if (isGenerationActive(series, story)) {
    conn.wsSend(ws, { type: "chat:error", id, detail: "Generation in progress for this story" });
    return;
  }

  try {
    // Distinguish a missing story directory ("Story not found") from an
    // existing-but-empty story ("No chapters to delete"); listChapterFiles
    // returns [] on NotFound, so stat first to preserve that distinction.
    await Deno.stat(storyDir);
    const result = await deleteLastChapter(storyDir);
    if (!result.ok) {
      conn.wsSend(ws, { type: "chat:error", id, detail: "No chapters to delete" });
      return;
    }
    fileLog.info("Chapter deleted (resend)", {
      op: "delete",
      storyDir,
      chapter: result.deleted,
    });
  } catch (err: unknown) {
    if (err instanceof Deno.errors.NotFound) {
      conn.wsSend(ws, { type: "chat:error", id, detail: "Story not found" });
      return;
    }
    fileLog.error("Failed to delete last chapter (resend)", {
      op: "delete",
      id,
      series,
      story,
      error: errorMessage(err),
    });
    conn.wsSend(ws, { type: "chat:error", id, detail: "Failed to delete last chapter" });
    return;
  }

  // Proceed with chat:send logic
  await handleChatSend(conn, ws, msg);
}

export function handleChatAbort(
  conn: WsConnection,
  msg: Record<string, unknown>,
): void {
  const id = msg.id;
  if (typeof id !== "string") return;
  conn.abortGeneration(id);
}
