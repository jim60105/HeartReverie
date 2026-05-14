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

import { isAbsolute, join, resolve, SEPARATOR } from "@std/path";
import type {
  ActionButtonDescriptor,
  ActionButtonVisibility,
  DynamicVariableContext,
  HookHandler,
  HookStage,
  PluginHookDeclaration,
  PluginManifest,
  PluginRegisterContext,
} from "../types.ts";
import { HookDispatcher, KNOWN_BACKEND_STAGES, VALID_STAGES } from "./hooks.ts";
import { createLogger } from "./logger.ts";

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

// Verify resolved path stays within a base directory
function isPathContained(base: string, resolved: string): boolean {
  return resolved === base || resolved.startsWith(base + SEPARATOR);
}

// Escape special regex characters in a string
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Frontend hook stages. Kept in sync with `VALID_STAGES` in
 * `reader-src/src/lib/plugin-hooks.ts`. Used by the manifest validator to
 * accept declarations for stages the backend itself cannot register.
 */
const KNOWN_FRONTEND_STAGES: ReadonlySet<string> = new Set<string>([
  "frontend-render",
  "notification",
  "chat:send:before",
  "chapter:render:after",
  "chapter:dom:ready",
  "chapter:dom:dispose",
  "story:switch",
  "chapter:change",
  "action-button:click",
  "hook-inspector:report",
]);

/** Backend stages eligible for the strict declare-vs-register cross-check. */
const STRICT_BACKEND_STAGES: ReadonlySet<string> = KNOWN_BACKEND_STAGES;


