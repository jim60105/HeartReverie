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
import type { Hono } from "@hono/hono";
import type { WSContext } from "@hono/hono/ws";
import type { AppDeps } from "../types.ts";
import { createLogger } from "../lib/logger.ts";
import { WsConnection } from "./ws-connection.ts";
import { getMaxWsConnections } from "./ws-auth.ts";

const log = createLogger("ws");

/**
 * Module-level count of live WebSocket connections that currently occupy a
 * cap slot. A single-process Deno server owns exactly one of these, so a plain
 * integer is authoritative. Incremented once on admission and decremented once
 * on release (see the two-state accounting in the upgrade callback below).
 */
let liveConnections = 0;

/** Test-only accessor for the live-connection count. */
export function getLiveWsConnectionCount(): number {
  return liveConnections;
}

/**
 * Register the WebSocket upgrade route at `/api/ws`.
 * Must be called BEFORE body-limit and auth middleware to bypass them.
 */
export function registerWebSocketRoutes(app: Hono, deps: AppDeps): void {
  app.get(
    "/api/ws",
    upgradeWebSocket((_c) => {
      const conn = new WsConnection(deps);
      // Two-state per-connection accounting so neither an onError-then-onClose
      // ordering nor an upgrade that yields neither callback can leak a slot
      // (permanent denial) or double-decrement (negative count / cap bypass):
      //   counted  — this connection occupies a cap slot (admitted)
      //   released — the slot has already been given back (idempotent release)
      const cap = getMaxWsConnections();
      const admitted = liveConnections < cap;
      let counted = false;
      let released = false;
      if (admitted) {
        liveConnections++;
        counted = true;
      }

      const release = () => {
        if (counted && !released) {
          released = true;
          liveConnections--;
        }
      };

      return {
        onOpen(_evt: Event, ws: WSContext) {
          if (!admitted) {
            // Over the cap: never counted this connection; close immediately.
            log.warn("WebSocket connection rejected — cap reached", {
              event: "cap-reached",
              cap,
            });
            ws.close(1013, "Too many connections");
            return;
          }
          log.info("WebSocket connection established", {
            event: "connected",
            live: liveConnections,
          });
          // Arm the auth-deadline timer only (no idle timer pre-auth).
          conn.armAuthDeadline(ws);
        },
        onMessage(evt: MessageEvent, ws: WSContext) {
          return conn.onMessage(ws, evt);
        },
        onClose(_evt: CloseEvent) {
          log.info("WebSocket connection closed", { event: "closed" });
          conn.dispose();
          release();
        },
        onError(evt: Event) {
          log.error("WebSocket error", { event: "error", detail: String(evt) });
          conn.dispose();
          release();
        },
      };
    }),
  );
}
