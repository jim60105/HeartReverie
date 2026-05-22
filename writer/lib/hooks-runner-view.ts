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

/**
 * @module hooks-runner-view
 *
 * Per-handler context view helpers used by `HookRunner`. Two flavours of
 * Proxy:
 *
 * - Serial view intercepts only `logger` reads/writes so handlers see
 *   their per-handler logger without mutating the shared context (which
 *   may be frozen, e.g. `PostResponsePayload`).
 * - Parallel view additionally logs readOnly-contract violations under
 *   `HOOK_DEBUG=1` whenever a handler writes any non-`logger` property.
 *
 * Plus a small factory that picks the right logger (entry.baseLogger ↦
 * withContext or a fresh plugin logger) for the current correlationId.
 */

import { createLogger, type Logger } from "./logger.ts";
import type { HandlerEntry } from "./hooks-topo.ts";
import type { HookStage } from "../types.ts";

export function deriveHandlerLogger(
  entry: HandlerEntry,
  correlationId?: string,
): unknown {
  const { plugin, baseLogger } = entry;
  if (baseLogger) {
    return correlationId ? baseLogger.withContext({ correlationId }) : baseLogger;
  }
  const baseData: Record<string, unknown> = {};
  if (plugin) baseData.plugin = plugin;
  return createLogger("plugin", {
    ...(correlationId ? { correlationId } : {}),
    baseData,
  });
}

export function makeSerialView(
  context: Record<string, unknown>,
  handlerLogger: unknown,
): Record<string, unknown> {
  return new Proxy(context, {
    get(target, prop, receiver) {
      if (prop === "logger") return handlerLogger;
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (prop === "logger") return true; // per-handler logger is immutable
      return Reflect.set(target, prop, value, receiver);
    },
  });
}

export function makeParallelView(
  context: Record<string, unknown>,
  handlerLogger: unknown,
  log: Logger,
  entry: HandlerEntry,
  stage: HookStage,
): Record<string, unknown> {
  return new Proxy(context, {
    get(target, prop, receiver) {
      if (prop === "logger") return handlerLogger;
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (prop === "logger") return true; // no-op — per-handler logger is immutable
      if (Deno.env.get("HOOK_DEBUG") === "1") {
        log.warn("Parallel handler violated readOnly contract", {
          plugin: entry.plugin,
          stage,
          mutatedKey: String(prop),
          dispatchPhase: "parallel",
        });
      }
      return Reflect.set(target, prop, value, receiver);
    },
  });
}
