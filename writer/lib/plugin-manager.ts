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
import { isAbsolute, join, resolve } from "@std/path";
import { isPathContained } from "./path-safety.ts";
import { validateTemplate } from "./template.ts";
import type { ValidationError } from "./schema-validator.ts";
import type {
  ActionButtonDescriptor,
  DynamicVariableContext,
  HandlerEventSubscriber,
  HookHandler,
  HookStage,
  PluginHookDeclaration,
  PluginManifest,
  PluginRegisterContext,
  RegisterOptions,
} from "../types.ts";
import { HookDispatcher, PARALLEL_ALLOWED, VALID_STAGES } from "./hooks.ts";
import { createLogger } from "./logger.ts";
import {
  validateActionButtons,
  validateFrontendStyles,
  validateHookDeclarations,
} from "./plugin-validators.ts";
import {
  auditSettingsSchema,
  type SettingsAudit,
} from "./plugin-settings-audit.ts";
import { PluginSettingsService } from "./plugin-settings.ts";
import { validateDependsOnDAG } from "./plugin-depends-on-dag.ts";
import {
  getCombinedStripTagPatterns as stripTagsGetCombinedPatterns,
  getStripTagDeclarations as stripTagsGetDeclarations,
  getStripTagPatterns as stripTagsGetPromptPatterns,
} from "./plugin-strip-tags.ts";

const log = createLogger("plugin");

interface PluginEntry {
  readonly manifest: PluginManifest;
  readonly dir: string;
  readonly source: string;
  readonly validatedStyles: string[];
  readonly validatedActionButtons: ActionButtonDescriptor[];
  registerRoutes?: (
    context: import("../types.ts").PluginRouteContext,
  ) => void | Promise<void>;
}

interface PromptVariables {
  readonly variables: Record<string, string>;
  readonly fragments: string[];
  readonly metadata?: Record<string, { plugin: string; file: string }>;
}

interface ParameterInfo {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly source: string;
}

export function isValidPluginName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !/\.\.|\x00|[/\\]/.test(name)
  );
}

// Verify resolved path stays within a base directory (re-exported from path-safety.ts).


export class PluginManager {
  #builtinDir: string;
  #externalDir: string | null;
  #hookDispatcher: HookDispatcher;
  #playgroundDir: string;
  #plugins: Map<string, PluginEntry> = new Map();
  #settingsAudit: Map<string, SettingsAudit> = new Map();
  #schemaVersionWarned: Set<string> = new Set();
  #settings: PluginSettingsService;
  #dynamicVarProviders: Map<
    string,
    (
      context: DynamicVariableContext,
    ) => Promise<Record<string, unknown>> | Record<string, unknown>
  > = new Map();

