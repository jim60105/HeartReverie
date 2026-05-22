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
 * Plugin discovery + backend-module loader extracted from
 * {@link PluginManager}.
 *
 * Two operations live here:
 *
 * 1. {@link PluginLoader.scanDir} — walk a directory, parse each
 *    `plugin.json`, validate manifests, audit settings schemas, and
 *    populate the `#plugins` / `#settingsAudit` maps that the manager
 *    owns. Idempotent for the same `(dir, source)` pair.
 *
 * 2. {@link PluginLoader.loadBackendModule} — dynamically import a
 *    plugin's backend module and call its `register()` export.
 *    Registration is **transactional**: hook calls are staged in a
 *    per-plugin buffer, validated against manifest declarations, and
 *    committed to the live {@link HookDispatcher} only when the plugin's
 *    full `register()` callback resolves successfully. On any failure
 *    (`register()` throws, declaration mismatch, invalid stage), the
 *    plugin is purged from `#plugins` and `#dynamicVarProviders`, and
 *    any handler-event subscriptions opened during the failed call are
 *    torn down so the dispatcher retains no dangling references.
 */

import { join, resolve } from "@std/path";
import { errorMessage } from "./errors.ts";
import { isPathContained } from "./path-safety.ts";
import { createLogger } from "./logger.ts";
import { HookDispatcher, PARALLEL_ALLOWED, VALID_STAGES } from "./hooks.ts";
import {
  validateActionButtons,
  validateFrontendStyles,
  validateHookDeclarations,
} from "./plugin-validators.ts";
import {
  auditSettingsSchema,
  type SettingsAudit,
} from "./plugin-settings-audit.ts";
import type {
  ActionButtonDescriptor,
  DynamicVariableContext,
  HandlerEvent,
  HandlerEventSubscriber,
  HookHandler,
  HookStage,
  PluginManifest,
  PluginRegisterContext,
  PluginRouteContext,
  RegisterOptions,
} from "../types.ts";

const log = createLogger("plugin");

export interface PluginEntry {
  readonly manifest: PluginManifest;
  readonly dir: string;
  readonly source: string;
  readonly validatedStyles: string[];
  readonly validatedActionButtons: ActionButtonDescriptor[];
  registerRoutes?: (
    context: PluginRouteContext,
  ) => void | Promise<void>;
}

export type DynamicVarProvider = (
  context: DynamicVariableContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export type GetSettingsFn = (
  name: string,
) => Promise<Record<string, unknown>>;

/** Defensive: name must not contain path separators, NUL, or `..`. */
export function isValidPluginName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !/\.\.|\x00|[/\\]/.test(name)
  );
}

/**
 * Encapsulates plugin manifest discovery and backend-module loading.
 *
 * Holds mutable references to the manager-owned state maps; mutations are
 * always confined to `scanDir` / `loadBackendModule` (insertions and the
 * `loadBackendModule` failure-path deletions).
 */
export class PluginLoader {
  readonly #plugins: Map<string, PluginEntry>;
  readonly #settingsAudit: Map<string, SettingsAudit>;
  readonly #schemaVersionWarned: Set<string>;
  readonly #hookDispatcher: HookDispatcher;
  readonly #dynamicVarProviders: Map<string, DynamicVarProvider>;
  readonly #getSettings: GetSettingsFn;

  constructor(
    plugins: Map<string, PluginEntry>,
    settingsAudit: Map<string, SettingsAudit>,
    schemaVersionWarned: Set<string>,
    hookDispatcher: HookDispatcher,
    dynamicVarProviders: Map<string, DynamicVarProvider>,
    getSettings: GetSettingsFn,
  ) {
    this.#plugins = plugins;
    this.#settingsAudit = settingsAudit;
    this.#schemaVersionWarned = schemaVersionWarned;
    this.#hookDispatcher = hookDispatcher;
    this.#dynamicVarProviders = dynamicVarProviders;
    this.#getSettings = getSettings;
  }

