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

import { upgradeWebSocket } from "@hono/hono/deno";
import { timingSafeEqual } from "@std/crypto/timing-safe-equal";
import { join } from "@std/path";
import { isValidParam } from "../lib/middleware.ts";
import { executeChat, ChatError, ChatAbortError } from "../lib/chat-shared.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { WSContext } from "@hono/hono/ws";
import type { AppDeps, WsServerMessage } from "../types.ts";

const log = createLogger("ws");
const authLog = createLogger("auth");
const fileLog = createLogger("file");

const IDLE_TIMEOUT_MS = 60_000;
const MAX_MESSAGE_LENGTH = 100_000;

/**
 * Verify a passphrase using timing-safe comparison (mirrors middleware.ts logic).
 * @param passphrase - Client-provided passphrase to verify
 * @returns true if the passphrase matches the configured PASSPHRASE
 */
function verifyWsPassphrase(passphrase: string): boolean {
  const expected = Deno.env.get("PASSPHRASE");
  if (!expected) return false;

  const encoder = new TextEncoder();
  const expectedBuf = encoder.encode(expected);
  const providedBuf = encoder.encode(passphrase);
  const lengthMatch = expectedBuf.length === providedBuf.length;
  // Always call timingSafeEqual on equal-length buffers to prevent timing leaks
  const safeBuf = lengthMatch ? providedBuf : new Uint8Array(expectedBuf.length);
  const equal = timingSafeEqual(expectedBuf, safeBuf);
  return (Number(lengthMatch) & Number(equal)) === 1;
}

/**
 * Register the WebSocket upgrade route at `/api/ws`.
 * Must be called BEFORE body-limit and auth middleware to bypass them.
 */
