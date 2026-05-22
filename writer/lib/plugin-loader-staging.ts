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
 * Staging-hooks builder + declare-vs-register verifier extracted from
 * {@link PluginLoader.loadBackendModule}.
 *
 * `createStagingHooks` returns a `PluginRegisterContext["hooks"]`-shaped
 * object whose `register` call appends to an internal buffer (rather than
 * touching the live {@link HookDispatcher}), and whose `onHandlerStart` /
 * `onHandlerEnd` subscribe to the dispatcher immediately so plugins can
 * observe handler events from the moment they register.
 *
 * The caller (loadBackendModule) is responsible for:
 *
 * - Constructing a fresh `eventSubscriberUnsubs` Set per call and passing
 *   it in. The staging helpers add unsubscribe closures to it; the
 *   caller's catch block iterates it on failure to tear down any
 *   subscriptions that were opened during a `register()` call that later
 *   threw.
 * - Calling {@link verifyHookDeclarationsMatch} after `register()` returns
 *   to enforce that PARALLEL_ALLOWED stages declared in `manifest.hooks`
 *   exactly match the stages actually registered.
 * - Replaying the returned `staged` buffer into the live dispatcher.
 *
 * `eventSubscriberUnsubs` is intentionally a shared mutable Set (not a
 * pure value) so the failure path can clean up subscriptions opened
 * partway through a failed `register()` call.
 */

import { PARALLEL_ALLOWED, VALID_STAGES } from "./hooks.ts";
import type { HookDispatcher } from "./hooks.ts";
import type {
  HandlerEvent,
  HandlerEventSubscriber,
  HookHandler,
  HookStage,
  PluginManifest,
  PluginRegisterContext,
  RegisterOptions,
} from "../types.ts";

export interface StagedEntry {
  readonly stage: HookStage;
  readonly handler: HookHandler;
  readonly priority: number;
  readonly parallel: boolean;
  readonly readOnly: boolean;
  readonly concurrency?: number;
  readonly dependsOn?: readonly string[];
}

export interface StagingHooksResult {
  readonly hooks: PluginRegisterContext["hooks"];
  readonly staged: StagedEntry[];
  readonly stagedStages: Set<HookStage>;
}

export interface CreateStagingHooksArgs {
  readonly pluginName: string;
  readonly manifestHookMap: Map<string, Record<string, unknown>>;
  readonly hookDispatcher: HookDispatcher;
  readonly eventSubscriberUnsubs: Set<() => void>;
}

/**
 * Build the transactional staging hooks object passed to a plugin's
 * `register()` callback. See module docstring for the ownership contract.
 */
