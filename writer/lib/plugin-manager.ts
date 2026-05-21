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
import { dirname, isAbsolute, join, resolve, SEPARATOR } from "@std/path";
import { isPathContained } from "./path-safety.ts";
import { validateTemplate } from "./template.ts";
import {
  getHardcodedPathRoots,
  intersectXPathRoots,
  resolveDisplayRoots,
} from "./path-allowlist.ts";
import {
  type ValidationError,
  validate as validateSchema,
} from "./schema-validator.ts";
import type {
  ActionButtonDescriptor,
  ActionButtonVisibility,
  DynamicVariableContext,
  HandlerEventSubscriber,
  HookHandler,
  HookStage,
  PluginHookDeclaration,
  PluginManifest,
  PluginRegisterContext,
  RegisterOptions,
} from "../types.ts";
import { HookDispatcher, VALID_STAGES, PARALLEL_ALLOWED } from "./hooks.ts";
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

/**
 * Settings-schema audit metadata captured at load time.
 *  - `versionMismatch=true` means the manifest declared an unsupported
 *    `x-schema-version`; the plugin still loads but the settings API
 *    degrades to defaults (`GET`) and `409` (`PUT`).
 *  - `previousNames` is the union of `x-previous-names` entries → current
 *    property name. Used by GET to migrate legacy keys in-memory.
 *  - `writeOnlyPaths` is the set of dotted property paths (top-level only in
 *    phase 1, since `writeOnly` is documented at top-level schema properties)
 *    whose values SHALL be masked as `null` in the GET response.
 *  - `topLevelLegacy` toggles `x-legacy` relocation at PUT time.
 */
interface SettingsAudit {
  readonly versionMismatch: boolean;
  readonly previousNames: Map<string, string>;
  readonly writeOnlyKeys: Set<string>;
  readonly topLevelLegacy: boolean;
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

// Escape special regex characters in a string
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}


