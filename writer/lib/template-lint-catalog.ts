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
 * Variable-catalog construction for `lintTemplate`.
 *
 * Builds the union of references that a template at `templatePath` is
 * permitted to use — core engine variables, plugin-declared parameters,
 * plugin-fragment variables (from manifests), plugin runtime dynamic
 * variables (`getDynamicVariables`), lore variables, and the Vento
 * built-in helper filter set. Lint then uses this catalog to flag
 * `vento.unknown-variable` warnings.
 *
 * The three `kind` branches reflect distinct render scopes:
 *  - `system` — full template, all plugin fragments contribute.
 *  - `plugin-fragment` — only THIS plugin's fragment vars contribute.
 *  - `lore` — only the snapshot (lore_* + series/story_name + helpers).
 *
 * Each plugin's `getDynamicVariables()` call is isolated: a throw becomes
 * a `warnings[]` entry and other plugins continue.
 */

import { errorMessage } from "./errors.ts";
import { VENTO_HELPERS } from "./vento-helpers.ts";
import { resolveLoreVariables } from "./lore.ts";
import type { PluginManager } from "./plugin-manager.ts";
import type { TemplateKind, VariableRef } from "./template-lint.ts";

const CORE_VARIABLES: ReadonlyArray<VariableRef> = [
  {
    name: "previous_context",
    type: "array",
    source: "core",
    description: "Array of previous chapter contents (stripped)",
  },
  {
    name: "user_input",
    type: "string",
    source: "core",
    description: "Current user message",
  },
  {
    name: "isFirstRound",
    type: "boolean",
    source: "core",
    description: "Whether this is the first round (no non-empty chapters)",
  },
  {
    name: "series_name",
    type: "string",
    source: "core",
    description: "Display name of the current series",
  },
  {
    name: "story_name",
    type: "string",
    source: "core",
    description: "Display name of the current story",
  },
  {
    name: "chapter_number",
    type: "number",
    source: "core",
    description:
      "1-based index of the chapter being generated (injected when rendering plugin promptFragments)",
  },
  {
    name: "plugin_fragments",
    type: "array",
    source: "core",
    description: "Array of plugin-contributed prompt fragments",
  },
];

const CORE_LORE_SNAPSHOT_VARS: ReadonlyArray<VariableRef> = [
  {
    name: "series_name",
    type: "string",
    source: "core",
    description: "Current series name",
  },
  {
    name: "story_name",
    type: "string",
    source: "core",
    description: "Current story name",
  },
  {
    name: "lore_all",
    type: "string",
    source: "lore",
    description: "All enabled lore passage bodies concatenated",
  },
  {
    name: "lore_tags",
    type: "array",
    source: "lore",
    description: "All known lore tags",
  },
];

export interface CatalogBuildOptions {
  readonly kind: TemplateKind;
  readonly pluginManager: PluginManager;
  readonly playgroundDir: string;
  readonly series?: string;
  readonly story?: string;
  /** When `kind === "plugin-fragment"`, the owning plugin's name (used to scope fragment vars). */
  readonly pluginName?: string;
}

export interface CatalogResult {
  readonly variables: VariableRef[];
  readonly warnings: string[];
}

/**
 * Build a variable catalog according to the templatePath kind:
 *   - `system`: core + plugin-fragment-vars + plugin-parameters + (if series/story) plugin-dynamic + lore + helpers
 *   - `plugin-fragment`: core + this plugin's fragment vars + lore (if series/story) + helpers
 *   - `lore`: snapshot (lore_* + series_name + story_name) + helpers
 *
 * Each plugin's `getDynamicVariables()` is wrapped in try/catch — on throw a
 * warnings[] entry naming the plugin is returned and other plugins continue.
 */
