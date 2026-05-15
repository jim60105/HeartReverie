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

import type { HookStage, HookHandler, RegisterOptions } from "../types.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";

const log = createLogger("plugin");

export const PARALLEL_ALLOWED: ReadonlySet<string> = new Set([
  "prompt-assembly",
  "post-response",
  "response-stream",
]);

export const HOOK_DEBUG = Deno.env.get("HOOK_DEBUG") === "1";

interface HandlerEntry {
  readonly handler: HookHandler;
  readonly priority: number;
  readonly plugin?: string;
  readonly baseLogger?: Logger;
  readonly parallel: boolean;
  readonly readOnly: boolean;
  readonly concurrency?: number;
  readonly dependsOn?: readonly string[];
  errorCount: number;
}

/**
 * Backend hook stages registered via `HookDispatcher.register()`.
 * Note: `strip-tags` is intentionally NOT in this set — it is a declarative
 * manifest field (`promptStripTags` / `displayStripTags`), not a runtime hook.
 */
export const KNOWN_BACKEND_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "prompt-assembly",
  "response-stream",
  "pre-write",
  "post-response",
]);

export const VALID_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "prompt-assembly",
  "response-stream",
  "pre-write",
  "post-response",
  "strip-tags",
]);

/** Per-stage handler info returned by `HookDispatcher.introspect()`. */
export interface HandlerIntrospection {
  readonly plugin: string | undefined;
  readonly priority: number;
  readonly errorCount: number;
}

/** Ring buffer entry emitted per dispatch() call. */
export interface DispatchMetric {
  stage: string;
  dispatchPhase: "serial" | "parallel" | "mixed";
  durationMs: number;
  serialCount: number;
  parallelCount: number;
  plugins: Array<{ plugin: string; durationMs: number; errored: boolean }>;
  timestamp: number;
}

const METRICS_BUFFER_CAP = 200;
const SLIDING_WINDOW_SIZE = 50;
const SLIDING_WINDOW_WARN_MS = 5;

export class HookDispatcher {
  #handlers: Map<HookStage, HandlerEntry[]> = new Map();
  #metricsBuffer: DispatchMetric[] = [];
  #sseSubscribers: Set<(metric: DispatchMetric) => void> = new Set();
  // response-stream sliding window: plugin → last N wall-times (ms)
  #streamWallTimes: Map<string, number[]> = new Map();
  // Track whether we've already warned for a given handler (reset on crossing back below threshold)
  #streamWarnedSinceCrossing: Map<string, boolean> = new Map();

