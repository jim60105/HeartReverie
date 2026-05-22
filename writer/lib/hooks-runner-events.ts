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
 * @module hooks-runner-events
 *
 * Per-handler observability event helpers for `HookRunner`. The runner's
 * serial and parallel handler paths both need to capture ref identities +
 * an allowlisted snapshot of the context BEFORE the handler runs, emit a
 * `handler-start` event, then re-capture refs + snapshot AFTER the handler
 * resolves/rejects and emit a `handler-end` event with reassignment + error
 * info.
 *
 * Spec §D3 invariants preserved:
 * - `captureRefs` runs BEFORE `cloneAllowlistSnapshot` in start.
 * - `captureRefs` is re-read BEFORE the post-handler clone in end.
 * - Both helpers no-op (start returns `null`) when `eventBus` has no
 *   subscribers, so the runner can skip ref capture + cloning entirely.
 */

import { errorMessage } from "./errors.ts";
import { captureRefs, cloneAllowlistSnapshot } from "./hooks-snapshot.ts";
import type { HandlerEvent, HookStage } from "../types.ts";
import type { HandlerEntry } from "./hooks-topo.ts";
import type { HandlerEventBus } from "./hooks-event-bus.ts";

export interface HandlerStartState {
  ctxBeforeRefs: Record<string, unknown>;
  startTime: number;
}

export function emitHandlerStart(
  eventBus: HandlerEventBus,
  stage: HookStage,
  entry: HandlerEntry,
  handlerIndex: number,
  correlationId: string | undefined,
  context: Record<string, unknown>,
): HandlerStartState | null {
  if (!eventBus.hasSubscribers()) return null;
  // Capture live refs BEFORE structuredClone runs (spec D3).
  const ctxBeforeRefs = captureRefs(stage, context);
  const ctxBeforeSnapshot = cloneAllowlistSnapshot(stage, context);
  const startTime = performance.now();
  eventBus.emit({
    kind: "handler-start",
    stage,
    plugin: entry.plugin,
    priority: entry.priority,
    handlerIndex,
    correlationId,
    timestamp: startTime,
    ctxBeforeSnapshot,
    ctxBeforeRefs,
  });
  return { ctxBeforeRefs, startTime };
}

export function emitHandlerEnd(
  eventBus: HandlerEventBus,
  stage: HookStage,
  entry: HandlerEntry,
  handlerIndex: number,
  correlationId: string | undefined,
  context: Record<string, unknown>,
  state: HandlerStartState,
  handlerError: unknown,
): void {
  // Re-read live refs BEFORE the post-handler clone (spec D3).
  const ctxAfterRefs = captureRefs(stage, context);
  const reassigned: string[] = [];
  for (const k of Object.keys(state.ctxBeforeRefs)) {
    if (ctxAfterRefs[k] !== state.ctxBeforeRefs[k]) reassigned.push(k);
  }
  reassigned.sort();
  const ctxAfterSnapshot = cloneAllowlistSnapshot(stage, context);
  const endTime = performance.now();
  const event: HandlerEvent = {
    kind: "handler-end",
    stage,
    plugin: entry.plugin,
    priority: entry.priority,
    handlerIndex,
    correlationId,
    timestamp: endTime,
    ctxAfterSnapshot,
    ctxAfterRefs,
    reassigned,
    error: handlerError !== undefined
      ? {
          message: errorMessage(handlerError),
          name: handlerError instanceof Error ? handlerError.name : "Error",
        }
      : undefined,
    durationMs: endTime - state.startTime,
  };
  eventBus.emit(event);
}
