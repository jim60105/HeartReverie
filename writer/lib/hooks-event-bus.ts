/**
 * @module hooks-event-bus
 *
 * `HandlerEventBus` owns the per-handler observability subscriber set, the
 * consecutive-throw counter (for auto-unsubscribe), and the per-stage warn
 * rate-limit map that previously lived directly on `HookDispatcher`.
 *
 * It is composed (not inherited) by `HookDispatcher` and exposes only the
 * surface the dispatcher needs: subscribe/unsubscribe, an introspection
 * accessor, a presence check (used to gate snapshot construction on the hot
 * path), and `emit` (used by the dispatcher when crossing handler-start /
 * handler-end boundaries).
 */

import type { HandlerEvent, HandlerEventSubscriber, HandlerEventSubscriptionOptions, HookStage } from "../types.ts";
import { errorMessage } from "./errors.ts";
import type { Logger } from "./logger.ts";

/** Rate-limit window (ms) for warn logs about throwing subscriber callbacks. */
export const SUBSCRIBER_WARN_RATE_LIMIT_MS = 60_000;

export class HandlerEventBus {
  readonly #log: Logger;
  readonly #subscribers: Set<HandlerEventSubscriber> = new Set();
  // Consecutive-throw counter per subscriber — reset on any clean invocation.
  readonly #throwCount: WeakMap<HandlerEventSubscriber, number> = new WeakMap();
  // Rate-limit map for subscriber-throw warn logs, keyed by hook stage.
  readonly #warnLastMs: Map<HookStage, number> = new Map();
  // Metadata (owning plugin, event kind) recorded alongside each subscription
  // for introspection (`getSubscribersByPlugin`). Untagged subscriptions are
  // still tracked here with an empty options object so they appear in
  // introspection under the synthetic plugin name "<anonymous>".
  readonly #meta: Map<HandlerEventSubscriber, HandlerEventSubscriptionOptions> = new Map();

  constructor(log: Logger) {
    this.#log = log;
  }

  subscribe(cb: HandlerEventSubscriber, opts?: HandlerEventSubscriptionOptions): void {
    this.#subscribers.add(cb);
    this.#meta.set(cb, opts ?? {});
  }

  /** Unsubscribe from per-handler events. Calling on an unknown cb is a no-op. */
  unsubscribe(cb: HandlerEventSubscriber): void {
    this.#subscribers.delete(cb);
    this.#throwCount.delete(cb);
    this.#meta.delete(cb);
  }

  /**
   * Return the set of plugins that currently hold subscriptions, grouped by
   * plugin name and listing the event kinds each plugin filters. Untagged
   * subscriptions appear under the synthetic plugin name `"<anonymous>"`.
   * The list of kinds is deduplicated and sorted; an empty `kind` filter
   * (subscriber listens to both `handler-start` and `handler-end`) is
   * reported as both kinds.
   */
  getSubscribersByPlugin(): Record<string, Array<"handler-start" | "handler-end">> {
    const out: Record<string, Set<"handler-start" | "handler-end">> = {};
    for (const [, meta] of this.#meta) {
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
  hasSubscribers(): boolean {
    return this.#subscribers.size > 0;
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
  emit(event: HandlerEvent): void {
    if (this.#subscribers.size === 0) return;
    // Snapshot the set so a subscriber that unsubscribes itself mid-fan-out
    // does not perturb iteration.
    const subscribers = [...this.#subscribers];
    for (const cb of subscribers) {
      try {
        cb(event);
        // Clean invocation — reset consecutive throw counter.
        if (this.#throwCount.has(cb)) {
          this.#throwCount.delete(cb);
        }
      } catch (err: unknown) {
        const errMsg = errorMessage(err);
        const prior = this.#throwCount.get(cb) ?? 0;
        const next = prior + 1;
        this.#throwCount.set(cb, next);

        // Rate-limit warn logs: at most once per stage per 60 s.
        const now = performance.now();
        const lastWarn = this.#warnLastMs.get(event.stage) ?? -Infinity;
        if (now - lastWarn >= SUBSCRIBER_WARN_RATE_LIMIT_MS) {
          this.#warnLastMs.set(event.stage, now);
          // NOTE: per spec, do NOT include event payload fields — only the
          // subscriber error message and the originating stage are logged.
          this.#log.warn("Handler-event subscriber threw", {
            stage: event.stage,
            consecutiveThrows: next,
            error: errMsg,
          });
        }

        // Auto-unsubscribe after two consecutive throws.
        if (next >= 2) {
          this.#subscribers.delete(cb);
          this.#throwCount.delete(cb);
        }
      }
    }
  }
}
