// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import fs from "node:fs/promises";
import path from "node:path";

// Reject names containing path traversal or null bytes
function isValidPluginName(name) {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    !/\.\.|\x00|[/\\]/.test(name)
  );
}

// Verify resolved path stays within a base directory
function isPathContained(base, resolved) {
  return resolved === base || resolved.startsWith(base + path.sep);
}

// Escape special regex characters in a string
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class PluginManager {
  #builtinDir;
  #externalDir;
  #hookDispatcher;
  #plugins = new Map(); // name -> { manifest, dir }

  /**
   * @param {string} builtinDir - Absolute path to built-in plugins (e.g. ROOT_DIR/plugins)
   * @param {string|undefined} externalDir - Optional absolute path to external plugins (PLUGIN_DIR env)
   * @param {import('./hooks.js').HookDispatcher} hookDispatcher
   */
  constructor(builtinDir, externalDir, hookDispatcher) {
    this.#builtinDir = builtinDir;
    this.#externalDir = externalDir || null;
    this.#hookDispatcher = hookDispatcher;
  }

  /**
   * Scan plugin directories, parse manifests, load backend modules, register hooks.
   */
  async init() {
    // Scan built-in plugins
    await this.#scanDir(this.#builtinDir, "built-in");

    // Scan external plugins (override built-in on name collision)
    if (this.#externalDir) {
      if (!path.isAbsolute(this.#externalDir)) {
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
  async #scanDir(dir, source) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") {
        // Directory doesn't exist yet — that's fine
        return;
      }
      console.warn(`⚠️  Failed to read plugin directory '${dir}':`, err.message);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

      if (!isValidPluginName(entry.name)) {
        console.warn(
          `⚠️  Skipping plugin with invalid name '${entry.name}' in ${dir}`
        );
        continue;
      }

      const pluginDir = path.join(dir, entry.name);
      const manifestPath = path.join(pluginDir, "plugin.json");

      let raw;
      try {
        raw = await fs.readFile(manifestPath, "utf-8");
      } catch {
        // No plugin.json — skip silently
        continue;
      }

      let manifest;
      try {
        manifest = JSON.parse(raw);
      } catch (err) {
        console.warn(
          `⚠️  Invalid JSON in ${manifestPath}:`,
          err.message
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
        const existing = this.#plugins.get(manifest.name);
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
  async #loadBackendModule(name, entry) {
    const modulePath = path.resolve(
      entry.dir,
      entry.manifest.backendModule
    );

    if (!isPathContained(entry.dir, modulePath)) {
      console.warn(
        `⚠️  Plugin '${name}' backendModule escapes plugin directory — skipping`
      );
      return;
    }

    try {
      const mod = await import(modulePath);
      const registerFn = mod.register || mod.default;
      if (typeof registerFn === "function") {
        await registerFn(this.#hookDispatcher);
      } else {
        console.warn(
          `⚠️  Plugin '${name}' backend module has no register() or default export`
        );
      }
    } catch (err) {
      console.error(
        `❌ Failed to load backend module for plugin '${name}':`,
        err.message
      );
    }
  }

  /**
   * Returns array of all loaded plugin manifests.
   */
  getPlugins() {
    return [...this.#plugins.values()].map((e) => e.manifest);
  }

  /**
   * Returns a combined regex matching all tags from plugins' stripTags arrays,
   * or null if no strip tags are registered.
   */
  getStripTagPatterns() {
    const tags = [];
    for (const { manifest } of this.#plugins.values()) {
      if (Array.isArray(manifest.stripTags)) {
        for (const tag of manifest.stripTags) {
          if (typeof tag === "string" && tag.length > 0) {
            tags.push(tag);
          }
        }
      }
    }

    if (tags.length === 0) return null;

    // Build a combined regex: <tag>...</tag> for each tag (non-greedy, multiline)
    const pattern = tags
      .map((t) => `<${escapeRegex(t)}>[\\s\\S]*?</${escapeRegex(t)}>`)
      .join("|");
    return new RegExp(pattern, "g");
  }

  /**
   * Collect prompt fragment variables from all plugins.
   * Returns { variables: { name: content, ... }, fragments: [content, ...] }
   */
  async getPromptVariables() {
    const variables = {};
    const fragments = [];

    // Collect all fragments with priorities for ordering
    const allFragments = [];

    for (const { manifest, dir } of this.#plugins.values()) {
      if (!Array.isArray(manifest.promptFragments)) continue;

      for (const frag of manifest.promptFragments) {
        if (!frag.file) continue;

        const filePath = path.resolve(dir, frag.file);

        if (!isPathContained(dir, filePath)) {
          console.warn(
            `⚠️  Plugin '${manifest.name}' fragment '${frag.file}' escapes plugin directory — skipping`
          );
          continue;
        }

        let content;
        try {
          content = await fs.readFile(filePath, "utf-8");
        } catch (err) {
          console.warn(
            `⚠️  Failed to read prompt fragment '${frag.file}' for plugin '${manifest.name}':`,
            err.message
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
  getPluginDir(name) {
    const entry = this.#plugins.get(name);
    return entry ? entry.dir : null;
  }

  /**
   * Returns all available Vento parameters from core + plugins.
   * Each entry: { name, type, description, source }
   */
  getParameters() {
    const params = [
      { name: "scenario", type: "string", description: "Scenario content from scenario.md", source: "core" },
      { name: "previous_context", type: "array", description: "Array of previous chapter contents (stripped)", source: "core" },
      { name: "user_input", type: "string", description: "Current user message", source: "core" },
      { name: "status_data", type: "string", description: "Current status YAML content", source: "core" },
      { name: "isFirstRound", type: "boolean", description: "Whether this is the first round (no non-empty chapters)", source: "core" },
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
