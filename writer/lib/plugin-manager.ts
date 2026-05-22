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

import { isAbsolute, join } from "@std/path";
import type { ValidationError } from "./schema-validator.ts";
import type {
  ActionButtonDescriptor,
  DynamicVariableContext,
  PluginHookDeclaration,
  PluginManifest,
} from "../types.ts";
import { HookDispatcher } from "./hooks.ts";
import { createLogger } from "./logger.ts";
import { type SettingsAudit } from "./plugin-settings-audit.ts";
import { PluginSettingsService } from "./plugin-settings.ts";
import { validateDependsOnDAG } from "./plugin-depends-on-dag.ts";
import {
  getCombinedStripTagPatterns as stripTagsGetCombinedPatterns,
  getStripTagDeclarations as stripTagsGetDeclarations,
  getStripTagPatterns as stripTagsGetPromptPatterns,
} from "./plugin-strip-tags.ts";
import {
  enumerateFragmentRefs as promptVarsEnumerateFragmentRefs,
  getDynamicVariablesWithWarnings as promptVarsGetDynamicWithWarnings,
  getParameters as promptVarsGetParameters,
  getPromptVariables as promptVarsGetPromptVariables,
  type ParameterInfo,
  type PromptVariables,
  validatePluginFragments as promptVarsValidatePluginFragments,
} from "./plugin-prompt-vars.ts";
import {
  isValidPluginName,
  type PluginEntry,
  PluginLoader,
} from "./plugin-loader.ts";

export { isValidPluginName };

const log = createLogger("plugin");

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

  #loader: PluginLoader;

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
    this.#loader = new PluginLoader(
      this.#plugins,
      this.#settingsAudit,
      this.#schemaVersionWarned,
      this.#hookDispatcher,
      this.#dynamicVarProviders,
      (name) => this.getPluginSettings(name),
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
    await this.#loader.scanDir(this.#builtinDir, "built-in");

    // Scan external plugins (override built-in on name collision)
    if (this.#externalDir) {
      if (!isAbsolute(this.#externalDir)) {
        log.warn(
          "PLUGIN_DIR must be an absolute path — skipping external plugins",
          { path: this.#externalDir },
        );
      } else {
        await this.#loader.scanDir(this.#externalDir, "external");
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
        await this.#loader.loadBackendModule(name, entry);
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
    await promptVarsValidatePluginFragments(this.#plugins);
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
    return await promptVarsGetPromptVariables(
      this.#plugins,
      (name) => this.getPluginSettings(name),
    );
  }

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
    return await promptVarsGetDynamicWithWarnings(
      this.#dynamicVarProviders,
      context,
      (name) => this.getPluginSettings(name),
    );
  }

  /**
   * Enumerate every plugin promptFragment as inspectable references (no file
   * contents read) — used by the template editor listing endpoint to surface
   * both named (`variable`) and unnamed fragments.
   */
  enumerateFragmentRefs(): Array<{
    plugin: string;
    file: string;
    variable?: string;
    priority?: number;
  }> {
    return promptVarsEnumerateFragmentRefs(this.#plugins);
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
    return promptVarsGetParameters(this.#plugins);
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
