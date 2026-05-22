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

import { errorMessage } from "./errors.ts";
import type { HookStage, HookHandler, RegisterOptions, HandlerEvent, HandlerEventSubscriber, HandlerEventSubscriptionOptions } from "../types.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import { KNOWN_BACKEND_STAGES, PARALLEL_ALLOWED, VALID_STAGES } from "./hooks-stages.ts";
import { captureRefs as captureRefsFn, cloneAllowlistSnapshot as cloneAllowlistSnapshotFn } from "./hooks-snapshot.ts";
import { computeTopoLayers as computeTopoLayersFn, type HandlerEntry } from "./hooks-topo.ts";

// Re-exported so existing importers (plugin-loader, plugin-validators,
// plugin-depends-on-dag, tests) continue to work after the extraction.
export { KNOWN_BACKEND_STAGES, PARALLEL_ALLOWED, VALID_STAGES };

const log = createLogger("plugin");

// Module-scoped suppression set for register-time throttle warnings.
// Key format: `${stage}::${plugin ?? "<anonymous>"}::${concurrency ?? "none"}`.
// Intentionally never cleared (process-lifetime dedup); see spec
// `hook-parallel-dispatch`: Dedup across process lifetime.
const throttleWarnDedup = new Set<string>();

/**
 * @internal
 * Test-only helper that clears the module-scoped throttle-warning suppression
 * set so independent test cases can deterministically observe re-emission.
 * MUST NOT be called from production code.
 */
export function _resetThrottleWarnDedupForTesting(): void {
  throttleWarnDedup.clear();
}

export const HOOK_DEBUG = Deno.env.get("HOOK_DEBUG") === "1";

/** Rate-limit window (ms) for warn logs about throwing subscriber callbacks. */
const SUBSCRIBER_WARN_RATE_LIMIT_MS = 60_000;

/** Per-stage handler info returned by `HookDispatcher.introspect()`. */
export interface HandlerIntrospection {
  readonly plugin: string | undefined;
  readonly priority: number;
  readonly errorCount: number;
  readonly parallel: boolean;
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
  // Per-handler observability event subscribers (opt-in, off by default).
  #handlerEventSubscribers: Set<HandlerEventSubscriber> = new Set();
  // Consecutive-throw counter per subscriber — reset on any clean invocation.
  #subscriberThrowCount: WeakMap<HandlerEventSubscriber, number> = new WeakMap();
  // Rate-limit map for subscriber-throw warn logs, keyed by hook stage.
  #subscriberWarnLastMs: Map<HookStage, number> = new Map();
  // Metadata (owning plugin, event kind) recorded alongside each subscription
  // for introspection (`getHandlerEventSubscribers`). Untagged subscriptions
  // are still tracked here with an empty options object so they appear in
  // introspection under the synthetic plugin name "<anonymous>".
  #handlerEventSubscriberMeta: Map<HandlerEventSubscriber, HandlerEventSubscriptionOptions> = new Map();

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
    const newEntry: HandlerEntry = {
      handler,
      priority,
      plugin,
      baseLogger,
      parallel,
      readOnly,
      concurrency,
      dependsOn,
      errorCount: 0,
    };
    list.push(newEntry);
    list.sort((a, b) => a.priority - b.priority);