export async function buildVariableCatalog(
  opts: CatalogBuildOptions,
): Promise<CatalogResult> {
  const warnings: string[] = [];
  const helpers: VariableRef[] = VENTO_HELPERS.map((h) => ({
    name: h,
    source: "vento-helper" as const,
    description: `Vento built-in pipe filter |> ${h}`,
  }));

  if (opts.kind === "lore") {
    const loreVars = await collectLoreVars(opts, warnings);
    const seen = new Set<string>();
    const result: VariableRef[] = [];
    for (const v of [...CORE_LORE_SNAPSHOT_VARS, ...loreVars, ...helpers]) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      result.push(v);
    }
    return { variables: result, warnings };
  }

  const out: VariableRef[] = [...CORE_VARIABLES];

  for (const p of opts.pluginManager.getParameters()) {
    if (p.source === "core") continue;
    out.push({
      name: p.name,
      type: p.type,
      source: "plugin-parameter",
      pluginName: p.source,
      description: p.description,
    });
  }

  try {
    const fragVars = await opts.pluginManager.getPromptVariables();
    for (const [name, meta] of Object.entries(fragVars.metadata ?? {})) {
      // When scoping for a specific plugin fragment, exclude *other* plugins' fragment vars
      if (
        opts.kind === "plugin-fragment" && opts.pluginName &&
        meta.plugin !== opts.pluginName
      ) continue;
      out.push({
        name,
        type: "string",
        source: "plugin-fragment",
        pluginName: meta.plugin,
        description:
          `Prompt fragment variable from plugin '${meta.plugin}' (${meta.file})`,
      });
    }
  } catch (err: unknown) {
    warnings.push(
      `pluginManager.getPromptVariables() failed: ${errorMessage(err)}`,
    );
  }

  if (opts.series && opts.story) {
    const dynamic = await collectDynamicVars(opts, warnings);
    out.push(...dynamic);
    const loreVars = await collectLoreVars(opts, warnings);
    out.push(...loreVars);
  }

  out.push(...helpers);
  // Deduplicate by name (first wins; helper / lore last so manifest entries take priority)
  const seen = new Set<string>();
  const deduped: VariableRef[] = [];
  for (const v of out) {
    if (seen.has(v.name)) continue;
    seen.add(v.name);
    deduped.push(v);
  }
  return { variables: deduped, warnings };
}

async function collectDynamicVars(
  opts: CatalogBuildOptions,
  warnings: string[],
): Promise<VariableRef[]> {
  if (!opts.series || !opts.story) return [];
  const out: VariableRef[] = [];
  try {
    const { variables, warnings: pluginWarnings } = await opts.pluginManager
      .getDynamicVariablesWithWarnings({
        series: opts.series,
        name: opts.story,
        storyDir: "",
        userInput: "",
        chapterNumber: 1,
        previousContent: "",
        isFirstRound: false,
        chapterCount: 0,
      });
    for (const w of pluginWarnings) {
      warnings.push(
        `plugin '${w.pluginName}' getDynamicVariables() failed: ${w.message}`,
      );
    }
    for (const [key, value] of Object.entries(variables)) {
      out.push({
        name: key,
        type: typeof value,
        source: "plugin-dynamic",
        description: `Dynamic variable contributed at runtime`,
      });
    }
  } catch (err: unknown) {
    warnings.push(`plugin getDynamicVariables() failed: ${errorMessage(err)}`);
  }
  return out;
}

async function collectLoreVars(
  opts: CatalogBuildOptions,
  warnings: string[],
): Promise<VariableRef[]> {
  if (!opts.series) return [];
  try {
    const resolution = await resolveLoreVariables(
      opts.playgroundDir,
      opts.series,
      opts.story,
    );
    return Object.keys(resolution.variables)
      .filter((k) => k.startsWith("lore_"))
      .map((name) => ({
        name,
        type: name === "lore_tags" ? "array" : "string",
        source: "lore" as const,
        description: `Lore variable resolved from ${opts.series}/${
          opts.story ?? "(series scope)"
        }`,
      }));
  } catch (err: unknown) {
    warnings.push(`resolveLoreVariables() failed: ${errorMessage(err)}`);
    return [];
  }
}
