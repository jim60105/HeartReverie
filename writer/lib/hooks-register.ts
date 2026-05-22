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
 * @module hooks-register
 *
 * Register-time helpers for `HookDispatcher`:
 *
 *   1. `resolveRegisterOptions` normalises the overloaded `register()` third
 *      parameter (numeric priority OR `RegisterOptions` object) into a fully
 *      resolved options record, applying the Track B `readOnly → parallel`
 *      auto-promotion, allowlist/`readOnly` validation, concurrency
 *      coercion, and the parallel + low-priority advisory warn.
 *
 *   2. `warnIfHeterogeneousConcurrency` walks the parallel bucket and emits
 *      at most one `log.warn` per (`stage`, registering plugin, declared
 *      concurrency) tuple when a newly registered handler causes a
 *      concurrency mismatch with an existing peer. Dedup state lives in a
 *      module-scoped `Set` whose lifetime is the process; tests can clear
 *      it via `_resetThrottleWarnDedupForTesting()` (re-exported from
 *      `hooks.ts` for back-compat).
 *
 * Both helpers are pure functions (no `this`) and operate on the same
 * shapes as the dispatcher's internal `HandlerEntry`.
 */

import type { HookStage, RegisterOptions } from "../types.ts";
import type { Logger } from "./logger.ts";
import { PARALLEL_ALLOWED } from "./hooks-stages.ts";
import type { HandlerEntry } from "./hooks-topo.ts";

/**
 * Module-scoped suppression set for register-time throttle warnings.
 * Key format: `${stage}::${plugin ?? "<anonymous>"}::${concurrency ?? "none"}`.
 * Intentionally never cleared automatically (process-lifetime dedup); see
 * spec `hook-parallel-dispatch`: "Dedup across process lifetime".
 */
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

/** Resolved `register()` options after coercion / validation / Track B promotion. */
export interface ResolvedRegisterOptions {
  readonly priority: number;
  readonly parallel: boolean;
  readonly readOnly: boolean;
  readonly concurrency: number | undefined;
  readonly dependsOn: readonly string[] | undefined;
}

/**
 * Normalise the overloaded `register()` third parameter into a fully resolved
 * options record, applying the same validation/coercion rules the dispatcher
 * used to perform inline.
 */
export function resolveRegisterOptions(
  stage: HookStage,
  priorityOrOptions: number | (RegisterOptions & { concurrency?: number }) | undefined,
  plugin: string | undefined,
  log: Logger,
): ResolvedRegisterOptions {
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

  return { priority, parallel, readOnly, concurrency, dependsOn };
}

/**
 * Walk the parallel bucket on `stage` and emit at most one `log.warn` when
 * the newly-registered entry would cause a concurrency mismatch against any
 * pre-existing parallel handler.
 *
 * Dedup is keyed by `${stage}::${plugin ?? "<anonymous>"}::${concurrency ?? "none"}`
 * and persists for the process lifetime (cleared only by the test-only
 * `_resetThrottleWarnDedupForTesting()` export).
 *
 * `defaultLog` is used unless the new entry has its own `baseLogger`, in which
 * case that logger is preferred so the warning is attributed to the registering
 * plugin's category. This matches the pre-extraction behavior verbatim.
 */
// Keep this check O(handlers per stage); no I/O.
export function warnIfHeterogeneousConcurrency(
  stage: HookStage,
  list: readonly HandlerEntry[],
  newEntry: HandlerEntry,
  defaultLog: Logger,
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

  const logger = newEntry.baseLogger ?? defaultLog;
  logger.warn(message, payload);
}