    // Registration-time throttle warning. See spec `hook-parallel-dispatch`:
    // "Registration-time throttle warning". Only meaningful for parallel-bucket
    // entries; serial handlers are ignored by the check.
    if (newEntry.parallel) {
      this.#warnIfHeterogeneousConcurrency(stage, list, newEntry);
    }
  }

  /**
   * Walk the parallel bucket on `stage` and emit at most one `log.warn` when
   * the newly-registered entry would cause a concurrency mismatch against any
   * pre-existing parallel handler.
   *
   * Dedup is keyed by `${stage}::${plugin ?? "<anonymous>"}::${concurrency ?? "none"}`
   * and persists for the process lifetime (cleared only by the test-only
   * `_resetThrottleWarnDedupForTesting()` export).
   */
  // Keep this check O(handlers per stage); no I/O.
  #warnIfHeterogeneousConcurrency(
    stage: HookStage,
    list: readonly HandlerEntry[],
    newEntry: HandlerEntry,
  ): void {
    const parallelPeers = list.filter((e) => e !== newEntry && e.parallel);
    if (parallelPeers.length === 0) return;

    const nc = newEntry.concurrency;
    type MismatchPair = {
      throttler: HandlerEntry;
      throttlerValue: number | undefined;
      slowed: HandlerEntry;
      slowedValue: number | undefined;
    };
    const mismatches: MismatchPair[] = [];
    for (const peer of parallelPeers) {
      const pc = peer.concurrency;
      // (a) finite-vs-unbounded mismatch
      if (nc !== undefined && pc === undefined) {
        mismatches.push({ throttler: newEntry, throttlerValue: nc, slowed: peer, slowedValue: undefined });
      } else if (nc === undefined && pc !== undefined) {
        mismatches.push({ throttler: peer, throttlerValue: pc, slowed: newEntry, slowedValue: undefined });
      } else if (nc !== undefined && pc !== undefined && nc !== pc) {
        // (b) finite-vs-higher-finite mismatch: lower value is the throttler
        if (nc < pc) {
          mismatches.push({ throttler: newEntry, throttlerValue: nc, slowed: peer, slowedValue: pc });
        } else {
          mismatches.push({ throttler: peer, throttlerValue: pc, slowed: newEntry, slowedValue: nc });
        }
      }
    }
    if (mismatches.length === 0) return;

    const key = `${stage}::${newEntry.plugin ?? "<anonymous>"}::${newEntry.concurrency ?? "none"}`;
    if (throttleWarnDedup.has(key)) return;
    throttleWarnDedup.add(key);

    // Pick the lowest declared concurrency among involved entries as the
    // effective cap. With at least one mismatch involving an unbounded peer
    // and a finite peer, the finite value wins.
    const declaredValues = mismatches
      .flatMap((m) => [m.throttlerValue, m.slowedValue])
      .filter((v): v is number => typeof v === "number");
    const effective = declaredValues.length > 0 ? Math.min(...declaredValues) : nc ?? "unbounded";

    // Dedup by throttler-plugin so the same peer is not cited twice.
    const throttlerCites = new Map<string, number | undefined>();
    const slowedCites = new Map<string, number | undefined>();
    for (const m of mismatches) {
      const tk = m.throttler.plugin ?? "<anonymous>";
      const sk = m.slowed.plugin ?? "<anonymous>";
      if (!throttlerCites.has(tk)) throttlerCites.set(tk, m.throttlerValue);
      if (!slowedCites.has(sk)) slowedCites.set(sk, m.slowedValue);
    }
    const fmt = (v: number | undefined): string => (v === undefined ? "unbounded" : String(v));
    const throttlersList = [...throttlerCites.entries()]
      .map(([p, v]) => `${p} (concurrency=${fmt(v)})`)
      .join(", ");
    const peerSample = [...slowedCites.entries()][0]!;
    const slowedFields = [...slowedCites.entries()].map(([p, v]) => ({ plugin: p, concurrency: fmt(v) }));
    const throttlerFields = [...throttlerCites.entries()].map(([p, v]) => ({ plugin: p, concurrency: fmt(v) }));

    // Determine the role of `newEntry` in this batch. It can be throttler-only,
    // slowed-only, or both (mixed bucket with >=2 heterogeneous peers).
    const newIsThrottler = mismatches.some((m) => m.throttler === newEntry);
    const newIsSlowed = mismatches.some((m) => m.slowed === newEntry);
    const newPluginLabel = newEntry.plugin ?? "<anonymous>";
    const newDecl = `concurrency=${fmt(newEntry.concurrency)}`;
    let roleSentence: string;
    if (newIsThrottler && !newIsSlowed) {
      roleSentence =
        `This plugin declared ${newDecl} which will throttle the entire '${stage}' parallel bucket.`;
    } else if (newIsSlowed && !newIsThrottler) {
      roleSentence =
        `This plugin declared ${newDecl}, but existing peer(s) with a lower concurrency cap will throttle the entire '${stage}' parallel bucket — including this registration.`;
    } else {
      roleSentence =
        `This plugin declared ${newDecl}; it both throttles some peers and is throttled by others — collectively these caps throttle the entire '${stage}' parallel bucket.`;
    }
    const message =
      `${roleSentence} Effective concurrency for this stage is now capped at ${effective}. Other plugins in this bucket (e.g. ${peerSample[0]}) declared ${fmt(peerSample[1])}. Throttlers: ${throttlersList}.`;

    const payload = {
      plugin: newPluginLabel,
      stage,
      concurrency: fmt(newEntry.concurrency),
      role: newIsThrottler && newIsSlowed ? "mixed" : newIsThrottler ? "throttler" : "slowed",
      throttlers: throttlerFields,
      slowedPeers: slowedFields,
      message,
    };

    const logger = newEntry.baseLogger ?? log;
    logger.warn(message, payload);
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
        parallel: e.parallel,
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
  // Per-handler observability events (opt-in)
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to per-handler `handler-start` / `handler-end` events.
   *
   * Subscribers run synchronously inside `dispatch`, with each callback
   * wrapped in `try/catch` so they cannot break dispatch correctness.
   * A subscriber that throws on two consecutive events is auto-unsubscribed
   * and the second throw is logged (rate-limited per stage) at `warn` level.
   *
   * When zero subscribers are registered, `dispatch` skips all snapshot
   * construction — the cost of this surface is bounded by a `Set.size === 0`
   * check per handler.
   */
  subscribeHandlerEvents(cb: HandlerEventSubscriber, opts?: HandlerEventSubscriptionOptions): void {
    this.#handlerEventSubscribers.add(cb);
    this.#handlerEventSubscriberMeta.set(cb, opts ?? {});
  }

  /** Unsubscribe from per-handler events. Calling on an unknown cb is a no-op. */
  unsubscribeHandlerEvents(cb: HandlerEventSubscriber): void {
    this.#handlerEventSubscribers.delete(cb);
    this.#subscriberThrowCount.delete(cb);
    this.#handlerEventSubscriberMeta.delete(cb);
  }

  /**
   * Return the set of plugins that currently hold observer subscriptions via
   * `subscribeHandlerEvents`, grouped by plugin name and listing the event
   * kinds each plugin filters. Untagged subscriptions appear under the
   * synthetic plugin name `"<anonymous>"`. The list of kinds is deduplicated
   * and sorted; an empty `kind` filter (subscriber listens to both
   * `handler-start` and `handler-end`) is reported as both kinds.
   *
   * Used by introspection routes (`/api/_debug/hooks`,
   * `/api/plugin-introspection/hooks`) so operators can see which plugins are
   * observing handler events without exposing subscriber payloads.
   */
  getHandlerEventSubscribers(): Record<string, Array<"handler-start" | "handler-end">> {
    const out: Record<string, Set<"handler-start" | "handler-end">> = {};
    for (const [, meta] of this.#handlerEventSubscriberMeta) {
      const pluginName = meta.plugin ?? "<anonymous>";
      let bucket = out[pluginName];
      if (!bucket) {
        bucket = new Set();
        out[pluginName] = bucket;
      }
      if (meta.kind === "handler-start" || meta.kind === "handler-end") {
        bucket.add(meta.kind);
      } else {
        bucket.add("handler-start");
        bucket.add("handler-end");
      }
    }
    const result: Record<string, Array<"handler-start" | "handler-end">> = {};
    for (const [name, set] of Object.entries(out)) {
      result[name] = [...set].sort();
    }
    return result;
  }

  /** True iff at least one subscriber is registered (used to gate snapshot work). */
  #hasHandlerEventSubscribers(): boolean {
    return this.#handlerEventSubscribers.size > 0;
  }

  /**
   * Fan a single event out to every subscriber, isolating throws.
   *
   * Returns nothing — failure modes (throwing subscriber, auto-unsubscribe,
   * rate-limited warn) are handled internally so dispatch correctness is
   * unaffected. Pre-existing dispatcher logs are NOT extended with event
   * payloads (see hook-observability spec: "new surfaces SHALL NOT log
   * payloads").
   */
  #emitHandlerEvent(event: HandlerEvent): void {
    if (this.#handlerEventSubscribers.size === 0) return;
    // Snapshot the set so a subscriber that unsubscribes itself mid-fan-out
    // does not perturb iteration.
    const subscribers = [...this.#handlerEventSubscribers];
    for (const cb of subscribers) {
      try {
        cb(event);
        // Clean invocation — reset consecutive throw counter.
        if (this.#subscriberThrowCount.has(cb)) {
          this.#subscriberThrowCount.delete(cb);
        }
      } catch (err: unknown) {
        const errMsg = errorMessage(err);
        const prior = this.#subscriberThrowCount.get(cb) ?? 0;
        const next = prior + 1;
        this.#subscriberThrowCount.set(cb, next);

        // Rate-limit warn logs: at most once per stage per 60 s.
        const now = performance.now();
        const lastWarn = this.#subscriberWarnLastMs.get(event.stage) ?? -Infinity;
        if (now - lastWarn >= SUBSCRIBER_WARN_RATE_LIMIT_MS) {
          this.#subscriberWarnLastMs.set(event.stage, now);
          // NOTE: per spec, do NOT include event payload fields — only the
          // subscriber error message and the originating stage are logged.
          log.warn("Handler-event subscriber threw", {
            stage: event.stage,
            consecutiveThrows: next,
            error: errMsg,
          });
        }

        // Auto-unsubscribe after two consecutive throws.
        if (next >= 2) {
          this.#handlerEventSubscribers.delete(cb);
          this.#subscriberThrowCount.delete(cb);
        }
      }
    }
  }

  /**
   * Read the per-stage allowlist of live context-field refs. Returned object
   * preserves identity of `context[k]` for each allowlisted `k` — used to
   * detect reassignment via `===` after the handler returns.
   */
  #captureRefs(stage: HookStage, context: Record<string, unknown>): Record<string, unknown> {
    return captureRefsFn(stage, context);
  }

  /**
   * Deep-clone the per-stage allowlist subset of `context` into a plain
   * object snapshot. Stages not in the allowlist produce `{}`.
   */
  #cloneAllowlistSnapshot(stage: HookStage, context: Record<string, unknown>): Record<string, unknown> {
    return cloneAllowlistSnapshotFn(stage, context);
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
    for (let i = 0; i < serial.length; i++) {
      await this.#runSerial(stage, serial[i]!, i, context, correlationId);
    }

    // 2. Parallel pass (if any)
    if (parallel.length > 0) {
      // Parallel entries start at handlerIndex = serial.length (sorted dispatch order).
      const parallelBase = serial.length;
      if (stage === "response-stream") {
        // Fire-and-forget: don't await. Background promise handles logging.
        this.#runParallelBucket(stage, parallel, parallelBase, context, correlationId, startTime)
          .catch(() => { /* allSettled already handles individual errors */ });
      } else {
        await this.#runParallelBucket(stage, parallel, parallelBase, context, correlationId, startTime);
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
    const handlerLogger = this.#deriveLogger(entry, correlationId);
    const view = new Proxy(context, {
      get(target, prop, receiver) {
        if (prop === "logger") return handlerLogger;
        return Reflect.get(target, prop, receiver);
      },
      set(target, prop, value, receiver) {
        if (prop === "logger") return true; // per-handler logger is immutable
        return Reflect.set(target, prop, value, receiver);
      },
    });

    const hasSubs = this.#hasHandlerEventSubscribers();
    let ctxBeforeRefs: Record<string, unknown> | undefined;
    let startTime = 0;
    if (hasSubs) {
      // Capture live refs BEFORE structuredClone runs (spec D3).
      ctxBeforeRefs = this.#captureRefs(stage, context);
      const ctxBeforeSnapshot = this.#cloneAllowlistSnapshot(stage, context);
      startTime = performance.now();
      this.#emitHandlerEvent({
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
    }

    let handlerError: unknown = undefined;
    try {
      await entry.handler(view);
    } catch (err: unknown) {
      handlerError = err;
      entry.errorCount++;
      log.error(`Hook error in stage '${stage}'`, {
        stage,
        plugin: entry.plugin,
        dispatchPhase: "serial",
        error: errorMessage(err),
      });
    }

    if (hasSubs && ctxBeforeRefs) {
      // Re-read live refs BEFORE the post-handler clone (spec D3).
      const ctxAfterRefs = this.#captureRefs(stage, context);
      const reassigned: string[] = [];
      for (const k of Object.keys(ctxBeforeRefs)) {
        if (ctxAfterRefs[k] !== ctxBeforeRefs[k]) reassigned.push(k);
      }
      reassigned.sort();
      const ctxAfterSnapshot = this.#cloneAllowlistSnapshot(stage, context);
      const endTime = performance.now();
      this.#emitHandlerEvent({
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
        durationMs: endTime - startTime,
      });
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

    const hasSubs = this.#hasHandlerEventSubscribers();
    let ctxBeforeRefs: Record<string, unknown> | undefined;
    let startTime = 0;
    if (hasSubs) {
      ctxBeforeRefs = this.#captureRefs(stage, context);
      const ctxBeforeSnapshot = this.#cloneAllowlistSnapshot(stage, context);
      startTime = performance.now();
      this.#emitHandlerEvent({
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
    }

    let handlerError: unknown;
    try {
      await entry.handler(view);
    } catch (err: unknown) {
      handlerError = err;
      // Re-throw so the existing Promise.allSettled / parallel-bucket error
      // accounting in #runParallelBucket continues to work unchanged.
      if (hasSubs && ctxBeforeRefs) {
        this.#emitParallelEnd(stage, entry, handlerIndex, correlationId, context, ctxBeforeRefs, startTime, handlerError);
      }
      throw err;
    }

    if (hasSubs && ctxBeforeRefs) {
      this.#emitParallelEnd(stage, entry, handlerIndex, correlationId, context, ctxBeforeRefs, startTime, undefined);
    }
  }

  /** Emit the `handler-end` event for a parallel handler. Internal helper. */
  #emitParallelEnd(
    stage: HookStage,
    entry: HandlerEntry,
    handlerIndex: number,
    correlationId: string | undefined,
    context: Record<string, unknown>,
    ctxBeforeRefs: Record<string, unknown>,
    startTime: number,
    handlerError: unknown,
  ): void {
    const ctxAfterRefs = this.#captureRefs(stage, context);
    const reassigned: string[] = [];
    for (const k of Object.keys(ctxBeforeRefs)) {
      if (ctxAfterRefs[k] !== ctxBeforeRefs[k]) reassigned.push(k);
    }
    reassigned.sort();
    const ctxAfterSnapshot = this.#cloneAllowlistSnapshot(stage, context);
    const endTime = performance.now();
    this.#emitHandlerEvent({
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
      durationMs: endTime - startTime,
    });
  }

  /**
   * Compute topological layers from dependsOn within a parallel bucket.
   * Delegates to the pure helper in `hooks-topo.ts`; the dispatcher only
   * supplies its module-scoped logger so error-path messages still appear
   * under the `plugin` log category.
   */
  #computeTopoLayers(parallel: HandlerEntry[], stage?: HookStage): HandlerEntry[][] {
    return computeTopoLayersFn(parallel, log, stage);
  }

  /** Execute the parallel bucket: topo layers × concurrency chunks. */
  async #runParallelBucket(
    stage: HookStage,
    parallel: HandlerEntry[],
    parallelBase: number,
    context: Record<string, unknown>,
    correlationId: string | undefined,
    _startTime: number,
  ): Promise<void> {
    const layers = this.#computeTopoLayers(parallel, stage);
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
      if (effectiveConcurrency === undefined) {
        // Unbounded — single Promise.allSettled for whole layer
        const results = await Promise.allSettled(
          layer.map((entry) => {
            const t0 = performance.now();
            return this.#runParallel(stage, entry, indexOf.get(entry)!, context, correlationId).then(
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
              return this.#runParallel(stage, entry, indexOf.get(entry)!, context, correlationId).then(
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
            message: errorMessage(err),
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
