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
 *
 * The bulk of each operation is delegated to focused helper modules:
 *
 * - {@link "./plugin-loader-manifest.ts"} — `plugin.json` parsing +
 *   identity validation.
 * - {@link "./plugin-loader-staging.ts"} — transactional staging hooks +
 *   declare-vs-register verification.
 */

import { join, resolve } from "@std/path";
import { errorMessage } from "./errors.ts";
import { isPathContained } from "./path-safety.ts";
import { createLogger } from "./logger.ts";
import { HookDispatcher } from "./hooks.ts";
import {
  validateActionButtons,
  validateFrontendStyles,
  validateHookDeclarations,
} from "./plugin-validators.ts";
import {
  auditSettingsSchema,
  type SettingsAudit,
} from "./plugin-settings-audit.ts";
import { parseManifestFile } from "./plugin-loader-manifest.ts";
import {
  buildManifestHookMap,
  createStagingHooks,
  verifyHookDeclarationsMatch,
} from "./plugin-loader-staging.ts";
import type {
  ActionButtonDescriptor,
  DynamicVariableContext,
  PluginManifest,
  PluginRegisterContext,
  PluginRouteContext,
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

      const manifest = await parseManifestFile(
        pluginDir,
        manifestPath,
        entry.name,
        log,
      );
      if (manifest === null) continue;

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

    // Hoisted so the failure path can tear down subscriptions even when the
    // plugin's register() threw partway through.
    const eventSubscriberUnsubs = new Set<() => void>();

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
        const manifestHookMap = buildManifestHookMap(entry.manifest);
        const { hooks, staged, stagedStages } = createStagingHooks({
          pluginName: name,
          manifestHookMap,
          hookDispatcher: this.#hookDispatcher,
          eventSubscriberUnsubs,
        });
        const context: PluginRegisterContext = {
          hooks,
          logger: pluginLogger,
          getSettings: () => this.#getSettings(name),
        };
        await (registerFn as (
          ctx: PluginRegisterContext,
        ) => void | Promise<void>)(context);

        // Strict declare-vs-register cross-check for parallel-dispatch stages.
        verifyHookDeclarationsMatch(name, entry.manifest, stagedStages);

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
