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
import type { AppDeps, WsServerMessage } from "../types.ts";
import { createLogger } from "../lib/logger.ts";
import {
  getAuthDeadlineMs,
  IDLE_TIMEOUT_MS,
  PRE_AUTH_PAYLOAD_CAP_BYTES,
  verifyWsPassphrase,
} from "./ws-auth.ts";
import { handleSubscribe } from "./ws-subscribe.ts";
import {
  handleChatAbort,
  handleChatContinue,
  handleChatResend,
  handleChatSend,
} from "./ws-chat.ts";
import { handlePluginActionAbort, handlePluginActionRun } from "./ws-plugin-action.ts";

const log = createLogger("ws");
const authLog = createLogger("auth");

/**
 * Per-connection state and helpers for a single `/api/ws` WebSocket session.
 *
 * Owns the idle timer, abort-controller map, active-generation counter, and
 * subscription interval. Handler modules import this class as a type only and
 * mutate state exclusively through its public methods, which makes the
 * disposal flag (`#disposed`) the single guard preventing post-close timer
 * resurrection or sends on a closed socket.
 */
export class WsConnection {
  readonly deps: AppDeps;
  #authenticated = false;
  #subscriptionIntervalId: ReturnType<typeof setInterval> | null = null;
  #idleTimer: ReturnType<typeof setTimeout> | null = null;
  #authDeadlineTimer: ReturnType<typeof setTimeout> | null = null;
  #activeGenerations = 0;
  readonly #abortControllers = new Map<string, AbortController>();
  #disposed = false;

  constructor(deps: AppDeps) {
    this.deps = deps;
  }