export class PluginManager {
  #builtinDir: string;
  #externalDir: string | null;
  #hookDispatcher: HookDispatcher;
  #playgroundDir: string;
  #plugins: Map<string, PluginEntry> = new Map();
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
        error: err instanceof Error ? err.message : String(err),
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
          error: err instanceof Error ? err.message : String(err),
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
      const validatedStyles = await this.#validateFrontendStyles(
        manifest,
        pluginDir,
      );

      // Validate and normalize actionButtons
      const validatedActionButtons = this.#validateActionButtons(manifest);

      // Validate settingsSchema if present (task 1.1)
      if (manifest.settingsSchema !== undefined) {
        const schema = manifest.settingsSchema;
        if (
          typeof schema !== "object" ||
          schema === null ||
          Array.isArray(schema)
        ) {
          log.warn("Plugin settingsSchema must be an object — ignoring", {
            plugin: manifest.name,
          });
          (manifest as { settingsSchema?: unknown }).settingsSchema = undefined;
        } else if (
          schema.type !== "object" || typeof schema.properties !== "object" ||
          schema.properties === null || Array.isArray(schema.properties)
        ) {
          log.warn(
            "Plugin settingsSchema must have type:'object' and a properties record — ignoring",
            { plugin: manifest.name },
          );
          (manifest as { settingsSchema?: unknown }).settingsSchema = undefined;
        }
      }

      // Validate hooks declarations (hook-inspector change)
      if (!this.#validateHookDeclarations(manifest)) {
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
   * Validate the optional `hooks` declarations on a plugin manifest. Returns
   * `true` when validation passes (or when `hooks` is absent — legacy mode),
   * `false` when the manifest must be skipped entirely.
   *
   * Constraints enforced:
   * - `hooks` must be an array when present
   * - each entry must be an object with a string `stage` field
   * - `stage === "strip-tags"` is rejected (use `promptStripTags` /
   *   `displayStripTags` instead)
   * - duplicate `stage` values within the same array are rejected
   * - unknown stages (not in backend ∪ frontend known sets) log a warn but
   *   do not block load
   * - `note` longer than 200 chars is rejected
   * - non-string entries in `reads` / `writes` are rejected
   */
  #validateHookDeclarations(manifest: PluginManifest): boolean {
    if (manifest.hooks === undefined) return true;
    const pluginLog = log.withContext({ baseData: { plugin: manifest.name } });
    if (!Array.isArray(manifest.hooks)) {
      pluginLog.error("Plugin manifest 'hooks' must be an array — skipping plugin");
      return false;
    }
    const seen = new Set<string>();
    for (const entry of manifest.hooks) {
      if (typeof entry !== "object" || entry === null) {
        pluginLog.error("Plugin manifest 'hooks' entry must be an object — skipping plugin");
        return false;
      }
      const decl = entry as PluginHookDeclaration;
      if (typeof decl.stage !== "string" || decl.stage.length === 0) {
        pluginLog.error(
          "Plugin manifest 'hooks' entry missing 'stage' string — skipping plugin",
        );
        return false;
      }
      if (decl.stage === "strip-tags") {
        pluginLog.error(
          "Plugin manifest 'hooks' may not declare 'strip-tags' — use promptStripTags / displayStripTags instead — skipping plugin",
          { stage: decl.stage },
        );
        return false;
      }
      if (seen.has(decl.stage)) {
        pluginLog.error(
          "Plugin manifest 'hooks' has duplicate stage entry — skipping plugin",
          { stage: decl.stage },
        );
        return false;
      }
      seen.add(decl.stage);
      if (
        !STRICT_BACKEND_STAGES.has(decl.stage) &&
        !KNOWN_FRONTEND_STAGES.has(decl.stage)
      ) {
        pluginLog.warn("Plugin manifest 'hooks' declares unknown stage", {
          stage: decl.stage,
        });
      }
      if (decl.note !== undefined) {
        if (typeof decl.note !== "string" || decl.note.length > 200) {
          pluginLog.error(
            "Plugin manifest 'hooks' entry 'note' must be a string ≤200 chars — skipping plugin",
            { stage: decl.stage },
          );
          return false;
        }
      }
      for (const field of ["reads", "writes"] as const) {
        const arr = decl[field];
        if (arr === undefined) continue;
        if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string")) {
          pluginLog.error(
            `Plugin manifest 'hooks' entry '${field}' must be a string[] — skipping plugin`,
            { stage: decl.stage },
          );
          return false;
        }
      }
      if (decl.priority !== undefined && typeof decl.priority !== "number") {
        pluginLog.error(
          "Plugin manifest 'hooks' entry 'priority' must be a number — skipping plugin",
          { stage: decl.stage },
        );
        return false;
      }
    }
    return true;
  }

  /**
   * Validate, default, and deduplicate a plugin's `actionButtons` entries.
   * Returns a frozen array of fully-resolved descriptors with defaults filled
   * (`priority: 100`, `visibleWhen: "last-chapter-backend"`). Invalid entries
   * are dropped individually with a logged warning under the plugin's scope.
   */
  #validateActionButtons(manifest: PluginManifest): ActionButtonDescriptor[] {
    const raw: unknown = manifest.actionButtons;
    if (raw === undefined) return [];
    const pluginLog = log.withContext({ baseData: { plugin: manifest.name } });
    if (!Array.isArray(raw)) {
      pluginLog.warn("Plugin has non-array actionButtons — ignoring");
      return [];
    }

    const idRegex = /^[a-z0-9-]+$/;
    const allowedVisibility: readonly ActionButtonVisibility[] = [
      "last-chapter-backend",
      "backend-only",
    ];
    const seenIds = new Set<string>();
    const validated: ActionButtonDescriptor[] = [];

    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        pluginLog.warn(
          "Plugin actionButtons entry is not an object — skipping",
        );
        continue;
      }
      const descriptor = entry as Record<string, unknown>;

      const id = descriptor.id;
      if (typeof id !== "string" || !idRegex.test(id)) {
        pluginLog.warn("Plugin actionButtons entry has invalid id — skipping", {
          id,
        });
        continue;
      }
      if (seenIds.has(id)) {
        pluginLog.warn(
          "Plugin actionButtons entry has duplicate id — skipping",
          { id },
        );
        continue;
      }

      const labelRaw = descriptor.label;
      if (typeof labelRaw !== "string") {
        pluginLog.warn(
          "Plugin actionButtons entry has non-string label — skipping",
          { id },
        );
        continue;
      }
      const label = labelRaw.trim();
      if (label.length < 1 || label.length > 40) {
        pluginLog.warn(
          "Plugin actionButtons entry has out-of-range label — skipping",
          { id, length: label.length },
        );
        continue;
      }

      const iconRaw = descriptor.icon;
      let icon: string | undefined;
      if (iconRaw !== undefined) {
        if (typeof iconRaw !== "string") {
          pluginLog.warn(
            "Plugin actionButtons entry has non-string icon — skipping",
            { id },
          );
          continue;
        }
        icon = iconRaw;
      }

      const tooltipRaw = descriptor.tooltip;
      let tooltip: string | undefined;
      if (tooltipRaw !== undefined) {
        if (typeof tooltipRaw !== "string" || tooltipRaw.length > 200) {
          pluginLog.warn(
            "Plugin actionButtons entry has invalid tooltip — skipping",
            { id },
          );
          continue;
        }
        tooltip = tooltipRaw;
      }

      const priorityRaw = descriptor.priority;
      let priority = 100;
      if (priorityRaw !== undefined) {
        if (typeof priorityRaw !== "number" || !Number.isFinite(priorityRaw)) {
          pluginLog.warn(
            "Plugin actionButtons entry has non-finite priority — skipping",
            { id, priority: priorityRaw },
          );
          continue;
        }
        priority = priorityRaw;
      }

      const visibleWhenRaw = descriptor.visibleWhen;
      let visibleWhen: ActionButtonVisibility = "last-chapter-backend";
      if (visibleWhenRaw !== undefined) {
        if (
          typeof visibleWhenRaw !== "string" ||
          !allowedVisibility.includes(visibleWhenRaw as ActionButtonVisibility)
        ) {
          pluginLog.warn(
            "Plugin actionButtons entry has unknown visibleWhen — skipping",
            { id, visibleWhen: visibleWhenRaw },
          );
          continue;
        }
        visibleWhen = visibleWhenRaw as ActionButtonVisibility;
      }

      seenIds.add(id);
      const resolved: ActionButtonDescriptor = {
        id,
        label,
        ...(icon !== undefined ? { icon } : {}),
        ...(tooltip !== undefined ? { tooltip } : {}),
        priority,
        visibleWhen,
      };
      validated.push(resolved);
    }

    return validated;
  }

  /**
   * Validate, normalize, and deduplicate a plugin's frontendStyles entries.
   * Returns an array of normalized relative paths (forward-slash, no leading "./")
   * whose resolved targets exist on disk and are contained within the plugin directory.
   */
  async #validateFrontendStyles(
    manifest: PluginManifest,
    pluginDir: string,
  ): Promise<string[]> {
    const raw: unknown = manifest.frontendStyles;
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      log.warn("Plugin has non-array frontendStyles — ignoring", {
        plugin: manifest.name,
      });
      return [];
    }

    const seen = new Set<string>();
    const validated: string[] = [];

    for (const entry of raw) {
      if (typeof entry !== "string" || entry.length === 0) {
        log.warn(
          "Plugin has invalid frontendStyles entry (must be non-empty string) — skipping",
          { plugin: manifest.name },
        );
        continue;
      }
      if (!entry.toLowerCase().endsWith(".css")) {
        log.warn(
          "Plugin frontendStyles entry does not end with .css — skipping",
          { plugin: manifest.name, entry },
        );
        continue;
      }
      if (isAbsolute(entry)) {
        log.warn("Plugin frontendStyles entry is an absolute path — skipping", {
          plugin: manifest.name,
          entry,
        });
        continue;
      }
      // Reject path traversal segments
      const segments = entry.split(/[\\/]/);
      if (segments.some((s) => s === "..")) {
        log.warn("Plugin frontendStyles entry contains '..' — skipping", {
          plugin: manifest.name,
          entry,
        });
        continue;
      }
      // Reject backslashes and URL-hostile characters
      if (/[\\#?%]/.test(entry)) {
        log.warn(
          "Plugin frontendStyles entry contains invalid characters — skipping",
          { plugin: manifest.name, entry },
        );
        continue;
      }

      // Normalize: strip leading "./" (possibly repeated)
      let normalized = entry;
      while (normalized.startsWith("./")) {
        normalized = normalized.slice(2);
      }

      const resolved = resolve(pluginDir, normalized);
      if (!isPathContained(pluginDir, resolved)) {
        log.warn(
          "Plugin frontendStyles entry escapes plugin directory — skipping",
          { plugin: manifest.name, entry },
        );
        continue;
      }

      // Deduplicate by resolved path
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      // Verify file exists; log warning and skip if missing (consistent with promptFragments)
      try {
        const stat = await Deno.stat(resolved);
        if (!stat.isFile) {
          log.warn("Plugin frontendStyles entry is not a file — skipping", {
            plugin: manifest.name,
            entry,
          });
          continue;
        }
        // Symlink-safe: verify real path is still within plugin directory
        const realFile = await Deno.realPath(resolved);
        const realPluginDir = await Deno.realPath(pluginDir);
        if (
          !realFile.startsWith(realPluginDir + SEPARATOR) &&
          realFile !== realPluginDir
        ) {
          log.warn(
            "Plugin frontendStyles entry resolves outside plugin directory — skipping",
            { plugin: manifest.name, entry },
          );
          continue;
        }
      } catch (err: unknown) {
        log.warn("Plugin frontendStyles entry not found", {
          plugin: manifest.name,
          entry,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      validated.push(normalized);
    }

    return validated;
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
    }
    const staged: StagedEntry[] = [];
    const stagedStages = new Set<HookStage>();

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
            priority?: number,
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
            staged.push({ stage, handler, priority: priority ?? 100 });
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

        // Strict declare-vs-register cross-check (only when the manifest
        // explicitly declares a hooks field — absent field = legacy / undeclared).
        if (Array.isArray(entry.manifest.hooks)) {
          const declaredBackend = new Set(
            entry.manifest.hooks
              .map((h) => h.stage)
              .filter((s) => STRICT_BACKEND_STAGES.has(s)),
          );
          const registeredBackend = new Set(
            [...stagedStages].filter((s) => STRICT_BACKEND_STAGES.has(s)),
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
            s.priority,
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
        error: err instanceof Error ? err.message : String(err),
      });
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
    const out: Array<{
      plugin: string;
      tags: string[];
      scope: "prompt+display" | "prompt" | "display";
    }> = [];
    for (const { manifest } of this.#plugins.values()) {
      const promptTags = Array.isArray(manifest.promptStripTags)
        ? manifest.promptStripTags.filter((t): t is string => typeof t === "string")
        : [];
      const displayTags = Array.isArray(manifest.displayStripTags)
        ? manifest.displayStripTags.filter((t): t is string => typeof t === "string")
        : [];
      if (promptTags.length === 0 && displayTags.length === 0) continue;

      const allTags = Array.from(new Set([...promptTags, ...displayTags]));
      const inBoth = promptTags.length > 0 && displayTags.length > 0;
      const scope: "prompt+display" | "prompt" | "display" = inBoth
        ? "prompt+display"
        : (promptTags.length > 0 ? "prompt" : "display");
      out.push({ plugin: manifest.name, tags: allTags, scope });
    }
    return out;
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
   * Compile a single tag entry (plain name or `/regex/flags`) into a regex
   * source fragment, or `null` when the entry is invalid. Shared by both
   * `getStripTagPatterns()` and `getCombinedStripTagPatterns()`.
   */
  #compileStripTagEntry(tag: unknown, pluginName: string): string | null {
    if (typeof tag !== "string" || tag.length === 0) return null;

    if (tag.startsWith("/")) {
      const lastSlash = tag.lastIndexOf("/");
      if (lastSlash <= 0) {
        log.warn("Plugin has invalid regex stripTag — skipping", {
          plugin: pluginName,
          tag,
        });
        return null;
      }
      const inner = tag.slice(1, lastSlash);
      if (inner.length === 0) {
        log.warn("Plugin has empty regex stripTag — skipping", {
          plugin: pluginName,
          tag,
        });
        return null;
      }
      try {
        new RegExp(inner);
        return inner;
      } catch (err: unknown) {
        log.warn("Plugin has invalid regex in stripTag — skipping", {
          plugin: pluginName,
          tag,
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    }

    return `<${escapeRegex(tag)}>[\\s\\S]*?</${escapeRegex(tag)}>`;
  }

  /**
   * Returns a combined regex matching all tags from plugins' promptStripTags arrays,
   * or null if no strip tags are registered.
   * Entries starting with "/" are treated as regex pattern strings.
   * Plain strings are auto-wrapped as <tag>[\s\S]*?</tag>.
   */
  getStripTagPatterns(): RegExp | null {
    const patterns: string[] = [];
    for (const { manifest } of this.#plugins.values()) {
      if (Array.isArray(manifest.promptStripTags)) {
        for (const tag of manifest.promptStripTags) {
          const compiled = this.#compileStripTagEntry(tag, manifest.name);
          if (compiled !== null) patterns.push(compiled);
        }
      }
    }

    if (patterns.length === 0) return null;

    return new RegExp(patterns.join("|"), "gi");
  }

  /**
   * Returns a combined regex matching tags from BOTH `promptStripTags` and
   * `displayStripTags` across all loaded plugins, or null if neither field
   * declares any entries. Deduplicates identical raw entries before compiling.
   * Intended for callers (e.g., story export) that want to produce content
   * fully stripped of all plugin-declared tags, matching what the frontend
   * actually displays.
   */
  getCombinedStripTagPatterns(): RegExp | null {
    const seen = new Set<string>();
    const patterns: string[] = [];

    for (const { manifest } of this.#plugins.values()) {
      const sources: readonly (readonly string[] | undefined)[] = [
        manifest.promptStripTags,
        manifest.displayStripTags,
      ];
      for (const source of sources) {
        if (!Array.isArray(source)) continue;
        for (const tag of source) {
          if (typeof tag !== "string") continue;
          const dedupKey = `${manifest.name}::${tag}`;
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          const compiled = this.#compileStripTagEntry(tag, manifest.name);
          if (compiled !== null) patterns.push(compiled);
        }
      }
    }

    if (patterns.length === 0) return null;

    return new RegExp(patterns.join("|"), "gi");
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
            error: err instanceof Error ? err.message : String(err),
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
    const result: Record<string, unknown> = {};

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
        log.warn("Plugin getDynamicVariables() failed", {
          plugin: pluginName,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return result;
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

  /**
   * Returns true if the plugin has a valid settingsSchema declared in its manifest.
   */
  hasSettingsSchema(name: string): boolean {
    const entry = this.#plugins.get(name);
    return !!entry?.manifest.settingsSchema;
  }

  /**
   * Returns the plugin's settingsSchema or null if none declared.
   */
  getPluginSettingsSchema(name: string): Record<string, unknown> | null {
    const entry = this.#plugins.get(name);
    return entry?.manifest.settingsSchema ?? null;
  }

  /**
   * Read plugin settings from `playground/_plugins/<name>/config.json`.
   * Returns merged result of schema defaults + saved values.
   */
  async getPluginSettings(name: string): Promise<Record<string, unknown>> {
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);

    // Extract defaults from settingsSchema
    const defaults = this.#extractSchemaDefaults(entry.manifest.settingsSchema);

    const configPath = join(
      this.#playgroundDir,
      "_plugins",
      name,
      "config.json",
    );
    let saved: Record<string, unknown> = {};
    try {
      const raw = await Deno.readTextFile(configPath);
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ) {
        saved = parsed as Record<string, unknown>;
      }
    } catch (err: unknown) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.warn("Failed to read plugin config", {
          plugin: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { ...defaults, ...saved };
  }

  /**
   * Save plugin settings to `playground/_plugins/<name>/config.json`.
   * Validates against settingsSchema before writing; throws on validation failure.
   */
  async savePluginSettings(
    name: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);

    // Validate against schema if declared
    if (entry.manifest.settingsSchema) {
      const errors = this.#validateAgainstSchema(
        settings,
        entry.manifest.settingsSchema,
      );
      if (errors.length > 0) {
        throw new Error(`Settings validation failed: ${errors.join("; ")}`);
      }
    }

    const configDir = join(this.#playgroundDir, "_plugins", name);
    await Deno.mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(settings, null, 2) + "\n",
    );
    log.debug("Plugin settings saved", { plugin: name });
  }

  /**
   * Extract default values from a JSON Schema's properties.
   */
  #extractSchemaDefaults(
    schema: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    if (!schema || typeof schema !== "object") return {};
    const properties = schema.properties;
    if (
      !properties || typeof properties !== "object" || Array.isArray(properties)
    ) return {};

    const defaults: Record<string, unknown> = {};
    for (
      const [key, prop] of Object.entries(properties as Record<string, unknown>)
    ) {
      if (prop && typeof prop === "object" && !Array.isArray(prop)) {
        const propObj = prop as Record<string, unknown>;
        if ("default" in propObj) {
          defaults[key] = propObj.default;
        }
      }
    }
    return defaults;
  }

  /**
   * Validate a settings payload against a JSON Schema (lightweight validation).
   * Checks required fields and basic type constraints.
   * Returns an array of error messages (empty = valid).
   */
  #validateAgainstSchema(
    settings: Record<string, unknown>,
    schema: Record<string, unknown>,
  ): string[] {
    const errors: string[] = [];
    const properties = schema.properties as
      | Record<string, Record<string, unknown>>
      | undefined;

    // Check required fields
    if (Array.isArray(schema.required)) {
      for (const field of schema.required) {
        if (typeof field === "string" && !(field in settings)) {
          errors.push(`Missing required field: ${field}`);
        }
      }
    }

    // Type-check each property that is present
    if (properties) {
      for (const [key, value] of Object.entries(settings)) {
        const propSchema = properties[key];
        if (!propSchema) continue; // additionalProperties not enforced

        const expectedType = propSchema.type;
        if (typeof expectedType !== "string") continue;

        const typeError = this.#checkType(key, value, expectedType);
        if (typeError) errors.push(typeError);
      }
    }

    return errors;
  }

  /**
   * Check a single value against an expected JSON Schema type.
   */
  #checkType(key: string, value: unknown, expectedType: string): string | null {
    switch (expectedType) {
      case "string":
        if (typeof value !== "string") return `Field '${key}' must be a string`;
        break;
      case "number":
      case "integer":
        if (typeof value !== "number") return `Field '${key}' must be a number`;
        if (expectedType === "integer" && !Number.isInteger(value)) {
          return `Field '${key}' must be an integer`;
        }
        break;
      case "boolean":
        if (typeof value !== "boolean") {
          return `Field '${key}' must be a boolean`;
        }
        break;
      case "array":
        if (!Array.isArray(value)) return `Field '${key}' must be an array`;
        break;
      case "object":
        if (
          typeof value !== "object" || value === null || Array.isArray(value)
        ) return `Field '${key}' must be an object`;
        break;
    }
    return null;
  }
}
