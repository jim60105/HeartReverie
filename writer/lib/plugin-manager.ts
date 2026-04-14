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
import type { PluginManifest } from "../types.ts";
import type { HookDispatcher } from "./hooks.ts";

interface PluginEntry {
  readonly manifest: PluginManifest;
  readonly dir: string;
  readonly source: string;
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

      this.#plugins.set(manifest.name, { manifest, dir: pluginDir, source });
    }
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
      } else {
        console.warn(
          `⚠️  Plugin '${name}' backend module has no register() or default export`
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

  /**
   * Returns the absolute path to a plugin's directory.
   * @param {string} name - Plugin name
   * @returns {string|null}
   */
  getPluginDir(name: string): string | null {
    const entry = this.#plugins.get(name);
    return entry ? entry.dir : null;
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
      { name: "status_data", type: "string", description: "Current status YAML content", source: "core" },
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
