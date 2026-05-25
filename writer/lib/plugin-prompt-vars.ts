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
 * Prompt-variable + parameter aggregation across loaded plugins.
 *
 * The functions here consume already-discovered plugin entries (read-only
 * map references for read paths; the live mutable map for the
 * fragment-validation prune pass) and a `getSettings` callback for
 * per-plugin enable/disable gating. They perform no plugin loading
 * themselves.
 *
 * Extracted from {@link PluginManager} so the prompt-variable rules
 * (SSTI revalidation on read, priority sort, named-vs-unnamed split,
 * core-variable collision policy, first-loaded-plugin-wins on inter-plugin
 * conflicts) live in one focused place.
 */

import { resolve } from "@std/path";
import { errorMessage } from "./errors.ts";
import { isPathContained } from "./path-safety.ts";
import { validateTemplate } from "./template.ts";
import { createLogger } from "./logger.ts";
import type {
  DynamicVariableContext,
  PluginManifest,
} from "../types.ts";

const log = createLogger("plugin");

/**
 * Minimal shape of a plugin entry consumed by this module. Intentionally
 * narrower than `PluginManager`'s internal `PluginEntry`.
 */
export interface PromptVarsEntry {
  readonly manifest: PluginManifest;
  readonly dir: string;
}

export interface PromptVariables {
  readonly variables: Record<string, string>;
  readonly fragments: string[];
  readonly metadata?: Record<string, { plugin: string; file: string }>;
}

export interface ParameterInfo {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly source: string;
}

export type DynamicVarProvider = (
  context: DynamicVariableContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>;

export type GetSettingsFn = (
  name: string,
) => Promise<Record<string, unknown>>;

/** Core template variable names that plugins must not override. */
const CORE_TEMPLATE_VARS = new Set<string>([
  "previous_context",
  "user_input",
  "isFirstRound",
  "series_name",
  "story_name",
  "plugin_fragments",
]);

/**
 * Validate every plugin's `promptFragments[].file` source against the SSTI
 * whitelist (`validateTemplate()`). Plugins whose fragments contain
 * forbidden tokens are removed from `plugins` so they leave no observable
 * side effects.
 *
 * MUST be invoked before hook registration / backend module loading.
 * Idempotent — safe to call again after `plugins` mutates.
 */
export async function validatePluginFragments(
  plugins: Map<string, PromptVarsEntry>,
): Promise<void> {
  const toRemove: string[] = [];
  for (const [name, entry] of plugins) {
    const manifest = entry.manifest;
    if (!Array.isArray(manifest.promptFragments)) continue;

    for (const frag of manifest.promptFragments) {
      if (!frag.file) continue;
      const filePath = resolve(entry.dir, frag.file);
      if (!isPathContained(entry.dir, filePath)) {
        log.error(
          "Plugin fragment path escapes plugin directory — removing plugin",
          { plugin: name, file: frag.file },
        );
        toRemove.push(name);
        break;
      }

      let source: string;
      try {
        source = await Deno.readTextFile(filePath);
      } catch (err: unknown) {
        log.error(
          "Plugin fragment file unreadable during SSTI validation — removing plugin",
          { plugin: name, file: frag.file, error: errorMessage(err) },
        );
        toRemove.push(name);
        break;
      }

      const errors = validateTemplate(source);
      if (errors.length > 0) {
        log.error(
          "Plugin fragment failed SSTI validation — removing plugin",
          { plugin: name, file: frag.file, expressions: errors },
        );
        toRemove.push(name);
        break;
      }
    }
  }

  for (const name of toRemove) {
    plugins.delete(name);
  }
}

/**
 * Collect prompt fragment variables from all enabled plugins. Returns
 * { variables: { name: content, ... }, fragments: [content, ...] }.
 */
export async function getPromptVariables(
  plugins: ReadonlyMap<string, PromptVarsEntry>,
  getSettings: GetSettingsFn,
): Promise<PromptVariables> {
  const variables: Record<string, string> = {};
  const fragments: string[] = [];
  const metadata: Record<string, { plugin: string; file: string }> = {};

  const allFragments: Array<{ content: string; priority: number }> = [];

  for (const { manifest, dir } of plugins.values()) {
    if (!Array.isArray(manifest.promptFragments)) continue;

    const pluginSettings = await getSettings(manifest.name);
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
        log.warn(
          "Plugin fragment failed SSTI revalidation — skipping fragment",
          {
            plugin: manifest.name,
            file: frag.file,
            expressions: ssti,
          },
        );
        continue;
      }

      const priority = typeof frag.priority === "number" ? frag.priority : 100;

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

/**
 * Collect dynamic template variables from all plugins that exported
 * `getDynamicVariables()`. Per-plugin failures are reported as warnings
 * rather than aborting the whole catalog.
 *
 * Collision policy: core vars are rejected (ignored + warn-logged);
 * first-loaded plugin wins for inter-plugin conflicts.
 */
export async function getDynamicVariablesWithWarnings(
  providers: ReadonlyMap<string, DynamicVarProvider>,
  context: DynamicVariableContext,
  getSettings: GetSettingsFn,
): Promise<{
  variables: Record<string, unknown>;
  warnings: Array<{ pluginName: string; message: string }>;
}> {
  const result: Record<string, unknown> = {};
  const warnings: Array<{ pluginName: string; message: string }> = [];

  for (const [pluginName, provider] of providers) {
    try {
      const pluginSettings = await getSettings(pluginName);
      if (pluginSettings.enabled === false) continue;
      const extendedContext: DynamicVariableContext = {
        ...context,
        getSettings: () => getSettings(pluginName),
      };
      const vars = await provider(extendedContext);
      if (!vars || typeof vars !== "object") continue;

      for (const [key, value] of Object.entries(vars)) {
        if (CORE_TEMPLATE_VARS.has(key)) {
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
 * contents read). Disabled plugins are NOT filtered here — the editor
 * surfaces every declared fragment regardless of enabled state.
 */
export function enumerateFragmentRefs(
  plugins: ReadonlyMap<string, PromptVarsEntry>,
): Array<{
  plugin: string;
  pluginDisplayName: string;
  file: string;
  variable?: string;
  priority?: number;
}> {
  const refs: Array<{
    plugin: string;
    pluginDisplayName: string;
    file: string;
    variable?: string;
    priority?: number;
  }> = [];
  for (const { manifest } of plugins.values()) {
    if (!Array.isArray(manifest.promptFragments)) continue;
    for (const frag of manifest.promptFragments) {
      if (!frag.file) continue;
      refs.push({
        plugin: manifest.name,
        pluginDisplayName: manifest.displayName,
        file: frag.file,
        variable: frag.variable,
        priority: typeof frag.priority === "number" ? frag.priority : undefined,
      });
    }
  }
  return refs;
}

/**
 * Returns the full parameter catalog: built-in core parameters (always
 * present) followed by per-plugin `parameters[]` entries and prompt-
 * fragment variables.
 */
export function getParameters(
  plugins: ReadonlyMap<string, PromptVarsEntry>,
): ParameterInfo[] {
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

  for (const { manifest } of plugins.values()) {
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
