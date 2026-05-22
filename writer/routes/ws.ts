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

const log = createLogger("ws");

/**
 * Register the WebSocket upgrade route at `/api/ws`.
 * Must be called BEFORE body-limit and auth middleware to bypass them.
 */
export function registerWebSocketRoutes(app: Hono, deps: AppDeps): void {
  app.get("/api/ws", upgradeWebSocket((_c) => {
    const conn = new WsConnection(deps);
    return {
      onOpen(_evt: Event, ws: WSContext) {
        log.info("WebSocket connection established", { event: "connected" });
        conn.resetIdleTimer(ws);
      },
      onMessage(evt: MessageEvent, ws: WSContext) {
        return conn.onMessage(ws, evt);
      },
      onClose(_evt: CloseEvent) {
        log.info("WebSocket connection closed", { event: "closed" });
        conn.dispose();
      },
      onError(evt: Event) {
        log.error("WebSocket error", { event: "error", detail: String(evt) });
        conn.dispose();
      },
    };
  }));
}