  /**
   * Register a handler for a given hook stage.
   *
   * The third parameter accepts either a numeric priority (legacy positional
   * API) or a `RegisterOptions` object for the full parallel-dispatch feature
   * set. When called by PluginManager, the 4th and 5th params supply the
   * plugin name and base logger for internal logger derivation.
   */
  register(
    stage: HookStage,
    handler: HookHandler,
    priorityOrOptions?: number | (RegisterOptions & { concurrency?: number }),
    plugin?: string,
    baseLogger?: Logger,
  ): void {
    if (!VALID_STAGES.has(stage)) {
      throw new Error(
        `Invalid hook stage '${stage}'. Valid stages: ${[...VALID_STAGES].join(", ")}`
      );
    }
    if (typeof handler !== "function") {
      throw new Error("Hook handler must be a function");
    }

    // Resolve options from the overloaded third parameter
    let priority = 100;
    let parallel = false;
    let readOnly = false;
    let concurrency: number | undefined;
    let dependsOn: readonly string[] | undefined;

    if (typeof priorityOrOptions === "number") {
      priority = priorityOrOptions;
    } else if (priorityOrOptions != null && typeof priorityOrOptions === "object") {
      priority = priorityOrOptions.priority ?? 100;
      parallel = priorityOrOptions.parallel ?? false;
      readOnly = priorityOrOptions.readOnly ?? false;
      concurrency = priorityOrOptions.concurrency;
      dependsOn = priorityOrOptions.dependsOn;

      // Track B: readOnly:true + parallel not explicitly set → auto-promote
      if (readOnly && priorityOrOptions.parallel === undefined && PARALLEL_ALLOWED.has(stage)) {
        parallel = true;
        log.debug("Track B: readOnly:true auto-promoted to parallel", { plugin, stage });
      }

      // Inline allowlist + readOnly validation (mirrors manifest validator)
      if (parallel && !PARALLEL_ALLOWED.has(stage)) {
        log.warn("parallel:true is only allowed for stages in PARALLEL_ALLOWED", {
          plugin, stage, allowlist: [...PARALLEL_ALLOWED],
        });
        parallel = false;
      }
      if (parallel && !readOnly) {
        if (stage === "response-stream") {
          log.error("response-stream + parallel:true requires readOnly:true", {
            plugin, stage,
          });
        } else {
          log.warn("parallel:true requires readOnly:true", { plugin, stage });
        }
        parallel = false;
      }

      // Concurrency coercion: must be a positive integer or undefined
      if (concurrency !== undefined) {
        if (typeof concurrency !== "number" || !Number.isInteger(concurrency) || concurrency < 1) {
          log.warn("Invalid concurrency value; coerced to unbounded", {
            plugin, stage, rejectedValue: concurrency,
          });
          concurrency = undefined;
        }
      }

      // Priority<100 warn for parallel handlers
      if (parallel && typeof priority === "number" && priority < 100) {
        log.warn("parallel handlers run after all serial handlers regardless of priority", {
          plugin, stage, priority,
        });
      }
    }

    if (!this.#handlers.has(stage)) this.#handlers.set(stage, []);
    const list = this.#handlers.get(stage)!;
    list.push({
      handler,
      priority,
      plugin,
      baseLogger,
      parallel,
      readOnly,
      concurrency,
      dependsOn,
      errorCount: 0,
    });
    list.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Return a deep-detached snapshot of all currently registered handlers,
   * keyed by stage. Handlers are sorted by priority ascending (matching
   * dispatch order). Callers mutating the returned arrays/objects do NOT
   * affect dispatcher state. The `errorCount` field is the in-memory tally
   * of caught exceptions since process start.
   */
  introspect(): Record<HookStage, HandlerIntrospection[]> {
    const out = {} as Record<HookStage, HandlerIntrospection[]>;
    for (const [stage, list] of this.#handlers) {
      out[stage] = list.map((e) => ({
        plugin: e.plugin,
        priority: e.priority,
        errorCount: e.errorCount,
      }));
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Metrics / SSE
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Dispatch — two-bucket serial-first algorithm
  // ---------------------------------------------------------------------------

  /**
   * Dispatch all handlers for a stage. Serial handlers run first (shared base
   * context, in priority order). Then parallel handlers run via
   * Promise.allSettled with Proxy views.
   *
   * When `stage === "response-stream"`, the parallel bucket is fire-and-forget
   * (the returned promise resolves as soon as the serial pass completes).
   *
   * When the parallel bucket is empty the code path is byte-identical to the
   * legacy `for + await` loop.
   */
  async dispatch(stage: HookStage, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const handlers = this.#handlers.get(stage) ?? [];
    if (handlers.length === 0) return context;

    const correlationId = typeof context.correlationId === "string"
      ? context.correlationId
      : undefined;
    const startTime = performance.now();

    // Split into serial / parallel buckets
    const serial: HandlerEntry[] = [];
    const parallel: HandlerEntry[] = [];
    for (const entry of handlers) {
      (entry.parallel ? parallel : serial).push(entry);
    }

    // 1. Serial pass — shared base context (§3.11: empty parallel = legacy path)
    for (const entry of serial) {
      await this.#runSerial(stage, entry, context, correlationId);
    }

    // 2. Parallel pass (if any)
    if (parallel.length > 0) {
      if (stage === "response-stream") {
        // Fire-and-forget: don't await. Background promise handles logging.
        this.#runParallelBucket(stage, parallel, context, correlationId, startTime)
          .catch(() => { /* allSettled already handles individual errors */ });
      } else {
        await this.#runParallelBucket(stage, parallel, context, correlationId, startTime);
      }
    }

    // Metrics + ring buffer + SSE emit
    const durationMs = Math.round(performance.now() - startTime);
    const dispatchPhase: DispatchMetric["dispatchPhase"] =
      parallel.length === 0 ? "serial" : (serial.length === 0 ? "parallel" : "mixed");
    this.#recordDispatch(stage, dispatchPhase, durationMs, serial.length, parallel.length, [...serial, ...parallel]);

    log.debug("Hook dispatch completed", {
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

  #deriveLogger(entry: HandlerEntry, correlationId?: string): unknown {
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

  /** Run a single serial handler — mutates context.logger in place. */
  async #runSerial(
    stage: HookStage,
    entry: HandlerEntry,
    context: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    context.logger = this.#deriveLogger(entry, correlationId) as unknown;
    try {
      await entry.handler(context);
    } catch (err: unknown) {
      entry.errorCount++;
      log.error(`Hook error in stage '${stage}'`, {
        stage,
        plugin: entry.plugin,
        dispatchPhase: "serial",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Run a single parallel handler with a Proxy view of the context.
   * The Proxy intercepts `logger` reads/writes and (under HOOK_DEBUG)
   * logs any other writes as readOnly violations.
   */
  async #runParallel(
    stage: HookStage,
    entry: HandlerEntry,
    context: Record<string, unknown>,
    correlationId?: string,
  ): Promise<void> {
    const handlerLogger = this.#deriveLogger(entry, correlationId);
    const view = new Proxy(context, {
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
    await entry.handler(view);
  }

  /**
   * Compute topological layers from dependsOn within a parallel bucket.
   * Returns arrays of entries grouped by layer. Within each layer entries
   * are sorted by priority ascending.
   *
   * If any dependsOn is invalid (references a plugin not in the bucket),
   * falls back to a single layer sorted by priority.
   */
  #computeTopoLayers(parallel: HandlerEntry[], stage?: HookStage): HandlerEntry[][] {
    // Check if any entry actually has dependsOn
    const hasDeps = parallel.some((e) => e.dependsOn && e.dependsOn.length > 0);
    if (!hasDeps) return [parallel]; // already priority-sorted

    // Build name → entry map (by plugin name within this bucket)
    const byPlugin = new Map<string, HandlerEntry>();
    for (const e of parallel) {
      if (e.plugin) byPlugin.set(e.plugin, e);
    }

    // Validate all dependsOn references
    for (const e of parallel) {
      if (!e.dependsOn) continue;
      for (const dep of e.dependsOn) {
        if (!byPlugin.has(dep)) {
          log.error("dependsOn references unknown plugin; falling back to priority-only", {
            plugin: e.plugin, unknownDep: dep, stage,
          });
          return [parallel];
        }
      }
    }

    // Compute in-degree map
    const inDegree = new Map<HandlerEntry, number>();
    const successors = new Map<HandlerEntry, HandlerEntry[]>();
    for (const e of parallel) {
      inDegree.set(e, 0);
      successors.set(e, []);
    }
    for (const e of parallel) {
      if (!e.dependsOn) continue;
      for (const dep of e.dependsOn) {
        const depEntry = byPlugin.get(dep)!;
        successors.get(depEntry)!.push(e);
        inDegree.set(e, (inDegree.get(e) ?? 0) + 1);
      }
    }

    // Kahn's algorithm — produce layers
    const layers: HandlerEntry[][] = [];
    let remaining = new Set(parallel);

    while (remaining.size > 0) {
      const layer: HandlerEntry[] = [];
      for (const e of remaining) {
        if ((inDegree.get(e) ?? 0) === 0) layer.push(e);
      }
      if (layer.length === 0) {
        // Cycle detected — fall back to priority-only
        const cyclePlugins = [...remaining].map(e => e.plugin).filter(Boolean);
        log.error("dependsOn cycle detected in parallel bucket; falling back to priority-only", {
          plugins: cyclePlugins, stage,
        });
        return [parallel];
      }
      layer.sort((a, b) => a.priority - b.priority);
      layers.push(layer);

      for (const e of layer) {
        remaining.delete(e);
        for (const s of successors.get(e) ?? []) {
          inDegree.set(s, (inDegree.get(s) ?? 0) - 1);
        }
      }
    }

    return layers;
  }

  /** Execute the parallel bucket: topo layers × concurrency chunks. */
  async #runParallelBucket(
    stage: HookStage,
    parallel: HandlerEntry[],
    context: Record<string, unknown>,
    correlationId: string | undefined,
    _startTime: number,
  ): Promise<void> {
    const layers = this.#computeTopoLayers(parallel, stage);

    // Effective concurrency = min of all declared
    const declaredConcurrencies = parallel
      .filter((e) => e.concurrency !== undefined)
      .map((e) => e.concurrency!);
    const effectiveConcurrency = declaredConcurrencies.length > 0
      ? Math.min(...declaredConcurrencies)
      : undefined; // unbounded

    for (const layer of layers) {
      if (effectiveConcurrency === undefined) {
        // Unbounded — single Promise.allSettled for whole layer
        const results = await Promise.allSettled(
          layer.map((entry) => {
            const t0 = performance.now();
            return this.#runParallel(stage, entry, context, correlationId).then(
              () => { this.#recordStreamWallTime(stage, entry, performance.now() - t0); },
              (err) => { this.#recordStreamWallTime(stage, entry, performance.now() - t0); throw err; },
            );
          }),
        );
        this.#handleParallelResults(stage, layer, results);
      } else {
        // Chunked by concurrency
        for (let i = 0; i < layer.length; i += effectiveConcurrency) {
          const chunk = layer.slice(i, i + effectiveConcurrency);
          const results = await Promise.allSettled(
            chunk.map((entry) => {
              const t0 = performance.now();
              return this.#runParallel(stage, entry, context, correlationId).then(
                () => { this.#recordStreamWallTime(stage, entry, performance.now() - t0); },
                (err) => { this.#recordStreamWallTime(stage, entry, performance.now() - t0); throw err; },
              );
            }),
          );
          this.#handleParallelResults(stage, chunk, results);
        }
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
        log.error(`Hook error in stage '${stage}'`, {
          stage,
          plugin: entry.plugin,
          dispatchPhase: "parallel",
          error: {
            message: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack : undefined,
          },
        });
      }
    }
  }

  /**
   * Record wall-time for response-stream parallel handlers. When the
   * sliding-window average exceeds 5 ms, emit a one-time soft warn.
   */
  #recordStreamWallTime(stage: HookStage, entry: HandlerEntry, wallTimeMs: number): void {
    if (stage !== "response-stream") return;
    const key = entry.plugin ?? "<anonymous>";
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
          log.warn("response-stream parallel handler exceeds 5ms average wall-time", {
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
  #recordDispatch(
    stage: string,
    dispatchPhase: DispatchMetric["dispatchPhase"],
    durationMs: number,
    serialCount: number,
    parallelCount: number,
    entries: HandlerEntry[],
  ): void {
    const metric: DispatchMetric = {
      stage,
      dispatchPhase,
      durationMs,
      serialCount,
      parallelCount,
      plugins: entries.map((e) => ({
        plugin: e.plugin ?? "<anonymous>",
        durationMs: 0, // per-handler timing tracked separately for response-stream
        errored: e.errorCount > 0,
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