export class PluginManager {
  #builtinDir: string;
  #externalDir: string | null;
  #hookDispatcher: HookDispatcher;
  #playgroundDir: string;
  #plugins: Map<string, PluginEntry> = new Map();
  #settingsAudit: Map<string, SettingsAudit> = new Map();
  #schemaVersionWarned: Set<string> = new Set();
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
    this.#validateDependsOnDAG();
  }

  /**
   * Validate the dependsOn DAG for each PARALLEL_ALLOWED stage across all
   * loaded plugins. If a cycle or unknown plugin reference is detected for a
   * given stage, ALL dependsOn declarations for that stage are dropped and
   * an error is logged.
   */
  #validateDependsOnDAG(): void {
    // Collect hook declarations per stage across all plugins
    for (const stage of PARALLEL_ALLOWED) {
      const edges = new Map<string, string[]>(); // plugin → dependsOn[]
      const knownPlugins = new Set<string>();     // all plugins declaring this stage

      for (const [pluginName, entry] of this.#plugins) {
        if (!Array.isArray(entry.manifest.hooks)) continue;
        for (const h of entry.manifest.hooks) {
          const decl = h as Record<string, unknown>;
          if (decl.stage !== stage) continue;
          knownPlugins.add(pluginName);
          const deps = decl.dependsOn as string[] | undefined;
          if (deps?.length) {
            edges.set(pluginName, [...deps]);
          }
        }
      }

      if (edges.size === 0) continue;

      // Check for unknown plugin references
      let invalid = false;
      for (const [plugin, deps] of edges) {
        for (const dep of deps) {
          if (!knownPlugins.has(dep)) {
            log.error(
              "Plugin manifest: dependsOn references unknown plugin",
              { plugin, stage, unknownDep: dep },
            );
            invalid = true;
          }
        }
      }

      // Check for cycles using Kahn's algorithm (topological sort)
      if (!invalid) {
        const inDegree = new Map<string, number>();
        for (const node of knownPlugins) inDegree.set(node, 0);
        for (const [, deps] of edges) {
          for (const dep of deps) {
            if (inDegree.has(dep)) {
              inDegree.set(dep, (inDegree.get(dep) ?? 0) + 1);
            }
          }
        }
        // Wait — in dependsOn semantics, "A dependsOn B" means A must run
        // AFTER B, so the edge is B → A. For Kahn's, count in-degree of
        // each node where edges point TO the node.
        // Re-build: edge direction = dependsOn[i] → plugin (dep must finish first)
        const adj = new Map<string, string[]>();
        const deg = new Map<string, number>();
        for (const node of knownPlugins) {
          adj.set(node, []);
          deg.set(node, 0);
        }
        for (const [plugin, deps] of edges) {
          for (const dep of deps) {
            if (adj.has(dep)) {
              adj.get(dep)!.push(plugin);
              deg.set(plugin, (deg.get(plugin) ?? 0) + 1);
            }
          }
        }

        const queue: string[] = [];
        for (const [node, d] of deg) {
          if (d === 0) queue.push(node);
        }
        let processed = 0;
        while (queue.length > 0) {
          const node = queue.shift()!;
          processed++;
          for (const neighbor of adj.get(node) ?? []) {
            const newDeg = (deg.get(neighbor) ?? 1) - 1;
            deg.set(neighbor, newDeg);
            if (newDeg === 0) queue.push(neighbor);
          }
        }

        if (processed < knownPlugins.size) {
          const cyclePlugins = [...deg.entries()]
            .filter(([, d]) => d > 0)
            .map(([n]) => n);
          log.error(
            "Plugin manifest: dependsOn cycle detected",
            { stage, involvedPlugins: cyclePlugins },
          );
          invalid = true;
        }
      }

      // Drop ALL dependsOn for this stage if invalid
      if (invalid) {
        for (const [, entry] of this.#plugins) {
          if (!Array.isArray(entry.manifest.hooks)) continue;
          for (const h of entry.manifest.hooks) {
            const decl = h as Record<string, unknown>;
            if (decl.stage === stage) {
              decl.dependsOn = undefined;
            }
          }
        }
        log.warn(
          "Plugin manifest: all dependsOn for stage dropped due to invalid DAG",
          { stage },
        );
      }
    }
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
      const validatedStyles = await this.#validateFrontendStyles(
        manifest,
        pluginDir,
      );

      // Validate and normalize actionButtons
      const validatedActionButtons = this.#validateActionButtons(manifest);

      // Validate settingsSchema if present (task 1.1)
      if (manifest.settingsSchema !== undefined) {
        const audit = this.#auditSettingsSchema(manifest);
        if (audit === null) {
          // Audit rejected schema — strip it.
          (manifest as { settingsSchema?: unknown }).settingsSchema = undefined;
        } else {
          this.#settingsAudit.set(manifest.name, audit);
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
   * - `note` longer than 200 chars is rejected
   * - non-string entries in `reads` / `writes` are rejected
   * - `parallel`, `readOnly` must be booleans when present
   * - `concurrency` must be a positive integer when present
   * - `dependsOn` must be a string[] when present
   *
   * After schema validation, coercion / guard rules are applied:
   * - parallel:true on non-PARALLEL_ALLOWED stage → coerced to false
   * - parallel:true without readOnly:true → coerced to false (error for
   *   response-stream)
   * - readOnly:true without parallel → auto-promoted to parallel:true
   *   (only for PARALLEL_ALLOWED stages)
   * - parallel:true with priority < 100 → warn (parallel runs after serial)
   * - invalid concurrency → coerced to undefined
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

      // Validate new parallel-dispatch fields (type checks)
      if (decl.parallel !== undefined && typeof decl.parallel !== "boolean") {
        pluginLog.error(
          "Plugin manifest 'hooks' entry 'parallel' must be a boolean — skipping plugin",
          { stage: decl.stage },
        );
        return false;
      }
      if (decl.readOnly !== undefined && typeof decl.readOnly !== "boolean") {
        pluginLog.error(
          "Plugin manifest 'hooks' entry 'readOnly' must be a boolean — skipping plugin",
          { stage: decl.stage },
        );
        return false;
      }
      if (decl.concurrency !== undefined && typeof decl.concurrency !== "number") {
        pluginLog.error(
          "Plugin manifest 'hooks' entry 'concurrency' must be a number — skipping plugin",
          { stage: decl.stage },
        );
        return false;
      }
      if (decl.dependsOn !== undefined) {
        if (!Array.isArray(decl.dependsOn) || decl.dependsOn.some((x) => typeof x !== "string")) {
          pluginLog.error(
            "Plugin manifest 'hooks' entry 'dependsOn' must be a string[] — skipping plugin",
            { stage: decl.stage },
          );
          return false;
        }
      }
    }

    // Use a mutable alias so we can reassign properties during coercion.
    const mutableHooks = manifest.hooks as unknown as Array<Record<string, unknown>>;

    // Coercion / guard rules (2.2–2.7)
    for (const raw of mutableHooks) {
      const stage = raw.stage as string;

      // 2.2 Stage allowlist guard (redundant with filter above but kept as runtime guard)
      if (raw.parallel === true && !PARALLEL_ALLOWED.has(stage)) {
        pluginLog.warn(
          "Plugin manifest: parallel:true is only allowed for stages in PARALLEL_ALLOWED",
          { stage },
        );
        raw.parallel = false;
      }

      // 2.3 / 2.4 readOnly requirement for parallel dispatch
      if (raw.parallel === true && raw.readOnly !== true) {
        if (stage === "response-stream") {
          // 2.4 response-stream: REJECT (not coerce)
          pluginLog.error(
            "Plugin manifest: response-stream + parallel:true requires readOnly:true",
            { stage },
          );
          raw.parallel = false;
        } else {
          // 2.3 Other stages: coerce
          pluginLog.warn(
            "Plugin manifest: parallel:true requires readOnly:true — coercing parallel to false",
            { stage },
          );
          raw.parallel = false;
        }
      }

      // 2.5 Track B auto-promotion: readOnly:true without explicit parallel → parallel:true
      // Only applies to PARALLEL_ALLOWED stages; non-eligible stages ignore this.
      if (raw.readOnly === true && raw.parallel === undefined && PARALLEL_ALLOWED.has(stage)) {
        raw.parallel = true;
        pluginLog.debug(
          "Plugin manifest: Track B auto-promotion readOnly:true → parallel:true",
          { stage },
        );
      }

      // 2.6 Priority warning for parallel handlers
      if (raw.parallel === true && typeof raw.priority === "number" && (raw.priority as number) < 100) {
        pluginLog.warn(
          "Plugin manifest: parallel handlers run after all serial handlers regardless of priority",
          { stage, priority: raw.priority },
        );
      }

      // 2.7 Concurrency coercion
      if (raw.concurrency !== undefined) {
        if (!Number.isInteger(raw.concurrency) || (raw.concurrency as number) < 1) {
          pluginLog.warn(
            "Plugin manifest: invalid concurrency value, coercing to undefined",
            { stage, rejectedValue: raw.concurrency },
          );
          raw.concurrency = undefined;
        }
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
          error: errorMessage(err),
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
          error: errorMessage(err),
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
   * Returns merged result of schema defaults + saved values, with
   * `x-previous-names` rename migration applied IN-MEMORY (the on-disk file
   * is not touched here). Used both by internal plugin code (via
   * `getSettings`) and as the basis of the HTTP GET response.
   *
   * NOTE: This method does NOT apply `writeOnly` masking. For HTTP response
   * shaping (mask + legacy warnings) use `getPluginSettingsForResponse`.
   */
  async getPluginSettings(name: string): Promise<Record<string, unknown>> {
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);

    const schema = entry.manifest.settingsSchema as
      | Record<string, unknown>
      | undefined;
    const audit = this.#settingsAudit.get(name);

    // If schema version mismatched, return schema defaults only.
    if (audit?.versionMismatch) {
      return this.#extractSchemaDefaults(schema);
    }

    const defaults = this.#extractSchemaDefaults(schema);

    const saved = await this.#readDiskConfig(name);
    // Strip x-legacy from the in-memory view immediately — it must never
    // leak past this method.
    delete (saved as Record<string, unknown>)["x-legacy"];

    const renamed = this.#applyPreviousNamesMigration(saved, audit);

    return { ...defaults, ...renamed };
  }

  /**
   * GET-response shape: applies `x-previous-names` rename, masks `writeOnly`
   * fields with `null`, and computes `x-legacy-warnings` by validating the
   * in-memory (post-rename) value against the schema.
   *
   * Never modifies the on-disk file.
   */
  async getPluginSettingsForResponse(
    name: string,
  ): Promise<{
    settings: Record<string, unknown>;
    legacyWarnings: ValidationError[];
    schemaVersionMismatch: boolean;
  }> {
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);
    const audit = this.#settingsAudit.get(name);
    const schema = entry.manifest.settingsSchema as
      | Record<string, unknown>
      | undefined;

    if (audit?.versionMismatch) {
      return {
        settings: this.#extractSchemaDefaults(schema),
        legacyWarnings: [],
        schemaVersionMismatch: true,
      };
    }

    const merged = await this.getPluginSettings(name);

    // Validate the post-rename payload to produce legacy warnings.
    let legacyWarnings: ValidationError[] = [];
    if (schema) {
      const roots = this.#getEffectivePathRootsForPlugin(name);
      const opts = roots
        ? {
          projectRoot: this.#projectRoot(),
          hardcodedPathRoots: roots.display,
          absolutePathRoots: roots.absolute,
        }
        : {};
      const { errors } = await validateSchema(schema, merged, opts);
      legacyWarnings = errors;
    }

    // Apply writeOnly masking AFTER validation.
    if (audit) {
      for (const k of audit.writeOnlyKeys) {
        if (k in merged) merged[k] = null;
      }
    }

    return { settings: merged, legacyWarnings, schemaVersionMismatch: false };
  }

  /**
   * Save plugin settings to `playground/_plugins/<name>/config.json` after
   * running two-phase validation.
   *
   * The legacy substring contract (`"Settings validation failed: ..."`) is
   * preserved on `throw` so existing call sites that catch by substring keep
   * working until they migrate to the new structured envelope.
   */
  async savePluginSettings(
    name: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.validateAndPreparePluginSettings(name, settings);
    if (result.errors.length > 0) {
      throw new Error(
        "Settings validation failed: " +
          result.errors.map((e) => `${e.path} ${e.keyword}`).join("; "),
      );
    }
    await this.commitPluginSettings(name, result.finalSettings);
  }

  /**
   * Two-phase validation + writeOnly short-circuit. Does not write to disk.
   * Returns a structured envelope:
   *   - `errors`: blocking errors (path ⊆ blocking scope)
   *   - `warnings`: non-blocking errors (path outside scope)
   *   - `finalSettings`: the value that SHOULD be passed to
   *     `commitPluginSettings` if `errors.length === 0`. Has `_changedPaths`
   *     stripped and `writeOnly` null short-circuits resolved.
   *   - `changedPaths`: the union scope used to classify blocking vs warning.
   *   - `durationMs`: validator wall-clock duration (for audit logging).
   *   - `malformedChangedPaths`: true when caller-supplied `_changedPaths`
   *     was non-array; the only error returned is the malformed marker.
   *   - `schemaVersionMismatch`: true when this plugin's schema version is
   *     unsupported; routes SHALL respond `409` in that case.
   */
  async validateAndPreparePluginSettings(
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
    const start = performance.now();
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);
    const audit = this.#settingsAudit.get(name);
    const schema = entry.manifest.settingsSchema as
      | Record<string, unknown>
      | undefined;

    if (audit?.versionMismatch) {
      return {
        errors: [{
          path: "",
          keyword: "schema_version_mismatch",
          messageKey: "schema_version_mismatch",
          params: { plugin: name },
        }],
        warnings: [],
        finalSettings: {},
        changedPaths: [],
        durationMs: performance.now() - start,
        malformedChangedPaths: false,
        schemaVersionMismatch: true,
      };
    }

    // Extract + validate caller-supplied _changedPaths.
    const rawChanged = (body as Record<string, unknown>)["_changedPaths"];
    let providedChangedPaths: string[] | null = null;
    let malformed = false;
    if (rawChanged !== undefined) {
      if (
        !Array.isArray(rawChanged) ||
        !rawChanged.every((s) => typeof s === "string")
      ) {
        malformed = true;
      } else {
        providedChangedPaths = rawChanged.slice();
      }
    }

    if (malformed) {
      return {
        errors: [{
          path: "_changedPaths",
          keyword: "type",
          messageKey: "type",
          params: { expected: "array<string>" },
        }],
        warnings: [],
        finalSettings: {},
        changedPaths: [],
        durationMs: performance.now() - start,
        malformedChangedPaths: true,
        schemaVersionMismatch: false,
      };
    }

    // Strip _changedPaths from the body that will be persisted.
    const stripped: Record<string, unknown> = { ...body };
    delete stripped["_changedPaths"];

    // Resolve writeOnly short-circuits BEFORE validation. `null` ⇒ keep
    // existing; `""` ⇒ clear; other ⇒ set+validate. Existing value may live
    // under the current key OR an `x-previous-names` entry.
    const onDisk = await this.#readDiskConfig(name);
    const diskNoLegacy: Record<string, unknown> = { ...onDisk };
    const xLegacyExisting = diskNoLegacy["x-legacy"];
    delete diskNoLegacy["x-legacy"];

    if (audit) {
      for (const k of audit.writeOnlyKeys) {
        if (!(k in stripped)) continue;
        const v = stripped[k];
        if (v === null) {
          // Keep existing: look at the current key first, then any
          // x-previous-names alias.
          if (k in diskNoLegacy) {
            stripped[k] = diskNoLegacy[k];
          } else {
            // find a previous-name alias that maps to k
            for (const [prev, current] of audit.previousNames.entries()) {
              if (current === k && prev in diskNoLegacy) {
                stripped[k] = diskNoLegacy[prev];
                break;
              }
            }
            if (stripped[k] === null) {
              // Nothing on disk to keep — treat as "absent" by removing.
              delete stripped[k];
            }
          }
        } else if (v === "") {
          // Explicit clear: remove key from saved settings.
          delete stripped[k];
        }
      }
    }

    // Compute the diff between stripped body and on-disk (post-rename for
    // disk side, so we don't mark renames as diffs).
    const diskPostRename = this.#applyPreviousNamesMigration(diskNoLegacy, audit);
    let actualDiffPaths = computeDeepDiff(diskPostRename, stripped);

    // Spec: a field whose x-show-when evaluates false on the submitted body
    // is hidden in the UI; pre-existing or transiently-invalid values at
    // hidden paths must NOT be blocking (see conditional-field-visibility
    // spec L61). The frontend strips these from _changedPaths, but the
    // server's independent diff would otherwise re-enter the blocking
    // scope. Exclude hidden paths from the diff contribution.
    if (schema) {
      const hidden = computeHiddenPaths(schema, stripped);
      if (hidden.length > 0) {
        actualDiffPaths = excludeHiddenFromDiff(actualDiffPaths, hidden);
      }
    }

    const scope = unionPaths(providedChangedPaths ?? [], actualDiffPaths);

    // Run validation.
    let allErrors: ValidationError[] = [];
    if (schema) {
      const roots = this.#getEffectivePathRootsForPlugin(name);
      const opts = roots
        ? {
          projectRoot: this.#projectRoot(),
          hardcodedPathRoots: roots.display,
          absolutePathRoots: roots.absolute,
        }
        : {};
      const { errors } = await validateSchema(schema, stripped, opts);
      allErrors = errors;
    }

    const blocking: ValidationError[] = [];
    const warnings: ValidationError[] = [];
    for (const e of allErrors) {
      if (isPathInScope(e.path, scope)) blocking.push(e);
      else warnings.push(e);
    }

    // If we are about to succeed, build finalSettings including the
    // x-legacy namespace handling.
    let finalSettings = stripped;
    if (blocking.length === 0) {
      finalSettings = this.#mergeXLegacy(
        name,
        stripped,
        diskNoLegacy,
        xLegacyExisting,
      );
    }

    return {
      errors: blocking,
      warnings,
      finalSettings,
      changedPaths: scope,
      durationMs: performance.now() - start,
      malformedChangedPaths: false,
      schemaVersionMismatch: false,
    };
  }

  /**
   * Persist a validated settings object to disk. Caller is responsible for
   * having invoked `validateAndPreparePluginSettings` first.
   */
  async commitPluginSettings(
    name: string,
    finalSettings: Record<string, unknown>,
  ): Promise<void> {
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);

    const configDir = join(this.#playgroundDir, "_plugins", name);
    await Deno.mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(finalSettings, null, 2) + "\n",
    );
    log.debug("Plugin settings saved", { plugin: name });
  }

  /**
   * Returns the effective display + absolute path-root lists for a plugin
   * (used for `format: "path"` validation and the `schema-meta` endpoint).
   * Returns `null` for plugins without a `settingsSchema`.
   */
  getEffectivePathRoots(
    name: string,
  ): { display: string[]; absolute: string[] } | null {
    return this.#getEffectivePathRootsForPlugin(name);
  }

  /**
   * Returns the schema version (always `1` after auto-migration), `null` if
   * the plugin has no settingsSchema, or a special sentinel `-1` when the
   * version is mismatched (routes SHALL respond 409 in that case).
   */
  getSchemaVersion(name: string): number | null {
    const entry = this.#plugins.get(name);
    if (!entry?.manifest.settingsSchema) return null;
    const audit = this.#settingsAudit.get(name);
    if (audit?.versionMismatch) return -1;
    return 1;
  }

  /** Returns true if the plugin's `x-schema-version` is unsupported. */
  isSchemaVersionMismatch(name: string): boolean {
    return this.#settingsAudit.get(name)?.versionMismatch === true;
  }

  /** Returns the project root used for `format: "path"` resolution. */
  #projectRoot(): string {
    return dirname(this.#playgroundDir);
  }

  #getEffectivePathRootsForPlugin(
    name: string,
  ): { display: string[]; absolute: string[] } | null {
    const entry = this.#plugins.get(name);
    if (!entry?.manifest.settingsSchema) return null;
    const display = getHardcodedPathRoots(name);
    const absolute = resolveDisplayRoots(display, this.#projectRoot());
    return { display, absolute };
  }

  async #readDiskConfig(name: string): Promise<Record<string, unknown>> {
    const configPath = join(
      this.#playgroundDir,
      "_plugins",
      name,
      "config.json",
    );
    try {
      const raw = await Deno.readTextFile(configPath);
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch (err: unknown) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.warn("Failed to read plugin config", {
          plugin: name,
          error: errorMessage(err),
        });
      }
    }
    return {};
  }

  /**
   * Apply `x-previous-names`: for each (prev → current) mapping, if `prev`
   * exists in `raw` AND `current` does NOT, copy the value over to `current`
   * and drop `prev`. Returns a shallow-cloned object.
   */
  #applyPreviousNamesMigration(
    raw: Record<string, unknown>,
    audit: SettingsAudit | undefined,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...raw };
    if (!audit) return out;
    for (const [prev, current] of audit.previousNames.entries()) {
      if (prev in out && !(current in out)) {
        out[current] = out[prev];
      }
      // Drop the legacy key from the in-memory view regardless: GET response
      // SHALL NOT echo the legacy key.
      delete out[prev];
    }
    return out;
  }

  /**
   * Merge orphan keys into the on-disk `x-legacy` namespace if the schema
   * opted into legacy preservation. Orphans = keys present in the prior
   * on-disk config that are NOT in `stripped` and NOT in the schema's
   * declared properties NOR an `x-previous-names` source.
   */
  #mergeXLegacy(
    name: string,
    stripped: Record<string, unknown>,
    priorDisk: Record<string, unknown>,
    priorXLegacy: unknown,
  ): Record<string, unknown> {
    const entry = this.#plugins.get(name)!;
    const audit = this.#settingsAudit.get(name);
    const schema = entry.manifest.settingsSchema as
      | Record<string, unknown>
      | undefined;
    if (!schema || !audit?.topLevelLegacy) return stripped;

    const props = schema.properties as Record<string, unknown> | undefined;
    const known = new Set(props ? Object.keys(props) : []);
    const previousNamesSources = new Set(audit.previousNames.keys());

    const carriedXLegacy: Record<string, unknown> =
      priorXLegacy && typeof priorXLegacy === "object" &&
        !Array.isArray(priorXLegacy)
        ? { ...(priorXLegacy as Record<string, unknown>) }
        : {};

    for (const [k, v] of Object.entries(priorDisk)) {
      if (k === "x-legacy") continue;
      if (known.has(k)) continue;
      if (previousNamesSources.has(k)) continue;
      if (k in stripped) continue;
      carriedXLegacy[k] = v;
    }

    if (Object.keys(carriedXLegacy).length === 0) return stripped;
    return { ...stripped, "x-legacy": carriedXLegacy };
  }

  /**
   * Audit a manifest's `settingsSchema` at load time. Returns:
   *   - `null` if the schema is structurally invalid and SHALL be stripped.
   *   - `SettingsAudit` otherwise (with `versionMismatch` set when
   *     `x-schema-version` is declared but != 1).
   */
  #auditSettingsSchema(manifest: PluginManifest): SettingsAudit | null {
    const pluginName = manifest.name;
    const schema = manifest.settingsSchema;
    if (
      typeof schema !== "object" || schema === null || Array.isArray(schema)
    ) {
      log.warn("Plugin settingsSchema must be an object — ignoring", {
        plugin: pluginName,
      });
      return null;
    }
    if (
      schema.type !== "object" || typeof schema.properties !== "object" ||
      schema.properties === null || Array.isArray(schema.properties)
    ) {
      log.warn(
        "Plugin settingsSchema must have type:'object' and a properties record — ignoring",
        { plugin: pluginName },
      );
      return null;
    }

    // x-schema-version
    let versionMismatch = false;
    const rawVer = (schema as Record<string, unknown>)["x-schema-version"];
    if (rawVer === undefined) {
      if (!this.#schemaVersionWarned.has(pluginName)) {
        this.#schemaVersionWarned.add(pluginName);
        log.warn(
          "Plugin settingsSchema missing x-schema-version — auto-migrating to 1",
          { plugin: pluginName },
        );
      }
    } else if (rawVer !== 1) {
      versionMismatch = true;
      log.warn(
        "Plugin settingsSchema declares unsupported x-schema-version — settings degraded",
        { plugin: pluginName, declared: rawVer },
      );
    }

    // Walk schema; collect per-property metadata, reject on hard rules.
    const previousNames = new Map<string, string>();
    const previousNamesSeen = new Map<string, string>(); // string → owning property
    const writeOnlyKeys = new Set<string>();
    const topLevelLegacy =
      (schema as Record<string, unknown>)["x-legacy"] === true;

    const failures: string[] = [];

    const walkObject = (
      objSchema: Record<string, unknown>,
      path: string,
      isTopLevel: boolean,
    ): void => {
      const props = objSchema.properties as Record<string, unknown> | undefined;
      if (!props) return;
      const requiredArr = Array.isArray(objSchema.required)
        ? objSchema.required.filter((s): s is string => typeof s === "string")
        : [];
      const requiredSet = new Set(requiredArr);

      const siblingNames = new Set(Object.keys(props));

      for (const [pname, raw] of Object.entries(props)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const prop = raw as Record<string, unknown>;
        const pPath = path ? `${path}.${pname}` : pname;

        // Reserved top-level property names (would leak the internal
        // legacy namespace via GET defaults if allowed).
        if (
          isTopLevel &&
          (pname === "x-legacy" || pname === "x-legacy-warnings" ||
            pname === "_changedPaths")
        ) {
          failures.push(
            `${pPath}: property name is reserved by HeartReverie`,
          );
        }

        // x-show-when
        const sw = prop["x-show-when"];
        if (sw !== undefined) {
          if (typeof sw !== "object" || sw === null || Array.isArray(sw)) {
            failures.push(`${pPath}: x-show-when must be an object`);
          } else {
            const swObj = sw as Record<string, unknown>;
            const field = swObj.field;
            if (typeof field !== "string") {
              failures.push(`${pPath}: x-show-when.field must be a string`);
            } else if (!siblingNames.has(field)) {
              failures.push(
                `${pPath}: x-show-when.field '${field}' is not a sibling property`,
              );
            }
            const ops = ["equals", "notEquals", "in"].filter((k) => k in swObj);
            if (ops.length !== 1) {
              failures.push(
                `${pPath}: x-show-when must declare exactly one of equals/notEquals/in (found: ${ops.length})`,
              );
            }
            if (requiredSet.has(pname)) {
              failures.push(
                `${pPath}: declared in 'required' AND uses x-show-when (dead config)`,
              );
            }
          }
        }

        // x-previous-names
        const xpn = prop["x-previous-names"];
        if (xpn !== undefined) {
          if (
            !Array.isArray(xpn) ||
            !xpn.every((s) => typeof s === "string")
          ) {
            failures.push(
              `${pPath}: x-previous-names must be an array of strings`,
            );
          } else {
            for (const prev of xpn as string[]) {
              if (prev === pname) {
                failures.push(
                  `${pPath}: x-previous-names cannot include the property's own current name`,
                );
              }
              if (isTopLevel) {
                const owner = previousNamesSeen.get(prev);
                if (owner && owner !== pname) {
                  failures.push(
                    `x-previous-names string '${prev}' is declared by both ${owner} and ${pname}`,
                  );
                } else {
                  previousNamesSeen.set(prev, pname);
                  previousNames.set(prev, pname);
                }
              }
            }
          }
        }

        // x-path-roots
        const xpr = prop["x-path-roots"];
        if (xpr !== undefined) {
          if (
            !Array.isArray(xpr) ||
            !xpr.every((s) => typeof s === "string")
          ) {
            failures.push(
              `${pPath}: x-path-roots must be an array of strings`,
            );
          } else {
            const hardcoded = getHardcodedPathRoots(pluginName);
            const isect = intersectXPathRoots(hardcoded, xpr as string[]);
            if (isect.length === 0) {
              failures.push(
                `${pPath}: x-path-roots has empty intersection with the hard-coded allowlist`,
              );
            }
          }
        }

        // writeOnly (top-level only in phase 1)
        if (isTopLevel && prop.writeOnly === true) {
          writeOnlyKeys.add(pname);
        }

        // Recurse into nested object schemas.
        if (
          prop.type === "object" && prop.properties &&
          typeof prop.properties === "object" && !Array.isArray(prop.properties)
        ) {
          walkObject(prop, pPath, false);
        }
        // Recurse into array items if object-shaped.
        if (
          prop.type === "array" && prop.items &&
          typeof prop.items === "object" && !Array.isArray(prop.items) &&
          (prop.items as Record<string, unknown>).type === "object"
        ) {
          walkObject(prop.items as Record<string, unknown>, `${pPath}[]`, false);
        }
      }
    };

    walkObject(schema as Record<string, unknown>, "", true);

    if (failures.length > 0) {
      log.warn("Plugin settingsSchema rejected — load-time audit failed", {
        plugin: pluginName,
        failures,
      });
      return null;
    }

    return { versionMismatch, previousNames, writeOnlyKeys, topLevelLegacy };
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
}