  /**
   * @param {string} builtinDir - Absolute path to built-in plugins (e.g. ROOT_DIR/plugins)
   * @param {string|undefined} externalDir - Optional absolute path to external plugins (PLUGIN_DIR env)
   * @param {import('./hooks.ts').HookDispatcher} hookDispatcher
   * @param {string} playgroundDir - Absolute path to the playground directory
   */
  constructor(
    builtinDir: string,
    externalDir: string | undefined,
    hookDispatcher: HookDispatcher,
    playgroundDir: string,
  ) {
    this.#builtinDir = builtinDir;
    this.#externalDir = externalDir || null;
    this.#hookDispatcher = hookDispatcher;
    this.#playgroundDir = playgroundDir;
    this.#settings = new PluginSettingsService(
      this.#plugins,
      this.#settingsAudit,
      playgroundDir,
    );
  }

  /**
   * Scan plugin directories, parse manifests, load backend modules, register hooks.
   */
  async init(): Promise<void> {
    // Ensure _plugins config directory exists
    await Deno.mkdir(join(this.#playgroundDir, "_plugins"), {
      recursive: true,
    });

    // Scan built-in plugins
    await this.#scanDir(this.#builtinDir, "built-in");

    // Scan external plugins (override built-in on name collision)
    if (this.#externalDir) {
      if (!isAbsolute(this.#externalDir)) {
        log.warn(
          "PLUGIN_DIR must be an absolute path — skipping external plugins",
          { path: this.#externalDir },
        );
      } else {
        await this.#scanDir(this.#externalDir, "external");
      }
    }

    // BREAKING: Validate every promptFragment file source against the SSTI
    // whitelist BEFORE registering any hooks or loading any backend module.
    // A plugin with an unsafe fragment is removed from #plugins entirely so
    // it leaves no observable side effects (no hooks, no settings, no
    // fragment variables, no introspection entries).
    await this.validatePluginFragments();

    // Load backend modules for all registered plugins
    for (const [name, entry] of this.#plugins) {
      if (entry.manifest.backendModule) {
        await this.#loadBackendModule(name, entry);
      }
    }

    log.info("Plugins loaded", {
      count: this.#plugins.size,
      plugins: [...this.#plugins.keys()],
    });

    // Global dependsOn DAG validation (task 2.8): run after ALL plugins loaded
    validateDependsOnDAG(this.#plugins);
  }

  /**
   * Validate every plugin's `promptFragments[].file` source against the SSTI
   * whitelist (`validateTemplate()`). Plugins whose fragments contain
   * forbidden tokens (e.g. `{{ set }}`, `{{ include }}`, `{{> jsExpr }}`)
   * are removed from `#plugins` so they leave no observable side effects.
   *
   * MUST be invoked before hook registration / backend module loading.
   * Idempotent — safe to call again after `#plugins` mutates.
   */
  async validatePluginFragments(): Promise<void> {
    const toRemove: string[] = [];
    for (const [name, entry] of this.#plugins) {
      const manifest = entry.manifest;
      if (!Array.isArray(manifest.promptFragments)) continue;

      for (const frag of manifest.promptFragments) {
        if (!frag.file) continue;
        const filePath = resolve(entry.dir, frag.file);
        if (!isPathContained(entry.dir, filePath)) {
          log.error("Plugin fragment path escapes plugin directory — removing plugin", {
            plugin: name,
            file: frag.file,
          });
          toRemove.push(name);
          break;
        }

        let source: string;
        try {
          source = await Deno.readTextFile(filePath);
        } catch (err: unknown) {
          log.error("Plugin fragment file unreadable during SSTI validation — removing plugin", {
            plugin: name,
            file: frag.file,
            error: errorMessage(err),
          });
          toRemove.push(name);
          break;
        }

        const errors = validateTemplate(source);
        if (errors.length > 0) {
          log.error("Plugin fragment failed SSTI validation — removing plugin", {
            plugin: name,
            file: frag.file,
            expressions: errors,
          });
          toRemove.push(name);
          break;
        }
      }
    }

    for (const name of toRemove) {
      this.#plugins.delete(name);
    }
  }

  /**
   * Scan a directory for plugin subdirectories containing plugin.json.
   */
  async #scanDir(dir: string, source: string): Promise<void> {
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

      // Validate settingsSchema if present (task 1.1)
      if (manifest.settingsSchema !== undefined) {
        const audit = auditSettingsSchema(manifest, this.#schemaVersionWarned);
        if (audit === null) {
          // Audit rejected schema — strip it.
          (manifest as { settingsSchema?: unknown }).settingsSchema = undefined;
        } else {
          this.#settingsAudit.set(manifest.name, audit);
        }
      }

      // Validate hooks declarations (hook-inspector change)
      if (!validateHookDeclarations(manifest)) {
        // Invalid hooks declarations — skip this plugin entirely
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
   * Dynamically import a plugin's backend module and call register().
   */
  async #loadBackendModule(name: string, entry: PluginEntry): Promise<void> {
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
        // Track per-plugin handler-event subscriber unsubscribers so we
        // can deterministically tear them down if registration fails.
        // (Backed by the hoisted Set above so the catch block can access it.)
        const stagingHooks = {
          register: (
            stage: HookStage,
            handler: HookHandler,
            priorityOrOptions?: number | RegisterOptions,
          ) => {
            // Mirror HookDispatcher.register validations up-front so a failing
            // stage/handler aborts the plugin before any partial commit can
            // happen. Without this, an invalid second register call would
            // throw during commit-replay while earlier handlers are already
            // live in the dispatcher.
            if (!VALID_STAGES.has(stage)) {
              throw new Error(
                `Invalid hook stage '${stage}'. Valid stages: ${[...VALID_STAGES].join(", ")}`,
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
            const opts: RegisterOptions =
              typeof priorityOrOptions === "number"
                ? { priority: priorityOrOptions }
                : priorityOrOptions ?? {};

            // Merge manifest-derived parallel dispatch options (runtime opts
            // union with manifest: dependsOn arrays are concatenated, explicit
            // runtime fields take precedence for scalar values).
            const manifestDecl = manifestHookMap.get(stage);
            const manifestDeps = (manifestDecl?.dependsOn as readonly string[] | undefined) ?? [];
            const runtimeDeps = opts.dependsOn ?? [];
            const mergedDeps = [...new Set([...manifestDeps, ...runtimeDeps])];

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
           * Subscribe to `handler-start` events for any handler running in
           * the live dispatcher. The subscription persists for the lifetime
           * of the plugin; returns an idempotent unsubscribe closure.
           */
          onHandlerStart: (
            cb: (event: import("../types.ts").HandlerEvent & { kind: "handler-start" }) => void,
          ): (() => void) => {
            const wrapped: HandlerEventSubscriber = (ev) => {
              if (ev.kind === "handler-start") cb(ev);
            };
            this.#hookDispatcher.subscribeHandlerEvents(wrapped, { plugin: name, kind: "handler-start" });
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
           * Subscribe to `handler-end` events for any handler running in
           * the live dispatcher. Returns an idempotent unsubscribe closure.
           */
          onHandlerEnd: (
            cb: (event: import("../types.ts").HandlerEvent & { kind: "handler-end" }) => void,
          ): (() => void) => {
            const wrapped: HandlerEventSubscriber = (ev) => {
              if (ev.kind === "handler-end") cb(ev);
            };
            this.#hookDispatcher.subscribeHandlerEvents(wrapped, { plugin: name, kind: "handler-end" });
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
          getSettings: () => this.getPluginSettings(name),
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
              `Plugin '${name}' hook declarations do not match registration — declaredOnly: [${declaredOnly.join(", ")}], registeredOnly: [${registeredOnly.join(", ")}]`,
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
          mod.getDynamicVariables as (
            context: DynamicVariableContext,
          ) => Promise<Record<string, unknown>> | Record<string, unknown>,
        );
      }

      // Store registerRoutes function reference if exported (task 1.2)
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
        try { u(); } catch { /* ignore teardown errors */ }
      }
      // Discard staged entries and unregister the plugin entirely. This
      // ensures #plugins, the route registrar map, dynamic var providers,
      // and the live HookDispatcher remain consistent.
      this.#plugins.delete(name);
      this.#dynamicVarProviders.delete(name);
    }
  }

  /**
   * Returns array of all loaded plugin manifests.
   */
  getPlugins(): PluginManifest[] {
    return [...this.#plugins.values()].map((e) => e.manifest);
  }

  /**
   * Strip-tag declarations derived from `promptStripTags` and
   * `displayStripTags` across all loaded plugins. Used by the hook-inspector
   * route to surface declarative tag-removal contracts as a distinct
   * category from runtime hook handlers.
   */
  getStripTagDeclarations(): Array<{
    plugin: string;
    tags: string[];
    scope: "prompt+display" | "prompt" | "display";
  }> {
    return stripTagsGetDeclarations(this.#plugins);
  }

  /**
   * Returns a combined regex matching all tags from plugins'
   * `promptStripTags` arrays, or null if no strip tags are registered.
   */
  getStripTagPatterns(): RegExp | null {
    return stripTagsGetPromptPatterns(this.#plugins);
  }

  /**
   * Returns a combined regex matching tags from BOTH `promptStripTags` and
   * `displayStripTags` across all loaded plugins, or null if neither field
   * declares any entries.
   */
  getCombinedStripTagPatterns(): RegExp | null {
    return stripTagsGetCombinedPatterns(this.#plugins);
  }

  /**
   * Returns the manifest hook declarations for every loaded plugin that has
   * an explicit `hooks` field in `plugin.json`. Plugins without a `hooks`
   * field (legacy mode) are OMITTED so callers (notably the frontend
   * `finalizeBoot()` check) can distinguish "explicitly declared no hooks"
   * from "did not declare at all". The returned array is the manifest source
   * of truth, NOT runtime registration facts.
   */
  getPluginHookDeclarations(): Array<{
    plugin: string;
    hooks: readonly PluginHookDeclaration[];
  }> {
    return [...this.#plugins.values()]
      .filter(({ manifest }) => Array.isArray(manifest.hooks))
      .map(({ manifest }) => ({
        plugin: manifest.name,
        hooks: manifest.hooks as readonly PluginHookDeclaration[],
      }));
  }
  /**
   * Collect prompt fragment variables from all plugins.
   * Returns { variables: { name: content, ... }, fragments: [content, ...] }
   */
  async getPromptVariables(): Promise<PromptVariables> {
    const variables: Record<string, string> = {};
    const fragments: string[] = [];
    const metadata: Record<string, { plugin: string; file: string }> = {};

    const allFragments: Array<{ content: string; priority: number }> = [];

    for (const { manifest, dir } of this.#plugins.values()) {
      if (!Array.isArray(manifest.promptFragments)) continue;

      const pluginSettings = await this.getPluginSettings(manifest.name);
      if (pluginSettings.enabled === false) continue;

      for (const frag of manifest.promptFragments) {
        if (!frag.file) continue;

        const filePath = resolve(dir, frag.file);

        if (!isPathContained(dir, filePath)) {
          log.warn("Plugin fragment escapes plugin directory — skipping", {
            plugin: manifest.name,
            file: frag.file,
          });
          continue;
        }

        let content: string;
        try {
          content = await Deno.readTextFile(filePath);
        } catch (err: unknown) {
          log.warn("Failed to read prompt fragment", {
            plugin: manifest.name,
            file: frag.file,
            error: errorMessage(err),
          });
          continue;
        }

        // Depth-defense: revalidate fragment source against SSTI whitelist
        // every read (catches on-disk edits between plugin load and current
        // call). On failure, skip this fragment with a warn log; the plugin
        // remains active for its other fragments.
        const ssti = validateTemplate(content);
        if (ssti.length > 0) {
          log.warn("Plugin fragment failed SSTI revalidation — skipping fragment", {
            plugin: manifest.name,
            file: frag.file,
            expressions: ssti,
          });
          continue;
        }

        const priority = typeof frag.priority === "number"
          ? frag.priority
          : 100;

        if (frag.variable) {
          // Named variable — store directly
          variables[frag.variable] = content;
          metadata[frag.variable] = { plugin: manifest.name, file: frag.file };
        } else {
          // Unnamed — add to generic fragments array
          allFragments.push({ content, priority });
        }
      }
    }

    // Sort generic fragments by priority and extract content
    allFragments.sort((a, b) => a.priority - b.priority);
    fragments.push(...allFragments.map((f) => f.content));

    return { variables, fragments, metadata };
  }

  /** Core template variable names that plugins must not override. */
  static readonly #CORE_TEMPLATE_VARS = new Set([
    "previous_context",
    "user_input",
    "isFirstRound",
    "series_name",
    "story_name",
    "plugin_fragments",
  ]);

  /**
   * Collect dynamic template variables from all plugins that export getDynamicVariables().
   * Collision policy: core vars are rejected; first-loaded plugin wins for inter-plugin conflicts.
   */
  async getDynamicVariables(
    context: DynamicVariableContext,
  ): Promise<Record<string, unknown>> {
    const { variables } = await this.getDynamicVariablesWithWarnings(context);
    return variables;
  }

  /**
   * Like {@link getDynamicVariables} but also returns per-plugin warnings for
   * any plugin whose `getDynamicVariables()` throws. Used by the template
   * editor's variable catalog so the UI can surface a named warning per
   * failing plugin without aborting the whole catalog.
   */
  async getDynamicVariablesWithWarnings(
    context: DynamicVariableContext,
  ): Promise<{
    variables: Record<string, unknown>;
    warnings: Array<{ pluginName: string; message: string }>;
  }> {
    const result: Record<string, unknown> = {};
    const warnings: Array<{ pluginName: string; message: string }> = [];

    for (const [pluginName, provider] of this.#dynamicVarProviders) {
      try {
        const pluginSettings = await this.getPluginSettings(pluginName);
        if (pluginSettings.enabled === false) continue;
        const extendedContext: DynamicVariableContext = {
          ...context,
          getSettings: () => this.getPluginSettings(pluginName),
        };
        const vars = await provider(extendedContext);
        if (!vars || typeof vars !== "object") continue;

        for (const [key, value] of Object.entries(vars)) {
          if (PluginManager.#CORE_TEMPLATE_VARS.has(key)) {
            log.warn("Plugin attempted to set core variable — ignored", {
              plugin: pluginName,
              key,
            });
            continue;
          }
          if (key in result) {
            log.warn(
              "Plugin dynamic variable conflicts with earlier plugin — using first value",
              { plugin: pluginName, key },
            );
            continue;
          }
          result[key] = value;
        }
      } catch (err: unknown) {
        const message = errorMessage(err);
        log.warn("Plugin getDynamicVariables() failed", {
          plugin: pluginName,
          error: message,
        });
        warnings.push({ pluginName, message });
      }
    }

    return { variables: result, warnings };
  }

  /**
   * Enumerate every plugin promptFragment as inspectable references (no file
   * contents read) — used by the template editor listing endpoint to surface
   * both named (`variable`) and unnamed fragments. Disabled plugins are
   * skipped.
   */
  enumerateFragmentRefs(): Array<{
    plugin: string;
    file: string;
    variable?: string;
    priority?: number;
  }> {
    const refs: Array<{
      plugin: string;
      file: string;
      variable?: string;
      priority?: number;
    }> = [];
    for (const { manifest } of this.#plugins.values()) {
      if (!Array.isArray(manifest.promptFragments)) continue;
      for (const frag of manifest.promptFragments) {
        if (!frag.file) continue;
        refs.push({
          plugin: manifest.name,
          file: frag.file,
          variable: frag.variable,
          priority: typeof frag.priority === "number" ? frag.priority : undefined,
        });
      }
    }
    return refs;
  }

  /**
   * Returns true when a plugin with the given name is in the loaded-plugin
   * registry. Useful for distinguishing syntactically-valid-but-unknown names
   * (HTTP 404) from syntactically-invalid names (HTTP 400).
   */
  hasPlugin(name: string): boolean {
    return this.#plugins.has(name);
  }

  /**
   * Returns the absolute path to a plugin's directory.
   * @param {string} name - Plugin name
   * @returns {string|null}
   */
  getPluginDir(name: string): string | null {
    const entry = this.#plugins.get(name);
    return entry ? entry.dir : null;
  }

  /**
   * Returns the validated, normalized list of relative CSS paths declared in
   * a plugin's frontendStyles manifest field. Returns an empty array if the
   * plugin is unknown or has no valid styles.
   */
  getPluginStyles(name: string): string[] {
    const entry = this.#plugins.get(name);
    return entry ? [...entry.validatedStyles] : [];
  }

  /**
   * Returns the validated, default-filled list of `ActionButtonDescriptor`s
   * declared in a plugin's `actionButtons` manifest field. Returns an empty
   * array for unknown plugins or plugins that did not declare the field.
   */
  getPluginActionButtons(name: string): ActionButtonDescriptor[] {
    const entry = this.#plugins.get(name);
    return entry ? [...entry.validatedActionButtons] : [];
  }

  /** Returns the absolute path to the built-in plugins directory. */
  getBuiltinDir(): string {
    return this.#builtinDir;
  }

  /**
   * Returns all available Vento parameters from core + plugins.
   * Each entry: { name, type, description, source }
   */
  getParameters(): ParameterInfo[] {
    const params: ParameterInfo[] = [
      {
        name: "previous_context",
        type: "array",
        description: "Array of previous chapter contents (stripped)",
        source: "core",
      },
      {
        name: "user_input",
        type: "string",
        description: "Current user message",
        source: "core",
      },
      {
        name: "isFirstRound",
        type: "boolean",
        description: "Whether this is the first round (no non-empty chapters)",
        source: "core",
      },
      {
        name: "series_name",
        type: "string",
        description: "Display name of the current series",
        source: "core",
      },
      {
        name: "story_name",
        type: "string",
        description: "Display name of the current story",
        source: "core",
      },
      {
        name: "plugin_fragments",
        type: "array",
        description: "Array of plugin-contributed prompt fragments",
        source: "core",
      },
    ];

    for (const { manifest } of this.#plugins.values()) {
      // Parameters declared in plugin manifest
      if (Array.isArray(manifest.parameters)) {
        for (const p of manifest.parameters) {
          params.push({
            name: p.name,
            type: p.type || "string",
            description: p.description || "",
            source: manifest.name,
          });
        }
      }

      // Prompt fragment variables are also available as parameters
      if (Array.isArray(manifest.promptFragments)) {
        for (const frag of manifest.promptFragments) {
          if (frag.variable) {
            params.push({
              name: frag.variable,
              type: "string",
              description:
                `Prompt fragment from ${manifest.name} (${frag.file})`,
              source: manifest.name,
            });
          }
        }
      }
    }

    return params;
  }

  /**
   * Returns route registrar info for all plugins that export `registerRoutes`.
   * Called by app.ts route wiring to mount plugin-specific HTTP routes.
   */
  getPluginRouteRegistrars(): Array<
    {
      name: string;
      registerRoutes: NonNullable<PluginEntry["registerRoutes"]>;
      dir: string;
    }
  > {
    const registrars: Array<
      {
        name: string;
        registerRoutes: NonNullable<PluginEntry["registerRoutes"]>;
        dir: string;
      }
    > = [];
    for (const [name, entry] of this.#plugins) {
      if (entry.registerRoutes) {
        registrars.push({
          name,
          registerRoutes: entry.registerRoutes,
          dir: entry.dir,
        });
      }
    }
    return registrars;
  }

  // ---- Settings (delegated to PluginSettingsService) ----

  hasSettingsSchema(name: string): boolean {
    return this.#settings.hasSettingsSchema(name);
  }

  getPluginSettingsSchema(name: string): Record<string, unknown> | null {
    return this.#settings.getSettingsSchema(name);
  }

  getPluginSettings(name: string): Promise<Record<string, unknown>> {
    return this.#settings.getSettings(name);
  }

  getPluginSettingsForResponse(
    name: string,
  ): Promise<{
    settings: Record<string, unknown>;
    legacyWarnings: ValidationError[];
    schemaVersionMismatch: boolean;
  }> {
    return this.#settings.getSettingsForResponse(name);
  }

  savePluginSettings(
    name: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    return this.#settings.saveSettings(name, settings);
  }

  validateAndPreparePluginSettings(
    name: string,
    body: Record<string, unknown>,
  ): Promise<{
    errors: ValidationError[];
    warnings: ValidationError[];
    finalSettings: Record<string, unknown>;
    changedPaths: string[];
    durationMs: number;
    malformedChangedPaths: boolean;
    schemaVersionMismatch: boolean;
  }> {
    return this.#settings.validateAndPrepare(name, body);
  }

  commitPluginSettings(
    name: string,
    finalSettings: Record<string, unknown>,
  ): Promise<void> {
    return this.#settings.commit(name, finalSettings);
  }

  getEffectivePathRoots(
    name: string,
  ): { display: string[]; absolute: string[] } | null {
    return this.#settings.getEffectivePathRoots(name);
  }

  getSchemaVersion(name: string): number | null {
    return this.#settings.getSchemaVersion(name);
  }

  isSchemaVersionMismatch(name: string): boolean {
    return this.#settings.isSchemaVersionMismatch(name);
  }

}
