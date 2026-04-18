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

import { join, resolve, isAbsolute, SEPARATOR } from "@std/path";
import type { PluginManifest, DynamicVariableContext } from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";

interface PluginEntry {
  readonly manifest: PluginManifest;
  readonly dir: string;
  readonly source: string;
  readonly validatedStyles: string[];
}

interface PromptVariables {
  readonly variables: Record<string, string>;
  readonly fragments: string[];
}

interface ParameterInfo {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly source: string;
}

function isValidPluginName(name: unknown): name is string {
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

export class PluginManager {
  #builtinDir: string;
  #externalDir: string | null;
  #hookDispatcher: HookDispatcher;
  #plugins: Map<string, PluginEntry> = new Map();
  #dynamicVarProviders: Map<string, (context: DynamicVariableContext) => Promise<Record<string, unknown>> | Record<string, unknown>> = new Map();

  /**
   * @param {string} builtinDir - Absolute path to built-in plugins (e.g. ROOT_DIR/plugins)
   * @param {string|undefined} externalDir - Optional absolute path to external plugins (PLUGIN_DIR env)
   * @param {import('./hooks.ts').HookDispatcher} hookDispatcher
   */
  constructor(builtinDir: string, externalDir: string | undefined, hookDispatcher: HookDispatcher) {
    this.#builtinDir = builtinDir;
    this.#externalDir = externalDir || null;
    this.#hookDispatcher = hookDispatcher;
  }

  /**
   * Scan plugin directories, parse manifests, load backend modules, register hooks.
   */
  async init(): Promise<void> {
    // Scan built-in plugins
    await this.#scanDir(this.#builtinDir, "built-in");

    // Scan external plugins (override built-in on name collision)
    if (this.#externalDir) {
      if (!isAbsolute(this.#externalDir)) {
        console.warn(
          `⚠️  PLUGIN_DIR must be an absolute path, got '${this.#externalDir}' — skipping external plugins`
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

    console.log(
      `✅ Loaded ${this.#plugins.size} plugin(s): ${[...this.#plugins.keys()].join(", ") || "(none)"}`
    );
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
      console.warn(`⚠️  Failed to read plugin directory '${dir}':`, err instanceof Error ? err.message : String(err));
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory || entry.name.startsWith(".")) continue;

      if (!isValidPluginName(entry.name)) {
        console.warn(
          `⚠️  Skipping plugin with invalid name '${entry.name}' in ${dir}`
        );
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
          console.warn(`⚠️  Invalid plugin manifest in ${manifestPath}: not an object`);
          continue;
        }
        manifest = parsed as PluginManifest;
      } catch (err: unknown) {
        console.warn(
          `⚠️  Invalid JSON in ${manifestPath}:`,
          err instanceof Error ? err.message : String(err)
        );
        continue;
      }

      // Validate required fields
      if (!manifest.name || typeof manifest.name !== "string") {
        console.warn(
          `⚠️  Plugin at ${pluginDir} missing required 'name' field — skipping`
        );
        continue;
      }

      // Require manifest name matches directory name to prevent impersonation
      if (manifest.name !== entry.name) {
        console.warn(
          `⚠️  Plugin '${entry.name}' manifest.name '${manifest.name}' does not match directory — skipping`
        );
        continue;
      }

      // Log override when external plugin replaces built-in
      if (this.#plugins.has(manifest.name)) {
        const existing = this.#plugins.get(manifest.name)!;
        console.warn(
          `⚠️  ${source} plugin '${manifest.name}' overrides existing plugin from ${existing.dir}`
        );
      }

      // Validate and normalize frontendStyles
      const validatedStyles = await this.#validateFrontendStyles(manifest, pluginDir);

      this.#plugins.set(manifest.name, { manifest, dir: pluginDir, source, validatedStyles });
    }
  }

  /**
   * Validate, normalize, and deduplicate a plugin's frontendStyles entries.
   * Returns an array of normalized relative paths (forward-slash, no leading "./")
   * whose resolved targets exist on disk and are contained within the plugin directory.
   */
  async #validateFrontendStyles(manifest: PluginManifest, pluginDir: string): Promise<string[]> {
    const raw: unknown = manifest.frontendStyles;
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      console.warn(
        `⚠️  Plugin '${manifest.name}' has non-array frontendStyles — ignoring`
      );
      return [];
    }

    const seen = new Set<string>();
    const validated: string[] = [];

    for (const entry of raw) {
      if (typeof entry !== "string" || entry.length === 0) {
        console.warn(
          `⚠️  Plugin '${manifest.name}' has invalid frontendStyles entry (must be non-empty string) — skipping`
        );
        continue;
      }
      if (!entry.toLowerCase().endsWith(".css")) {
        console.warn(
          `⚠️  Plugin '${manifest.name}' frontendStyles entry '${entry}' does not end with .css — skipping`
        );
        continue;
      }
      if (isAbsolute(entry)) {
        console.warn(
          `⚠️  Plugin '${manifest.name}' frontendStyles entry '${entry}' is an absolute path — skipping`
        );
        continue;
      }
      // Reject path traversal segments
      const segments = entry.split(/[\\/]/);
      if (segments.some((s) => s === "..")) {
        console.warn(
          `⚠️  Plugin '${manifest.name}' frontendStyles entry '${entry}' contains '..' — skipping`
        );
        continue;
      }
      // Reject backslashes and URL-hostile characters
      if (/[\\#?%]/.test(entry)) {
        console.warn(
          `⚠️  Plugin '${manifest.name}' frontendStyles entry '${entry}' contains invalid characters — skipping`
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
        console.warn(
          `⚠️  Plugin '${manifest.name}' frontendStyles entry '${entry}' escapes plugin directory — skipping`
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
          console.warn(
            `⚠️  Plugin '${manifest.name}' frontendStyles entry '${entry}' is not a file — skipping`
          );
          continue;
        }
        // Symlink-safe: verify real path is still within plugin directory
        const realFile = await Deno.realPath(resolved);
        const realPluginDir = await Deno.realPath(pluginDir);
        if (!realFile.startsWith(realPluginDir + SEPARATOR) && realFile !== realPluginDir) {
          console.warn(
            `⚠️  Plugin '${manifest.name}' frontendStyles entry '${entry}' resolves outside plugin directory — skipping`
          );
          continue;
        }
      } catch (err: unknown) {
        console.warn(
          `⚠️  Plugin '${manifest.name}' frontendStyles entry '${entry}' not found:`,
          err instanceof Error ? err.message : String(err)
        );
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
      entry.manifest.backendModule!
    );

    if (!isPathContained(entry.dir, modulePath)) {
      console.warn(
        `⚠️  Plugin '${name}' backendModule escapes plugin directory — skipping`
      );
      return;
    }

    try {
      const mod = await import("file://" + modulePath) as Record<string, unknown>;
      const registerFn = mod.register || mod.default;
      if (typeof registerFn === "function") {
        await (registerFn as (hd: HookDispatcher) => void | Promise<void>)(this.#hookDispatcher);
      }

      const hasDynVars = typeof mod.getDynamicVariables === "function";
      if (!registerFn && !hasDynVars) {
        console.warn(
          `⚠️  Plugin '${name}' backend module has no register() or default export`
        );
      }

      if (hasDynVars) {
        this.#dynamicVarProviders.set(
          name,
          mod.getDynamicVariables as (context: DynamicVariableContext) => Promise<Record<string, unknown>> | Record<string, unknown>,
        );
      }
    } catch (err: unknown) {
      console.error(
        `❌ Failed to load backend module for plugin '${name}':`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  /**
   * Returns array of all loaded plugin manifests.
   */
  getPlugins(): PluginManifest[] {
    return [...this.#plugins.values()].map((e) => e.manifest);
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
          if (typeof tag !== "string" || tag.length === 0) continue;

          if (tag.startsWith("/")) {
            // Regex pattern: extract inner pattern from /pattern/flags
            const lastSlash = tag.lastIndexOf("/");
            if (lastSlash <= 0) {
              console.warn(
                `⚠️  Plugin '${manifest.name}' has invalid regex promptStripTag '${tag}' — skipping`
              );
              continue;
            }
            const inner = tag.slice(1, lastSlash);
            if (inner.length === 0) {
              console.warn(
                `⚠️  Plugin '${manifest.name}' has empty regex promptStripTag '${tag}' — skipping`
              );
              continue;
            }
            try {
              new RegExp(inner); // validate
              patterns.push(inner);
            } catch (err: unknown) {
              console.warn(
                `⚠️  Plugin '${manifest.name}' has invalid regex promptStripTag '${tag}': ${err instanceof Error ? err.message : String(err)} — skipping`
              );
            }
          } else {
            // Plain tag name: auto-wrap
            patterns.push(`<${escapeRegex(tag)}>[\\s\\S]*?</${escapeRegex(tag)}>`);
          }
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

    const allFragments: Array<{ content: string; priority: number }> = [];

    for (const { manifest, dir } of this.#plugins.values()) {
      if (!Array.isArray(manifest.promptFragments)) continue;

      for (const frag of manifest.promptFragments) {
        if (!frag.file) continue;

        const filePath = resolve(dir, frag.file);

        if (!isPathContained(dir, filePath)) {
          console.warn(
            `⚠️  Plugin '${manifest.name}' fragment '${frag.file}' escapes plugin directory — skipping`
          );
          continue;
        }

        let content: string;
        try {
          content = await Deno.readTextFile(filePath);
        } catch (err: unknown) {
          console.warn(
            `⚠️  Failed to read prompt fragment '${frag.file}' for plugin '${manifest.name}':`,
            err instanceof Error ? err.message : String(err)
          );
          continue;
        }

        const priority = typeof frag.priority === "number" ? frag.priority : 100;

        if (frag.variable) {
          // Named variable — store directly
          variables[frag.variable] = content;
        } else {
          // Unnamed — add to generic fragments array
          allFragments.push({ content, priority });
        }
      }
    }

    // Sort generic fragments by priority and extract content
    allFragments.sort((a, b) => a.priority - b.priority);
    fragments.push(...allFragments.map((f) => f.content));

    return { variables, fragments };
  }

  /** Core template variable names that plugins must not override. */
  static readonly #CORE_TEMPLATE_VARS = new Set([
    "previous_context", "user_input", "isFirstRound",
    "series_name", "story_name", "plugin_fragments",
  ]);

  /**
   * Collect dynamic template variables from all plugins that export getDynamicVariables().
   * Collision policy: core vars are rejected; first-loaded plugin wins for inter-plugin conflicts.
   */
  async getDynamicVariables(context: DynamicVariableContext): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};

    for (const [pluginName, provider] of this.#dynamicVarProviders) {
      try {
        const vars = await provider(context);
        if (!vars || typeof vars !== "object") continue;

        for (const [key, value] of Object.entries(vars)) {
          if (PluginManager.#CORE_TEMPLATE_VARS.has(key)) {
            console.warn(`⚠️  Plugin '${pluginName}' attempted to set core variable '${key}' — ignored`);
            continue;
          }
          if (key in result) {
            console.warn(`⚠️  Plugin '${pluginName}' dynamic variable '${key}' conflicts with earlier plugin — using first value`);
            continue;
          }
          result[key] = value;
        }
      } catch (err: unknown) {
        console.warn(
          `⚠️  Plugin '${pluginName}' getDynamicVariables() failed:`,
          err instanceof Error ? err.message : String(err),
        );
      }
    }

    return result;
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
      { name: "previous_context", type: "array", description: "Array of previous chapter contents (stripped)", source: "core" },
      { name: "user_input", type: "string", description: "Current user message", source: "core" },
      { name: "isFirstRound", type: "boolean", description: "Whether this is the first round (no non-empty chapters)", source: "core" },
      { name: "series_name", type: "string", description: "Display name of the current series", source: "core" },
      { name: "story_name", type: "string", description: "Display name of the current story", source: "core" },
      { name: "plugin_fragments", type: "array", description: "Array of plugin-contributed prompt fragments", source: "core" },
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
              description: `Prompt fragment from ${manifest.name} (${frag.file})`,
              source: manifest.name,
            });
          }
        }
      }
    }

    return params;
  }
}