  /**
   * Scan a directory for plugin subdirectories containing `plugin.json`.
   * Invalid / non-conforming manifests are skipped with a warn log; valid
   * plugins are inserted into `#plugins` and (if `settingsSchema` is
   * present and passes audit) `#settingsAudit`.
   */
  async scanDir(dir: string, source: string): Promise<void> {
    let entries: Deno.DirEntry[];
    try {
      entries = [];
      for await (const entry of Deno.readDir(dir)) {
        entries.push(entry);
      }
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        // Directory doesn't exist yet — that's fine
        return;
      }
      log.warn("Failed to read plugin directory", {
        dir,
        error: errorMessage(err),
      });
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory || entry.name.startsWith(".")) continue;

      if (!isValidPluginName(entry.name)) {
        log.warn("Skipping plugin with invalid name", {
          name: entry.name,
          dir,
        });
        continue;
      }

      const pluginDir = join(dir, entry.name);
      const manifestPath = join(pluginDir, "plugin.json");

      let raw: string;
      try {
        raw = await Deno.readTextFile(manifestPath);
      } catch {
        // No plugin.json — skip silently
        continue;
      }

      let manifest: PluginManifest;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null) {
          log.warn("Invalid plugin manifest: not an object", {
            path: manifestPath,
          });
          continue;
        }
        manifest = parsed as PluginManifest;
      } catch (err: unknown) {
        log.warn("Invalid JSON in manifest", {
          path: manifestPath,
          error: errorMessage(err),
        });
        continue;
      }

      // Validate required fields
      if (!manifest.name || typeof manifest.name !== "string") {
        log.warn("Plugin missing required 'name' field — skipping", {
          dir: pluginDir,
        });
        continue;
      }

      // Require manifest name matches directory name to prevent impersonation
      if (manifest.name !== entry.name) {
        log.warn("Plugin manifest.name does not match directory — skipping", {
          dirName: entry.name,
          manifestName: manifest.name,
        });
        continue;
      }

      // Log override when external plugin replaces built-in
      if (this.#plugins.has(manifest.name)) {
        const existing = this.#plugins.get(manifest.name)!;
        log.warn("Plugin override", {
          plugin: manifest.name,
          source,
          overriddenDir: existing.dir,
        });
      }

      // Validate and normalize frontendStyles
      const validatedStyles = await validateFrontendStyles(
        manifest,
        pluginDir,
      );

      // Validate and normalize actionButtons
      const validatedActionButtons = validateActionButtons(manifest);

      // Validate settingsSchema if present
      if (manifest.settingsSchema !== undefined) {
        const audit = auditSettingsSchema(manifest, this.#schemaVersionWarned);
        if (audit === null) {
          // Audit rejected schema — strip it.
          (manifest as { settingsSchema?: unknown }).settingsSchema = undefined;
        } else {
          this.#settingsAudit.set(manifest.name, audit);
        }
      }

      // Validate hooks declarations
      if (!validateHookDeclarations(manifest)) {
        continue;
      }

      this.#plugins.set(manifest.name, {
        manifest,
        dir: pluginDir,
        source,
        validatedStyles,
        validatedActionButtons,
      });
    }
  }

  /**
   * Dynamically import a plugin's backend module and call its
   * `register()` (or default export). Transactional: any failure leaves
   * the manager state untouched apart from the failing plugin being
   * removed entirely from `#plugins` and `#dynamicVarProviders`.
   */
  async loadBackendModule(name: string, entry: PluginEntry): Promise<void> {
    const modulePath: string = resolve(
      entry.dir,
      entry.manifest.backendModule!,
    );

    if (!isPathContained(entry.dir, modulePath)) {
      log.warn("Plugin backendModule escapes plugin directory — skipping", {
        plugin: name,
        path: modulePath,
      });
      this.#plugins.delete(name);
      return;
    }

    // Transactional registration: stage register() calls into a per-plugin
    // map, validate against manifest declarations, then commit to the live
    // dispatcher only on success. On any failure, discard staged entries
    // and remove the plugin from #plugins entirely.
    interface StagedEntry {
      readonly stage: HookStage;
      readonly handler: HookHandler;
      readonly priority: number;
      readonly parallel: boolean;
      readonly readOnly: boolean;
      readonly concurrency?: number;
      readonly dependsOn?: readonly string[];
    }
    const staged: StagedEntry[] = [];
    const stagedStages = new Set<HookStage>();
    // Hoisted so the failure path can tear down subscriptions even when the
    // plugin's register() threw partway through.
    const eventSubscriberUnsubs = new Set<() => void>();

    // Build a lookup for manifest hook declarations (parallel dispatch metadata)
    const manifestHookMap = new Map<string, Record<string, unknown>>();
    if (Array.isArray(entry.manifest.hooks)) {
      for (const h of entry.manifest.hooks) {
        const decl = h as Record<string, unknown>;
        manifestHookMap.set(decl.stage as string, decl);
      }
    }

    try {
      const mod = await import("file://" + modulePath) as Record<
        string,
        unknown
      >;
      const registerFn = mod.register || mod.default;

      if (typeof registerFn === "function") {
        const pluginLogger = createLogger("plugin", {
          baseData: { plugin: name },
        });
        const stagingHooks = {
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
            this.#hookDispatcher.subscribeHandlerEvents(wrapped, {
              plugin: name,
              kind: "handler-start",
            });
            let unsubbed = false;
            const unsub = () => {
              if (unsubbed) return;
              unsubbed = true;
              this.#hookDispatcher.unsubscribeHandlerEvents(wrapped);
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
            this.#hookDispatcher.subscribeHandlerEvents(wrapped, {
              plugin: name,
              kind: "handler-end",
            });
            let unsubbed = false;
            const unsub = () => {
              if (unsubbed) return;
              unsubbed = true;
              this.#hookDispatcher.unsubscribeHandlerEvents(wrapped);
              eventSubscriberUnsubs.delete(unsub);
            };
            eventSubscriberUnsubs.add(unsub);
            return unsub;
          },
        };
        const context: PluginRegisterContext = {
          hooks: stagingHooks,
          logger: pluginLogger,
          getSettings: () => this.#getSettings(name),
        };
        await (registerFn as (
          ctx: PluginRegisterContext,
        ) => void | Promise<void>)(context);

        // Strict declare-vs-register cross-check for parallel-dispatch stages.
        // Only PARALLEL_ALLOWED stages participate: parallel dispatch requires
        // explicit opt-in via hooks[]. Non-PARALLEL_ALLOWED stages in hooks[]
        // are informational (for hook-inspector reads/writes) and don't require
        // a matching register() call.
        if (Array.isArray(entry.manifest.hooks)) {
          const declaredBackend = new Set(
            entry.manifest.hooks
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
              `Plugin '${name}' hook declarations do not match registration — declaredOnly: [${
                declaredOnly.join(", ")
              }], registeredOnly: [${registeredOnly.join(", ")}]`,
            );
          }
        }

        // Commit: replay staged registrations into the live dispatcher.
        for (const s of staged) {
          this.#hookDispatcher.register(
            s.stage,
            s.handler,
            {
              priority: s.priority,
              parallel: s.parallel,
              readOnly: s.readOnly,
              concurrency: s.concurrency,
              dependsOn: s.dependsOn,
            },
            name,
            pluginLogger,
          );
        }
        log.debug("Plugin registered successfully", { plugin: name });
      }

      const hasDynVars = typeof mod.getDynamicVariables === "function";
      if (!registerFn && !hasDynVars) {
        log.warn("Plugin backend module has no register() or default export", {
          plugin: name,
        });
      }

      if (hasDynVars) {
        this.#dynamicVarProviders.set(
          name,
          mod.getDynamicVariables as DynamicVarProvider,
        );
      }

      // Store registerRoutes function reference if exported
      if (typeof mod.registerRoutes === "function") {
        entry.registerRoutes = mod
          .registerRoutes as PluginEntry["registerRoutes"];
        log.debug("Plugin exports registerRoutes", { plugin: name });
      }
    } catch (err: unknown) {
      log.error("Failed to load backend module", {
        plugin: name,
        error: errorMessage(err),
      });
      // Tear down any handler-event subscriptions the plugin made during
      // its (now-failed) register() call so the dispatcher does not retain
      // dangling references for a plugin that isn't loaded.
      for (const u of eventSubscriberUnsubs) {
        try {
          u();
        } catch {
          /* ignore teardown errors */
        }
      }
      // Discard staged entries and unregister the plugin entirely. This
      // ensures #plugins, the route registrar map, dynamic var providers,
      // and the live HookDispatcher remain consistent.
      this.#plugins.delete(name);
      this.#dynamicVarProviders.delete(name);
    }
  }
}
