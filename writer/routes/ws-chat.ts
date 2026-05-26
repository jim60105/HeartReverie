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

import { join } from "@std/path";
import type { WSContext } from "@hono/hono/ws";
import { errorMessage } from "../lib/errors.ts";
import { isValidParam } from "../lib/middleware.ts";
import { createLogger } from "../lib/logger.ts";
import { ChatAbortError, ChatError, executeChat, executeContinue } from "../lib/chat-shared.ts";
import { pruneUsage } from "../lib/usage.ts";
import { MAX_MESSAGE_LENGTH } from "./ws-auth.ts";
import type { WsConnection } from "./ws-connection.ts";

const log = createLogger("ws");
const fileLog = createLogger("file");

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
    if (err instanceof ChatAbortError) {
      conn.wsSend(ws, { type: "chat:aborted", id });
      return;
    }
    const detail = err instanceof ChatError ? err.message : "Failed to process chat request";
    if (err instanceof ChatError) {
      log.error("Chat request failed", {
        event: "chat:error",
        id,
        series,
        story,
        code: err.code,
        httpStatus: err.httpStatus,
        detail: err.message,
        ventoError: err.ventoError,
      });
    } else {
      log.error("Chat request failed (unexpected)", {
        event: "chat:error",
        id,
        series,
        story,
        error: errorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
    conn.wsSend(ws, { type: "chat:error", id, detail });
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
    if (err instanceof ChatAbortError) {
      conn.wsSend(ws, { type: "chat:aborted", id });
      return;
    }
    const detail = err instanceof ChatError ? err.message : "Failed to process chat request";
    if (err instanceof ChatError) {
      log.error("Continue request failed", {
        event: "chat:error",
        id,
        series,
        story,
        code: err.code,
        httpStatus: err.httpStatus,
        detail: err.message,
        ventoError: err.ventoError,
      });
    } else {
      log.error("Continue request failed (unexpected)", {
        event: "chat:error",
        id,
        series,
        story,
        error: errorMessage(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
    conn.wsSend(ws, { type: "chat:error", id, detail });
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

  // Delete last chapter before re-sending
  const storyDir = conn.deps.safePath(series, story);
  if (!storyDir) {
    conn.wsSend(ws, { type: "chat:error", id, detail: "Invalid path" });
    return;
  }

  try {
    const entries: string[] = [];
    for await (const entry of Deno.readDir(storyDir)) {
      entries.push(entry.name);
    }
    const chapterFiles = entries
      .filter((f) => /^\d+\.md$/.test(f))
      .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

    if (chapterFiles.length === 0) {
      conn.wsSend(ws, { type: "chat:error", id, detail: "No chapters to delete" });
      return;
    }

    const lastFile = chapterFiles[chapterFiles.length - 1]!;
    const lastNum = parseInt(lastFile, 10);
    await Deno.remove(join(storyDir, lastFile));
    fileLog.info("Chapter deleted (resend)", { op: "delete", path: join(storyDir, lastFile) });

    // Best-effort cleanup of state/diff artifacts for the deleted chapter
    const padded = String(lastNum).padStart(3, "0");
    await Promise.allSettled([
      Deno.remove(join(storyDir, `${padded}-state.yaml`)),
      Deno.remove(join(storyDir, `${padded}-state-diff.yaml`)),
      Deno.remove(join(storyDir, "current-status.yaml")),
    ]);

    // Prune stale usage records for the deleted chapter
    await pruneUsage(storyDir, lastNum - 1);
  } catch (err: unknown) {
    if (err instanceof Deno.errors.NotFound) {
      conn.wsSend(ws, { type: "chat:error", id, detail: "Story not found" });
      return;
    }
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
