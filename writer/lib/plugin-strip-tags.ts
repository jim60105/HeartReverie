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
 * Strip-tag aggregation: derive declarations and compiled regexes from
 * plugin manifests' `promptStripTags` and `displayStripTags` arrays.
 *
 * All functions in this module are pure read-only views over a
 * `ReadonlyMap` of plugins; they perform no I/O and do not mutate state.
 * Extracted from {@link PluginManager} so the strip-tag compilation rules
 * (escaping plain names; `/regex/flags` form; logging policy on invalid
 * entries) live in one focused place.
 */

import { errorMessage } from "./errors.ts";
import { createLogger } from "./logger.ts";
import type { PluginManifest } from "../types.ts";

const log = createLogger("plugin");

export interface StripTagsEntry {
  readonly manifest: PluginManifest;
}

export interface StripTagDeclaration {
  plugin: string;
  tags: string[];
  scope: "prompt+display" | "prompt" | "display";
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a single tag entry (plain name or `/regex/flags`) into a regex
 * source fragment, or `null` when the entry is invalid. Shared by both
 * {@link getStripTagPatterns} and {@link getCombinedStripTagPatterns}.
 */
function compileStripTagEntry(
  tag: unknown,
  pluginName: string,
): string | null {
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
 * Returns the per-plugin strip-tag declarations: aggregates each plugin's
 * `promptStripTags` and `displayStripTags` into a single record with a
 * `scope` discriminator. Plugins declaring no tags are omitted.
 */
export function getStripTagDeclarations(
  plugins: ReadonlyMap<string, StripTagsEntry>,
): StripTagDeclaration[] {
  const out: StripTagDeclaration[] = [];
  for (const { manifest } of plugins.values()) {
    const promptTags = Array.isArray(manifest.promptStripTags)
      ? manifest.promptStripTags.filter((t): t is string =>
        typeof t === "string"
      )
      : [];
    const displayTags = Array.isArray(manifest.displayStripTags)
      ? manifest.displayStripTags.filter((t): t is string =>
        typeof t === "string"
      )
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
 * Returns a combined regex matching all tags from plugins' promptStripTags
 * arrays, or null if no strip tags are registered. Entries starting with
 * "/" are treated as regex pattern strings. Plain strings are auto-wrapped
 * as `<tag>[\s\S]*?</tag>`.
 */
export function getStripTagPatterns(
  plugins: ReadonlyMap<string, StripTagsEntry>,
): RegExp | null {
  const patterns: string[] = [];
  for (const { manifest } of plugins.values()) {
    if (Array.isArray(manifest.promptStripTags)) {
      for (const tag of manifest.promptStripTags) {
        const compiled = compileStripTagEntry(tag, manifest.name);
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
 * declares any entries. Deduplicates identical raw entries before
 * compiling. Intended for callers (e.g., story export) that want to
 * produce content fully stripped of all plugin-declared tags, matching
 * what the frontend actually displays.
 */
export function getCombinedStripTagPatterns(
  plugins: ReadonlyMap<string, StripTagsEntry>,
): RegExp | null {
  const seen = new Set<string>();
  const patterns: string[] = [];

  for (const { manifest } of plugins.values()) {
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
        const compiled = compileStripTagEntry(tag, manifest.name);
        if (compiled !== null) patterns.push(compiled);
      }
    }
  }

  if (patterns.length === 0) return null;

  return new RegExp(patterns.join("|"), "gi");
}
