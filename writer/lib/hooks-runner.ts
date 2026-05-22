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
 * @module hooks-runner
 *
 * Dispatch-time execution for `HookDispatcher`. Owns the serial/parallel
 * scheduling, per-handler observability event emission, and dispatch
 * metrics recording. Per-handler context-view Proxies live in
 * `hooks-runner-view.ts`. Pure mechanics — no registry state. The
 * dispatcher passes in the already-priority-sorted handler list for each
 * stage.
 */

import { errorMessage } from "./errors.ts";
import type { HandlerEvent, HookStage } from "../types.ts";
import type { Logger } from "./logger.ts";
import { computeTopoLayers, type HandlerEntry } from "./hooks-topo.ts";
import type { DispatchMetric, HookMetricsCollector } from "./hooks-metrics.ts";
import type { HandlerEventBus } from "./hooks-event-bus.ts";
import { captureRefs, cloneAllowlistSnapshot } from "./hooks-snapshot.ts";
import {
  deriveHandlerLogger,
  makeParallelView,
  makeSerialView,
} from "./hooks-runner-view.ts";

interface HandlerStartState {
  ctxBeforeRefs: Record<string, unknown>;
  startTime: number;
}

/**
 * Per-handler observability event helpers. Spec §D3 invariants:
 * - `captureRefs` runs BEFORE `cloneAllowlistSnapshot` in start.
 * - `captureRefs` is re-read BEFORE the post-handler clone in end.
 * - Both helpers no-op (start returns `null`) when `eventBus` has no
 *   subscribers, so the runner can skip ref capture + cloning entirely.
 */