export function createStagingHooks(
  args: CreateStagingHooksArgs,
): StagingHooksResult {
  const {
    pluginName,
    manifestHookMap,
    hookDispatcher,
    eventSubscriberUnsubs,
  } = args;

  const staged: StagedEntry[] = [];
  const stagedStages = new Set<HookStage>();

  const hooks: PluginRegisterContext["hooks"] = {
    register: (
      stage: HookStage,
      handler: HookHandler,
      priorityOrOptions?: number | RegisterOptions,
    ) => {
      // Mirror HookDispatcher.register validations up-front so a failing
      // stage/handler aborts the plugin before any partial commit can
      // happen.
      if (!VALID_STAGES.has(stage)) {
        throw new Error(
          `Invalid hook stage '${stage}'. Valid stages: ${
            [...VALID_STAGES].join(", ")
          }`,
        );
      }
      if (typeof handler !== "function") {
        throw new Error("Hook handler must be a function");
      }
      // Multiple handlers per (plugin, stage) are permitted on the
      // backend (different priorities = different responsibilities).
      // `stagedStages` is still tracked as a Set for declare-vs-register
      // cross-check below (presence-only, not count).
      stagedStages.add(stage);

      // Normalize overload: number | RegisterOptions | undefined
      const opts: RegisterOptions = typeof priorityOrOptions === "number"
        ? { priority: priorityOrOptions }
        : priorityOrOptions ?? {};

      // Merge manifest-derived parallel dispatch options (runtime opts
      // union with manifest: dependsOn arrays are concatenated, explicit
      // runtime fields take precedence for scalar values).
      const manifestDecl = manifestHookMap.get(stage);
      const manifestDeps =
        (manifestDecl?.dependsOn as readonly string[] | undefined) ?? [];
      const runtimeDeps = opts.dependsOn ?? [];
      const mergedDeps = [
        ...new Set([...manifestDeps, ...runtimeDeps]),
      ];

      staged.push({
        stage,
        handler,
        priority: opts.priority ?? 100,
        parallel: (manifestDecl?.parallel as boolean) ?? false,
        readOnly: (manifestDecl?.readOnly as boolean) ?? false,
        concurrency: manifestDecl?.concurrency as number | undefined,
        dependsOn: mergedDeps.length > 0 ? mergedDeps : undefined,
      });
    },
    /**
     * Subscribe to `handler-start` events. Returns an idempotent
     * unsubscribe closure.
     */
    onHandlerStart: (
      cb: (event: HandlerEvent & { kind: "handler-start" }) => void,
    ): (() => void) => {
      const wrapped: HandlerEventSubscriber = (ev) => {
        if (ev.kind === "handler-start") cb(ev);
      };
      hookDispatcher.subscribeHandlerEvents(wrapped, {
        plugin: pluginName,
        kind: "handler-start",
      });
      let unsubbed = false;
      const unsub = () => {
        if (unsubbed) return;
        unsubbed = true;
        hookDispatcher.unsubscribeHandlerEvents(wrapped);
        eventSubscriberUnsubs.delete(unsub);
      };
      eventSubscriberUnsubs.add(unsub);
      return unsub;
    },
    /**
     * Subscribe to `handler-end` events. Returns an idempotent
     * unsubscribe closure.
     */
    onHandlerEnd: (
      cb: (event: HandlerEvent & { kind: "handler-end" }) => void,
    ): (() => void) => {
      const wrapped: HandlerEventSubscriber = (ev) => {
        if (ev.kind === "handler-end") cb(ev);
      };
      hookDispatcher.subscribeHandlerEvents(wrapped, {
        plugin: pluginName,
        kind: "handler-end",
      });
      let unsubbed = false;
      const unsub = () => {
        if (unsubbed) return;
        unsubbed = true;
        hookDispatcher.unsubscribeHandlerEvents(wrapped);
        eventSubscriberUnsubs.delete(unsub);
      };
      eventSubscriberUnsubs.add(unsub);
      return unsub;
    },
  };

  return { hooks, staged, stagedStages };
}

/**
 * Build a lookup from `stage` → manifest declaration object for the
 * parallel-dispatch metadata merge inside the staging `register` call.
 */
export function buildManifestHookMap(
  manifest: PluginManifest,
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  if (Array.isArray(manifest.hooks)) {
    for (const h of manifest.hooks) {
      const decl = h as Record<string, unknown>;
      map.set(decl.stage as string, decl);
    }
  }
  return map;
}

/**
 * Enforce that the PARALLEL_ALLOWED stages declared in `manifest.hooks`
 * exactly match those registered via `hooks.register(...)` during the
 * plugin's `register()` call. Throws on mismatch.
 *
 * When `manifest.hooks` is absent or not an array, this check is skipped
 * entirely — non-declaring plugins are not constrained.
 *
 * Only PARALLEL_ALLOWED stages participate: parallel dispatch requires
 * explicit opt-in via `hooks[]`. Non-PARALLEL_ALLOWED stages in `hooks[]`
 * are informational (for hook-inspector reads/writes) and don't require a
 * matching register() call.
 */
export function verifyHookDeclarationsMatch(
  pluginName: string,
  manifest: PluginManifest,
  stagedStages: Set<HookStage>,
): void {
  if (!Array.isArray(manifest.hooks)) return;

  const declaredBackend = new Set(
    manifest.hooks
      .map((h) => h.stage)
      .filter((s) => PARALLEL_ALLOWED.has(s)),
  );
  const registeredBackend = new Set(
    [...stagedStages].filter((s) => PARALLEL_ALLOWED.has(s)),
  );
  const declaredOnly = [...declaredBackend].filter(
    (s) => !registeredBackend.has(s),
  );
  const registeredOnly = [...registeredBackend].filter(
    (s) => !declaredBackend.has(s),
  );
  if (declaredOnly.length > 0 || registeredOnly.length > 0) {
    throw new Error(
      `Plugin '${pluginName}' hook declarations do not match registration — declaredOnly: [${
        declaredOnly.join(", ")
      }], registeredOnly: [${registeredOnly.join(", ")}]`,
    );
  }
}