export function registerWebSocketRoutes(app: Hono, deps: AppDeps): void {
  const { safePath, hookDispatcher, buildPromptFromStory, config } = deps;

  app.get("/api/ws", upgradeWebSocket((_c) => {
    // ── Per-connection state ──
    let authenticated = false;
    let subscriptionIntervalId: number | null = null;
    let idleTimer: number | null = null;
    let activeGenerations = 0;
    const abortControllers = new Map<string, AbortController>();

    // ── Helper functions ──

    /** Send a typed server message, silently skipping if connection is closed. */
    function wsSend(ws: WSContext, msg: WsServerMessage): void {
      try {
        if (ws.readyState === 1) {
          ws.send(JSON.stringify(msg));
        }
      } catch {
        // Silently skip if WebSocket is closed or errored
      }
    }

    /** Reset idle timer. Suppressed during active generations or subscriptions. */
    function resetIdleTimer(ws: WSContext): void {
      if (idleTimer !== null) clearTimeout(idleTimer);
      if (activeGenerations > 0 || subscriptionIntervalId !== null) return;
      idleTimer = setTimeout(() => {
        wsSend(ws, { type: "error", detail: "Idle timeout" });
        ws.close(4002, "Idle timeout");
      }, IDLE_TIMEOUT_MS);
    }

    function clearSubscription(): void {
      if (subscriptionIntervalId !== null) {
        clearInterval(subscriptionIntervalId);
        subscriptionIntervalId = null;
      }
    }

    function cleanup(): void {
      clearSubscription();
      if (idleTimer !== null) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      // Abort all active generations on disconnect to save tokens
      for (const controller of abortControllers.values()) {
        controller.abort(new ChatAbortError("Connection closed"));
      }
      abortControllers.clear();
    }

    // ── Message handlers ──

    async function handleSubscribe(ws: WSContext, msg: Record<string, unknown>): Promise<void> {
      const series = msg.series;
      const story = msg.story;

      if (typeof series !== "string" || typeof story !== "string") {
        wsSend(ws, { type: "error", detail: "Invalid subscribe parameters" });
        return;
      }

      if (!isValidParam(series) || !isValidParam(story)) {
        wsSend(ws, { type: "error", detail: "Invalid series or story name" });
        return;
      }

      const storyDir = safePath(series, story);
      if (!storyDir) {
        wsSend(ws, { type: "error", detail: "Invalid path" });
        return;
      }

      // Replace previous subscription
      clearSubscription();

      let prevCount = -1;
      let prevLastContent = "";

      subscriptionIntervalId = setInterval(async () => {
        try {
          const entries: string[] = [];
          try {
            for await (const entry of Deno.readDir(storyDir)) {
              entries.push(entry.name);
            }
          } catch {
            return; // Directory may not exist yet
          }

          const chapterFiles = entries
            .filter((f) => /^\d+\.md$/.test(f))
            .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

          const count = chapterFiles.length;

          if (count !== prevCount) {
            prevCount = count;
            wsSend(ws, { type: "chapters:updated", series, story, count });
          }

          if (count > 0) {
            const lastFile = chapterFiles[count - 1]!;
            const lastNum = parseInt(lastFile, 10);
            try {
              const content = await Deno.readTextFile(join(storyDir, lastFile));
              if (content !== prevLastContent) {
                prevLastContent = content;
                wsSend(ws, {
                  type: "chapters:content",
                  series,
                  story,
                  chapter: lastNum,
                  content,
                });
              }
            } catch {
              // File may be in the process of being written
            }
          }
        } catch {
          // Ignore errors in polling
        }
      }, 1_000);
    }

    async function handleChatSend(ws: WSContext, msg: Record<string, unknown>): Promise<void> {
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
        wsSend(ws, { type: "error", detail: "Invalid chat:send parameters" });
        return;
      }

      if (!isValidParam(series) || !isValidParam(story)) {
        wsSend(ws, { type: "chat:error", id, detail: "Invalid series or story name" });
        return;
      }

      if (message.length > MAX_MESSAGE_LENGTH) {
        wsSend(ws, { type: "chat:error", id, detail: "Message exceeds maximum length" });
        return;
      }

      activeGenerations++;
      const controller = new AbortController();
      abortControllers.set(id, controller);
      try {
        await executeChat({
          series,
          name: story,
          message,
          config,
          safePath,
          hookDispatcher,
          buildPromptFromStory,
          onDelta: (content) => {
            wsSend(ws, { type: "chat:delta", id, content });
          },
          signal: controller.signal,
        });
        wsSend(ws, { type: "chat:done", id });
      } catch (err: unknown) {
        if (err instanceof ChatAbortError) {
          wsSend(ws, { type: "chat:aborted", id });
          return;
        }
        const detail = err instanceof ChatError
          ? err.message
          : "Failed to process chat request";
        wsSend(ws, { type: "chat:error", id, detail });
      } finally {
        abortControllers.delete(id);
        activeGenerations--;
        resetIdleTimer(ws);
      }
    }

    async function handleChatResend(ws: WSContext, msg: Record<string, unknown>): Promise<void> {
      const id = msg.id;
      const series = msg.series;
      const story = msg.story;

      if (
        typeof id !== "string" ||
        typeof series !== "string" ||
        typeof story !== "string" ||
        typeof msg.message !== "string"
      ) {
        wsSend(ws, { type: "error", detail: "Invalid chat:resend parameters" });
        return;
      }

      if (!isValidParam(series) || !isValidParam(story)) {
        wsSend(ws, { type: "chat:error", id, detail: "Invalid series or story name" });
        return;
      }

      if ((msg.message as string).length > MAX_MESSAGE_LENGTH) {
        wsSend(ws, { type: "chat:error", id, detail: "Message exceeds maximum length" });
        return;
      }

      // Delete last chapter before re-sending
      const storyDir = safePath(series, story);
      if (!storyDir) {
        wsSend(ws, { type: "chat:error", id, detail: "Invalid path" });
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
          wsSend(ws, { type: "chat:error", id, detail: "No chapters to delete" });
          return;
        }

        const lastFile = chapterFiles[chapterFiles.length - 1]!;
        await Deno.remove(join(storyDir, lastFile));
        fileLog.info("Chapter deleted (resend)", { op: "delete", path: join(storyDir, lastFile) });
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          wsSend(ws, { type: "chat:error", id, detail: "Story not found" });
          return;
        }
        wsSend(ws, { type: "chat:error", id, detail: "Failed to delete last chapter" });
        return;
      }

      // Proceed with chat:send logic
      await handleChatSend(ws, msg);
    }

    function handleChatAbort(_ws: WSContext, msg: Record<string, unknown>): void {
      const id = msg.id;
      if (typeof id !== "string") return;

      const controller = abortControllers.get(id);
      if (!controller) return;

      controller.abort(new ChatAbortError("Generation aborted by client"));
    }

    // ── WebSocket event handlers ──

    return {
      onOpen(_evt: Event, ws: WSContext) {
        log.info("WebSocket connection established", { event: "connected" });
        resetIdleTimer(ws);
      },

      async onMessage(evt: MessageEvent, ws: WSContext) {
        resetIdleTimer(ws);

        // Parse JSON
        let data: unknown;
        try {
          data = JSON.parse(String(evt.data));
        } catch {
          wsSend(ws, { type: "error", detail: "Invalid JSON" });
          return;
        }

        if (typeof data !== "object" || data === null || !("type" in data)) {
          wsSend(ws, { type: "error", detail: "Invalid JSON" });
          return;
        }

        const msg = data as Record<string, unknown>;
        const type = msg.type;

        // First message must be auth
        if (!authenticated) {
          if (type !== "auth") {
            wsSend(ws, { type: "error", detail: "Not authenticated" });
            return;
          }

          const passphrase = msg.passphrase;
          if (typeof passphrase !== "string" || !verifyWsPassphrase(passphrase)) {
            authLog.warn("WebSocket auth failed", { source: "ws", success: false });
            wsSend(ws, { type: "auth:error", detail: "Invalid passphrase" });
            ws.close(4001, "Invalid passphrase");
            return;
          }

          authenticated = true;
          authLog.info("WebSocket auth successful", { source: "ws", success: true });
          wsSend(ws, { type: "auth:ok" });
          return;
        }

        log.debug("WebSocket message received", { event: "message", messageType: type as string });

        // Dispatch authenticated messages by type
        switch (type) {
          case "subscribe":
            await handleSubscribe(ws, msg);
            break;
          case "chat:send":
            await handleChatSend(ws, msg);
            break;
          case "chat:resend":
            await handleChatResend(ws, msg);
            break;
          case "chat:abort":
            handleChatAbort(ws, msg);
            break;
          // Unknown types: silently ignore
        }
      },

      onClose(_evt: CloseEvent) {
        log.info("WebSocket connection closed", { event: "closed" });
        cleanup();
      },

      onError(evt: Event) {
        log.error("WebSocket error", { event: "error", detail: String(evt) });
        cleanup();
      },
    };
  }));
}