function emitHandlerStart(
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

function emitHandlerEnd(
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

export class HookRunner {
  readonly #log: Logger;
  readonly #metrics: HookMetricsCollector;
  readonly #eventBus: HandlerEventBus;

  constructor(log: Logger, metrics: HookMetricsCollector, eventBus: HandlerEventBus) {
    this.#log = log;
    this.#metrics = metrics;
    this.#eventBus = eventBus;
  }

  /**
   * Execute every handler registered for `stage` against `context`. The
   * caller supplies the already-priority-sorted handler list; the runner
   * partitions it into serial then parallel buckets and records dispatch
   * metrics once the serial pass + parallel scheduling completes.
   *
   * For `response-stream` the parallel bucket runs fire-and-forget so
   * downstream streaming is not blocked by background readOnly observers.
   */
  async dispatch(
    stage: HookStage,
    handlers: readonly HandlerEntry[],
    context: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (handlers.length === 0) return context;

    const correlationId = typeof context.correlationId === "string"
      ? context.correlationId
      : undefined;
    const startTime = performance.now();

    // Split into serial / parallel buckets.
    const serial: HandlerEntry[] = [];
    const parallel: HandlerEntry[] = [];
    for (const entry of handlers) {
      (entry.parallel ? parallel : serial).push(entry);
    }

    // 1. Serial pass — shared base context (§3.11: empty parallel = legacy path)
    for (let i = 0; i < serial.length; i++) {
      await this.#runSerial(stage, serial[i]!, i, context, correlationId);
    }

    // 2. Parallel pass (if any)
    if (parallel.length > 0) {
      // Parallel entries start at handlerIndex = serial.length (sorted dispatch order).
      const parallelBase = serial.length;
      if (stage === "response-stream") {
        // Fire-and-forget: don't await. Background promise handles logging.
        this.#runParallelBucket(stage, parallel, parallelBase, context, correlationId)
          .catch(() => { /* allSettled already handles individual errors */ });
      } else {
        await this.#runParallelBucket(stage, parallel, parallelBase, context, correlationId);
      }
    }

    // Metrics + ring buffer + SSE emit
    const durationMs = Math.round(performance.now() - startTime);
    const dispatchPhase: DispatchMetric["dispatchPhase"] =
      parallel.length === 0 ? "serial" : (serial.length === 0 ? "parallel" : "mixed");
    this.#metrics.recordDispatch(
      stage,
      dispatchPhase,
      durationMs,
      serial.length,
      parallel.length,
      [...serial, ...parallel].map((e) => ({ plugin: e.plugin, errored: e.errorCount > 0 })),
    );

    this.#log.debug("Hook dispatch completed", {
      stage,
      serialCount: serial.length,
      parallelCount: parallel.length,
      dispatchPhase,
      latencyMs: durationMs,
    });
    return context;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Run a single serial handler.
   *
   * The per-handler logger is injected via a `Proxy` view (NOT by mutating
   * `context.logger`), so the underlying context object is left untouched.
   * This lets the dispatcher accept frozen context objects (e.g. the
   * fully-frozen `PostResponsePayload`) without throwing on logger
   * injection. Mutations to any other property pass through to the real
   * context so serial handlers continue to share state with their peers.
   */
  async #runSerial(
    stage: HookStage,
    entry: HandlerEntry,
    handlerIndex: number,
    context: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const handlerLogger = deriveHandlerLogger(entry, correlationId);
    const view = makeSerialView(context, handlerLogger);
    const startState = emitHandlerStart(
      this.#eventBus, stage, entry, handlerIndex, correlationId, context,
    );

    let handlerError: unknown = undefined;
    try {
      await entry.handler(view);
    } catch (err: unknown) {
      handlerError = err;
      entry.errorCount++;
      this.#log.error(`Hook error in stage '${stage}'`, {
        stage,
        plugin: entry.plugin,
        dispatchPhase: "serial",
        error: errorMessage(err),
      });
    }

    if (startState) {
      emitHandlerEnd(
        this.#eventBus, stage, entry, handlerIndex, correlationId, context,
        startState, handlerError,
      );
    }
  }

  /**
   * Run a single parallel handler with a Proxy view of the context.
   * The Proxy intercepts `logger` reads/writes and (under HOOK_DEBUG)
   * logs any other writes as readOnly violations.
   *
   * Per-handler observability events are emitted around the handler call
   * when `subscribeHandlerEvents` has at least one subscriber. Refs are
   * captured from the underlying `context` (not the Proxy view) so identity
   * comparison detects reassignment that bypasses the Proxy.
   */
  async #runParallel(
    stage: HookStage,
    entry: HandlerEntry,
    handlerIndex: number,
    context: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const handlerLogger = deriveHandlerLogger(entry, correlationId);
    const view = makeParallelView(context, handlerLogger, this.#log, entry, stage);
    const startState = emitHandlerStart(
      this.#eventBus, stage, entry, handlerIndex, correlationId, context,
    );

    try {
      await entry.handler(view);
    } catch (err: unknown) {
      // Emit handler-end with error info BEFORE rethrowing so the existing
      // Promise.allSettled / parallel-bucket error accounting in
      // #runParallelBucket continues to work unchanged.
      if (startState) {
        emitHandlerEnd(
          this.#eventBus, stage, entry, handlerIndex, correlationId, context,
          startState, err,
        );
      }
      throw err;
    }

    if (startState) {
      emitHandlerEnd(
        this.#eventBus, stage, entry, handlerIndex, correlationId, context,
        startState, undefined,
      );
    }
  }

  /** Execute the parallel bucket: topo layers × concurrency chunks. */
  async #runParallelBucket(
    stage: HookStage,
    parallel: HandlerEntry[],
    parallelBase: number,
    context: Record<string, unknown>,
    correlationId: string | undefined,
  ): Promise<void> {
    const layers = computeTopoLayers(parallel, this.#log, stage);
    // Map each parallel entry to a stable handlerIndex (dispatch-sorted position).
    const indexOf = new Map<HandlerEntry, number>();
    parallel.forEach((e, i) => indexOf.set(e, parallelBase + i));

    // Effective concurrency = min of all declared
    const declaredConcurrencies = parallel
      .filter((e) => e.concurrency !== undefined)
      .map((e) => e.concurrency!);
    const effectiveConcurrency = declaredConcurrencies.length > 0
      ? Math.min(...declaredConcurrencies)
      : undefined; // unbounded

    for (const layer of layers) {
      const chunkSize = effectiveConcurrency ?? layer.length;
      for (let i = 0; i < layer.length; i += chunkSize) {
        const chunk = layer.slice(i, i + chunkSize);
        const results = await Promise.allSettled(
          chunk.map((entry) => {
            const t0 = performance.now();
            return this.#runParallel(stage, entry, indexOf.get(entry)!, context, correlationId).then(
              () => { this.#metrics.recordStreamWallTime(stage, entry.plugin, performance.now() - t0); },
              (err) => { this.#metrics.recordStreamWallTime(stage, entry.plugin, performance.now() - t0); throw err; },
            );
          }),
        );
        this.#handleParallelResults(stage, chunk, results);
      }
    }
  }

  /** Log errors from parallel-bucket settlement. */
  #handleParallelResults(
    stage: HookStage,
    entries: HandlerEntry[],
    results: PromiseSettledResult<void>[],
  ): void {
    for (let i = 0; i < results.length; i++) {
      const r = results[i]!;
      if (r.status === "rejected") {
        const entry = entries[i]!;
        entry.errorCount++;
        const err = (r as PromiseRejectedResult).reason;
        this.#log.error(`Hook error in stage '${stage}'`, {
          stage,
          plugin: entry.plugin,
          dispatchPhase: "parallel",
          error: {
            message: errorMessage(err),
            stack: err instanceof Error ? err.stack : undefined,
          },
        });
      }
    }
  }
}
