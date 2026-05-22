/**
 * @module hooks-metrics
 *
 * `HookMetricsCollector` owns the metrics ring buffer, SSE subscriber set,
 * and `response-stream` sliding-window wall-time bookkeeping that previously
 * lived directly on `HookDispatcher`. It has no dependency on the dispatcher
 * itself — the dispatcher composes one and forwards `recordDispatch` /
 * `recordStreamWallTime` calls at the appropriate points.
 *
 * Module is internal to `writer/lib`. `DispatchMetric` is re-exported from
 * `hooks.ts` so existing consumers (`writer/routes/_debug-hooks.ts`) keep
 * their imports unchanged.
 */

import type { HookStage } from "../types.ts";
import type { Logger } from "./logger.ts";

/** Per-dispatch telemetry pushed to the ring buffer and SSE subscribers. */
export interface DispatchMetric {
  stage: string;
  dispatchPhase: "serial" | "parallel" | "mixed";
  durationMs: number;
  serialCount: number;
  parallelCount: number;
  plugins: Array<{ plugin: string; durationMs: number; errored: boolean }>;
  timestamp: number;
}

/** Minimal handler info the collector needs to build a metric row. */
export interface MetricHandlerInfo {
  readonly plugin: string | undefined;
  readonly errored: boolean;
}

export const METRICS_BUFFER_CAP = 200;
export const SLIDING_WINDOW_SIZE = 50;
export const SLIDING_WINDOW_WARN_MS = 5;

export class HookMetricsCollector {
  readonly #log: Logger;
  readonly #metricsBuffer: DispatchMetric[] = [];
  readonly #sseSubscribers: Set<(metric: DispatchMetric) => void> = new Set();
  // response-stream sliding window: plugin → last N wall-times (ms)
  readonly #streamWallTimes: Map<string, number[]> = new Map();
  // Track whether we've already warned for a given handler (reset on crossing back below threshold)
  readonly #streamWarnedSinceCrossing: Map<string, boolean> = new Map();

  constructor(log: Logger) {
    this.#log = log;
  }

  /** Return a shallow copy of the ring buffer. */
  getMetricsBuffer(): DispatchMetric[] {
    return [...this.#metricsBuffer];
  }

  /** Subscribe to per-dispatch SSE events. */
  subscribeSSE(cb: (metric: DispatchMetric) => void): void {
    this.#sseSubscribers.add(cb);
  }

  /** Unsubscribe from per-dispatch SSE events. */
  unsubscribeSSE(cb: (metric: DispatchMetric) => void): void {
    this.#sseSubscribers.delete(cb);
  }

  /**
   * Record wall-time for response-stream parallel handlers. When the
   * sliding-window average exceeds 5 ms, emit a one-time soft warn.
   */
  recordStreamWallTime(stage: HookStage, plugin: string | undefined, wallTimeMs: number): void {
    if (stage !== "response-stream") return;
    const key = plugin ?? "<anonymous>";
    let window = this.#streamWallTimes.get(key);
    if (!window) {
      window = [];
      this.#streamWallTimes.set(key, window);
    }
    window.push(wallTimeMs);
    if (window.length > SLIDING_WINDOW_SIZE) {
      window.shift();
    }

    if (window.length === SLIDING_WINDOW_SIZE) {
      const avg = window.reduce((a, b) => a + b, 0) / window.length;
      if (avg > SLIDING_WINDOW_WARN_MS) {
        if (!this.#streamWarnedSinceCrossing.get(key)) {
          this.#streamWarnedSinceCrossing.set(key, true);
          this.#log.warn("response-stream parallel handler exceeds 5ms average wall-time", {
            plugin: key,
            stage: "response-stream",
            avgMs: Math.round(avg * 100) / 100,
            samples: SLIDING_WINDOW_SIZE,
          });
        }
      } else {
        // Reset warn flag when crossing back below threshold
        this.#streamWarnedSinceCrossing.set(key, false);
      }
    }
  }

  /** Push a metric to the ring buffer and notify SSE subscribers. */
  recordDispatch(
    stage: string,
    dispatchPhase: DispatchMetric["dispatchPhase"],
    durationMs: number,
    serialCount: number,
    parallelCount: number,
    handlers: readonly MetricHandlerInfo[],
  ): void {
    const metric: DispatchMetric = {
      stage,
      dispatchPhase,
      durationMs,
      serialCount,
      parallelCount,
      plugins: handlers.map((h) => ({
        plugin: h.plugin ?? "<anonymous>",
        durationMs: 0, // per-handler timing tracked separately for response-stream
        errored: h.errored,
      })),
      timestamp: Date.now(),
    };

    this.#metricsBuffer.push(metric);
    if (this.#metricsBuffer.length > METRICS_BUFFER_CAP) {
      this.#metricsBuffer.shift();
    }

    for (const cb of this.#sseSubscribers) {
      try { cb(metric); } catch { /* subscriber error must not break dispatch */ }
    }
  }
}
