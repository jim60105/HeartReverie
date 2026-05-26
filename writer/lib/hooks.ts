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

import type {
  HandlerEventSubscriber,
  HandlerEventSubscriptionOptions,
  HookHandler,
  HookStage,
  RegisterOptions,
} from "../types.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import { KNOWN_BACKEND_STAGES, PARALLEL_ALLOWED, VALID_STAGES } from "./hooks-stages.ts";
import { type HandlerEntry } from "./hooks-topo.ts";
import { type DispatchMetric, HookMetricsCollector } from "./hooks-metrics.ts";
import { HandlerEventBus } from "./hooks-event-bus.ts";
import { HookRunner } from "./hooks-runner.ts";
import {
  _resetThrottleWarnDedupForTesting as _resetThrottleWarnDedupForTestingImpl,
  resolveRegisterOptions,
  warnIfHeterogeneousConcurrency,
} from "./hooks-register.ts";

// Re-exported so existing importers (plugin-loader, plugin-validators,
// plugin-depends-on-dag, tests, _debug-hooks route) continue to work after
// the extraction.
export { KNOWN_BACKEND_STAGES, PARALLEL_ALLOWED, VALID_STAGES };
export type { DispatchMetric };

const log = createLogger("plugin");

/**
 * @internal
 * Test-only helper that clears the throttle-warning suppression set so
 * independent test cases can deterministically observe re-emission. The
 * suppression set itself now lives in `hooks-register.ts`; this re-export
 * preserves the import path that test files have always used.
 * MUST NOT be called from production code.
 */
export function _resetThrottleWarnDedupForTesting(): void {
  _resetThrottleWarnDedupForTestingImpl();
}

export const HOOK_DEBUG = Deno.env.get("HOOK_DEBUG") === "1";

/** Per-stage handler info returned by `HookDispatcher.introspect()`. */
export interface HandlerIntrospection {
  readonly plugin: string | undefined;
  readonly priority: number;
  readonly errorCount: number;
  readonly parallel: boolean;
}

export class HookDispatcher {
  #handlers: Map<HookStage, HandlerEntry[]> = new Map();
  readonly #metrics = new HookMetricsCollector(log);
  readonly #eventBus = new HandlerEventBus(log);
  readonly #runner = new HookRunner(log, this.#metrics, this.#eventBus);

  /**
   * Register a handler for a given hook stage.
   *
   * The third parameter accepts either a numeric priority (legacy positional
   * API) or a `RegisterOptions` object for the full parallel-dispatch feature
   * set. When called by PluginManager, the 4th and 5th params supply the
   * plugin name and base logger for internal logger derivation.
   *
   * Option resolution (priority/parallel/readOnly/concurrency/dependsOn,
   * Track-B `readOnly → parallel` auto-promotion, allowlist validation,
   * concurrency coercion, advisory warns) is delegated to
   * `resolveRegisterOptions`. The post-registration heterogeneous-concurrency
   * warning is delegated to `warnIfHeterogeneousConcurrency`.
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
        `Invalid hook stage '${stage}'. Valid stages: ${[...VALID_STAGES].join(", ")}`,
      );
    }
    if (typeof handler !== "function") {
      throw new Error("Hook handler must be a function");
    }

    const { priority, parallel, readOnly, concurrency, dependsOn } = resolveRegisterOptions(
      stage,
      priorityOrOptions,
      plugin,
      log,
    );

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
      warnIfHeterogeneousConcurrency(stage, list, newEntry, log);
    }
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
    return this.#metrics.getMetricsBuffer();
  }

  /** Subscribe to per-dispatch SSE events. */
  subscribeSSE(cb: (metric: DispatchMetric) => void): void {
    this.#metrics.subscribeSSE(cb);
  }

  /** Unsubscribe from per-dispatch SSE events. */
  unsubscribeSSE(cb: (metric: DispatchMetric) => void): void {
    this.#metrics.unsubscribeSSE(cb);
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
    this.#eventBus.subscribe(cb, opts);
  }

  /** Unsubscribe from per-handler events. Calling on an unknown cb is a no-op. */
  unsubscribeHandlerEvents(cb: HandlerEventSubscriber): void {
    this.#eventBus.unsubscribe(cb);
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
    return this.#eventBus.getSubscribersByPlugin();
  }

  // ---------------------------------------------------------------------------
  // Dispatch
  // ---------------------------------------------------------------------------

  /**
   * Dispatch all handlers for a stage. Delegates execution to `HookRunner`,
   * which owns the serial/parallel scheduling, Proxy context views, per-handler
   * observability events, and dispatch metrics. The registry-side concern of
   * "which handlers are registered for this stage" stays here.
   *
   * When `stage === "response-stream"`, the parallel bucket is fire-and-forget
   * (the returned promise resolves as soon as the serial pass completes).
   */
  dispatch(stage: HookStage, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    return this.#runner.dispatch(stage, this.#handlers.get(stage) ?? [], context);
  }
}