  /** Send a typed server message, silently skipping if connection is closed or disposed. */
  wsSend(ws: WSContext, msg: WsServerMessage): void {
    if (this.#disposed) return;
    try {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(msg));
      }
    } catch {
      // Silently skip if WebSocket is closed or errored
    }
  }

  /**
   * Arm the one-shot auth-deadline timer for an unauthenticated connection.
   * Pre-auth messages do NOT reset this timer, so an unauthenticated peer
   * cannot keep the socket open indefinitely. Called from `onOpen`. On expiry
   * the connection is closed with 4002. The 60s idle timer is NOT armed until
   * authentication succeeds, so there is no pre-auth timer overlap.
   */
  armAuthDeadline(ws: WSContext): void {
    if (this.#disposed) return;
    this.#authDeadlineTimer = setTimeout(() => {
      this.wsSend(ws, { type: "error", detail: "Authentication deadline exceeded" });
      ws.close(4002, "Authentication deadline exceeded");
    }, getAuthDeadlineMs());
  }

  #clearAuthDeadline(): void {
    if (this.#authDeadlineTimer !== null) {
      clearTimeout(this.#authDeadlineTimer);
      this.#authDeadlineTimer = null;
    }
  }

  /** Reset idle timer. Suppressed during active generations or subscriptions. */
  resetIdleTimer(ws: WSContext): void {
    if (this.#disposed) return;
    if (this.#idleTimer !== null) clearTimeout(this.#idleTimer);
    if (this.#activeGenerations > 0 || this.#subscriptionIntervalId !== null) return;
    this.#idleTimer = setTimeout(() => {
      this.wsSend(ws, { type: "error", detail: "Idle timeout" });
      ws.close(4002, "Idle timeout");
    }, IDLE_TIMEOUT_MS);
  }

  clearSubscription(): void {
    if (this.#subscriptionIntervalId !== null) {
      clearInterval(this.#subscriptionIntervalId);
      this.#subscriptionIntervalId = null;
    }
  }

  setSubscriptionInterval(id: ReturnType<typeof setInterval>): void {
    if (this.#disposed) {
      clearInterval(id);
      return;
    }
    this.#subscriptionIntervalId = id;
  }

  /** Begin tracking a generation: install an AbortController, bump counter. */
  startGeneration(id: string): AbortSignal {
    if (this.#disposed) {
      // Return a pre-aborted signal so any post-dispose start unwinds immediately.
      const controller = new AbortController();
      controller.abort();
      return controller.signal;
    }
    this.#activeGenerations++;
    const controller = new AbortController();
    this.#abortControllers.set(id, controller);
    return controller.signal;
  }

  /** End a tracked generation: drop controller, decrement counter, refresh idle timer. */
  endGeneration(id: string, ws: WSContext): void {
    this.#abortControllers.delete(id);
    // Guard against double-decrement when dispose() raced ahead of a handler's `finally`.
    this.#activeGenerations = Math.max(0, this.#activeGenerations - 1);
    this.resetIdleTimer(ws);
  }

  /** Abort an in-flight generation by id. No-op if unknown. */
  abortGeneration(id: string): void {
    const controller = this.#abortControllers.get(id);
    if (!controller) return;
    controller.abort();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.clearSubscription();
    this.#clearAuthDeadline();
    if (this.#idleTimer !== null) {
      clearTimeout(this.#idleTimer);
      this.#idleTimer = null;
    }
    // Abort all active generations on disconnect to save tokens.
    // The same abortControllers map holds entries for chat:send, chat:continue,
    // and plugin-action:run, so this loop cancels every in-flight flow.
    for (const controller of this.#abortControllers.values()) {
      controller.abort();
    }
    this.#abortControllers.clear();
    this.#activeGenerations = 0;
  }

  /** Dispatch an incoming WebSocket message: auth gate, then by type. */
  async onMessage(ws: WSContext, evt: MessageEvent): Promise<void> {
    if (this.#disposed) return;

    // Pre-auth hardening (Finding 3): unauthenticated connections are governed
    // ONLY by the auth-deadline timer (armed in onOpen). Pre-auth messages must
    // NOT reset any timer, so we only reset the idle timer once authenticated.
    if (this.#authenticated) {
      this.resetIdleTimer(ws);
    } else {
      // The `auth` envelope is always a JSON text frame. Reject any non-string
      // (binary Blob/ArrayBuffer/typed-array) pre-auth frame OUTRIGHT: measuring
      // `String(evt.data).length` on a binary frame yields a tiny string like
      // "[object Blob]", which would let a multi-MB binary payload bypass the
      // byte cap. Closing here (1003 Unsupported Data) keeps the cap sound.
      if (typeof evt.data !== "string") {
        authLog.warn("WebSocket pre-auth binary frame rejected", { source: "ws" });
        ws.close(1003, "Binary frames not supported before authentication");
        return;
      }
      // Cap the pre-auth payload BEFORE JSON.parse — bodyLimit does not cover
      // WebSocket payloads. Measure the byte length of the payload delivered to
      // the handler (the Deno adapter reassembles fragments at the message level).
      const byteLen = new TextEncoder().encode(evt.data).length;
      if (byteLen > PRE_AUTH_PAYLOAD_CAP_BYTES) {
        authLog.warn("WebSocket pre-auth payload exceeds cap", {
          source: "ws",
          bytes: byteLen,
          cap: PRE_AUTH_PAYLOAD_CAP_BYTES,
        });
        ws.close(1009, "Message too large");
        return;
      }
    }

    let data: unknown;
    try {
      data = JSON.parse(String(evt.data));
    } catch {
      this.wsSend(ws, { type: "error", detail: "Invalid JSON" });
      return;
    }

    if (typeof data !== "object" || data === null || !("type" in data)) {
      this.wsSend(ws, { type: "error", detail: "Invalid JSON" });
      return;
    }

    const msg = data as Record<string, unknown>;
    const type = msg.type;

    // First message MUST be auth. Any other pre-auth message is a protocol
    // violation: reply with an error and CLOSE the socket (4001) rather than
    // leaving it open for an unauthenticated peer to hold cheaply.
    if (!this.#authenticated) {
      if (type !== "auth") {
        this.wsSend(ws, { type: "error", detail: "Not authenticated" });
        ws.close(4001, "Not authenticated");
        return;
      }

      const passphrase = msg.passphrase;
      if (typeof passphrase !== "string" || !verifyWsPassphrase(passphrase)) {
        authLog.warn("WebSocket auth failed", { source: "ws", success: false });
        this.wsSend(ws, { type: "auth:error", detail: "Invalid passphrase" });
        ws.close(4001, "Invalid passphrase");
        return;
      }

      this.#authenticated = true;
      // Auth succeeded: clear the auth-deadline timer and start the normal
      // idle timer (which inbound activity resets thereafter).
      this.#clearAuthDeadline();
      this.resetIdleTimer(ws);
      authLog.info("WebSocket auth successful", { source: "ws", success: true });
      this.wsSend(ws, { type: "auth:ok" });
      return;
    }

    log.debug("WebSocket message received", { event: "message", messageType: type as string });

    // Dispatch authenticated messages by type
    switch (type) {
      case "subscribe":
        await handleSubscribe(this, ws, msg);
        break;
      case "chat:send":
        await handleChatSend(this, ws, msg);
        break;
      case "chat:continue":
        await handleChatContinue(this, ws, msg);
        break;
      case "chat:resend":
        await handleChatResend(this, ws, msg);
        break;
      case "chat:abort":
        handleChatAbort(this, msg);
        break;
      case "plugin-action:run":
        await handlePluginActionRun(this, ws, msg);
        break;
      case "plugin-action:abort":
        handlePluginActionAbort(this, msg);
        break;
        // Unknown types: silently ignore
    }
  }
}