// ── Module-private path/diff helpers (kept outside the class to be testable
// in isolation, and to avoid leaking onto the public surface) ───────────

/**
 * Compute a deep diff between two JSON-shaped values and return the list of
 * JSON-Pointer-ish paths at which they differ. Paths use `.` for object key
 * descent and `[i]` for array index descent (e.g. `items[0].name`).
 *
 * Strategy: emit the deepest diverging path. When two arrays differ in
 * length, the parent path is emitted; otherwise per-index diffs. When a key
 * is present in only one side, the path of that key is emitted.
 */
export function computeDeepDiff(
  a: unknown,
  b: unknown,
  prefix: string = "",
): string[] {
  if (Object.is(a, b)) return [];
  const out: string[] = [];

  const isObj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);

  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const childPath = prefix ? `${prefix}.${k}` : k;
      if (!(k in a) || !(k in b)) {
        out.push(childPath);
        continue;
      }
      out.push(...computeDeepDiff(a[k], b[k], childPath));
    }
    return out;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(prefix || "[]");
      return out;
    }
    for (let i = 0; i < a.length; i++) {
      out.push(...computeDeepDiff(a[i], b[i], `${prefix}[${i}]`));
    }
    return out;
  }

  // Primitive or type mismatch.
  if (!deepValueEqual(a, b)) {
    out.push(prefix || "");
  }
  return out;
}

function deepValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepValueEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    if (ak.length !== Object.keys(bo).length) return false;
    for (const k of ak) {
      if (!(k in bo)) return false;
      if (!deepValueEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

export function unionPaths(a: string[], b: string[]): string[] {
  const set = new Set<string>([...a, ...b]);
  return [...set];
}

/**
 * Walk an object schema and collect property paths whose `x-show-when`
 * evaluates `false` against the supplied value. Only top-level + nested
 * object-property paths are inspected (mirrors the frontend semantics).
 * Returns paths in dotted form (e.g. `details`, `nested.detail`).
 */
export function computeHiddenPaths(
  schema: unknown,
  value: unknown,
  prefix = "",
): string[] {
  if (
    !schema || typeof schema !== "object" || Array.isArray(schema) ||
    !value || typeof value !== "object" || Array.isArray(value)
  ) {
    return [];
  }
  const sch = schema as Record<string, unknown>;
  if (sch["type"] !== "object") return [];
  const props = sch["properties"];
  if (!props || typeof props !== "object") return [];
  const obj = value as Record<string, unknown>;
  const out: string[] = [];
  for (const [key, propSchema] of Object.entries(props as Record<string, unknown>)) {
    if (!propSchema || typeof propSchema !== "object") continue;
    const p = propSchema as Record<string, unknown>;
    const path = prefix ? `${prefix}.${key}` : key;
    const sw = p["x-show-when"];
    if (sw && typeof sw === "object" && !Array.isArray(sw)) {
      const cond = sw as Record<string, unknown>;
      const field = cond["field"];
      if (typeof field === "string") {
        const sibling = obj[field];
        let visible = true;
        if ("equals" in cond) visible = deepValueEqual(sibling, cond["equals"]);
        else if ("notEquals" in cond) {
          visible = !deepValueEqual(sibling, cond["notEquals"]);
        } else if ("in" in cond && Array.isArray(cond["in"])) {
          visible = (cond["in"] as unknown[]).some((v) =>
            deepValueEqual(sibling, v)
          );
        }
        if (!visible) {
          out.push(path);
          continue;
        }
      }
    }
    // Recurse into nested object schemas.
    if (p["type"] === "object" && key in obj) {
      out.push(...computeHiddenPaths(p, obj[key], path));
    }
  }
  return out;
}

/**
 * Filter out paths that are at or under any of the `hidden` paths.
 */
export function excludeHiddenFromDiff(
  diffPaths: string[],
  hidden: readonly string[],
): string[] {
  if (hidden.length === 0) return diffPaths;
  return diffPaths.filter((p) => !isPathInScope(p, hidden));
}

/**
 * Returns `true` when `errPath` is at or under any of the `scope` paths.
 * "Under" means: `errPath === scope` OR `errPath` starts with `scope` followed
 * by `.` or `[`.
 */
export function isPathInScope(errPath: string, scope: readonly string[]): boolean {
  for (const s of scope) {
    if (errPath === s) return true;
    if (
      errPath.length > s.length && errPath.startsWith(s) &&
      (errPath[s.length] === "." || errPath[s.length] === "[")
    ) return true;
  }
  return false;
}
