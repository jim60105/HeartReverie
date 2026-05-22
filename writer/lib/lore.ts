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
 * @module lore
 *
 * Canonical types for the lore codex + the pure filter/sort/concat
 * helpers, the Vento variable generator (`generateLoreVariables`), and
 * the top-level `resolveLoreVariables` entrypoint called from
 * `template.ts`.
 *
 * Frontmatter parsing lives in `lore-frontmatter.ts`; tag normalization /
 * directory-as-tag / filename-as-tag helpers live in `lore-tags.ts`;
 * filesystem traversal lives in `lore-collect.ts`. Their public surfaces
 * are re-exported here so existing importers and tests don't need to
 * change paths.
 */

import { normalizeTag } from "./lore-tags.ts";
import { collectAllPassages } from "./lore-collect.ts";

// ── Types ──

/** Lore scope type. */
export type LoreScope = "global" | "series" | "story";

/** Parsed frontmatter from a lore passage. */
export interface LoreFrontmatter {
  readonly tags: string[];
  readonly priority: number;
  readonly enabled: boolean;
}

/** A fully resolved lore passage. */
export interface LorePassage {
  readonly filename: string;
  readonly filepath: string;
  /** Relative path from the scope root (e.g. "characters/hero.md" or "setting.md"). */
  readonly relativePath: string;
  readonly scope: LoreScope;
  readonly directory: string;
  readonly frontmatter: LoreFrontmatter;
  readonly effectiveTags: string[];
  readonly content: string;
}

/** Template variables generated from lore passages. */
export interface LoreTemplateVars {
  readonly lore_all: string;
  readonly lore_tags: string[];
  readonly [key: string]: string | string[];
}

/** Result of resolving lore for a given context: raw passages + generated template variables. */
export interface LoreResolution {
  readonly passages: LorePassage[];
  readonly variables: LoreTemplateVars;
}

// ── Re-exports for backward compatibility (importers/tests use writer/lib/lore.ts) ──

export { parseFrontmatter } from "./lore-frontmatter.ts";
export {
  computeEffectiveTags,
  identifyScope,
  normalizeTag,
  resolveDirectoryTag,
  resolveFilenameTag,
} from "./lore-tags.ts";
export { collectAllPassages, collectPassagesFromScope } from "./lore-collect.ts";

// ── Constants ──

const SEPARATOR = "\n\n---\n\n";

// ── Filtering & Ordering ──

/** Filter passages: only enabled passages. */
export function filterEnabled(passages: LorePassage[]): LorePassage[] {
  return passages.filter((p) => p.frontmatter.enabled);
}

/** Filter passages by tag (exact match on effective tags, which are already normalized). */
export function filterByTag(passages: LorePassage[], tag: string): LorePassage[] {
  const norm = normalizeTag(tag);
  if (!norm) return [];
  return passages.filter((p) => p.effectiveTags.includes(norm));
}

/** Sort passages by priority descending, then filename alphabetically. */
export function sortPassages(passages: LorePassage[]): LorePassage[] {
  return [...passages].sort((a, b) => {
    const pDiff = b.frontmatter.priority - a.frontmatter.priority;
    if (pDiff !== 0) return pDiff;
    return a.filename.localeCompare(b.filename);
  });
}

/** Concatenate passage bodies with separator. */
export function concatenateContent(passages: LorePassage[]): string {
  if (passages.length === 0) return "";
  return passages.map((p) => p.content).join(SEPARATOR);
}

// ── Template Variable Generation ──

/**
 * Generate lore template variables from collected passages.
 * Returns lore_all, lore_tags, and lore_<normalized_tag> for each discovered tag.
 */
export function generateLoreVariables(passages: LorePassage[]): LoreTemplateVars {
  const enabled = filterEnabled(passages);
  const sorted = sortPassages(enabled);

  // lore_all: all enabled passages
  const loreAll = concatenateContent(sorted);

  // Collect all unique tags across all passages (including disabled — for variable safety)
  const allTags = new Set<string>();
  for (const p of passages) {
    for (const t of p.effectiveTags) {
      allTags.add(t);
    }
  }

  const loreTagsArray = [...allTags];

  // Build per-tag variables from enabled passages only
  const vars: Record<string, string | string[]> = {
    lore_all: loreAll,
    lore_tags: loreTagsArray,
  };

  // Initialize all discovered tag variables to empty string
  for (const tag of allTags) {
    const norm = normalizeTag(tag);
    if (norm) {
      const varName = `lore_${norm}`;
      if (!(varName in vars)) {
        vars[varName] = "";
      }
    }
  }

  // Populate tag variables with enabled passage content
  const tagPassages = new Map<string, LorePassage[]>();
  for (const p of sorted) {
    for (const tag of p.effectiveTags) {
      const norm = normalizeTag(tag);
      if (!norm) continue;
      if (!tagPassages.has(norm)) tagPassages.set(norm, []);
      tagPassages.get(norm)!.push(p);
    }
  }

  for (const [normTag, tagPasses] of tagPassages) {
    // Passages are already sorted from the global sort.
    // Deduplicate since a passage may appear under multiple tags.
    const uniquePasses = deduplicatePassages(tagPasses);
    vars[`lore_${normTag}`] = concatenateContent(uniquePasses);
  }

  return vars as LoreTemplateVars;
}

/** Deduplicate passages by filepath. */
function deduplicatePassages(passages: LorePassage[]): LorePassage[] {
  const seen = new Set<string>();
  return passages.filter((p) => {
    if (seen.has(p.filepath)) return false;
    seen.add(p.filepath);
    return true;
  });
}

// ── Public API for Template Integration ──

/**
 * Resolve lore variables for a given series/story context.
 * This is the main entry point called from template.ts.
 */
export async function resolveLoreVariables(
  playgroundDir: string,
  series?: string,
  story?: string,
): Promise<LoreResolution> {
  const passages = await collectAllPassages(playgroundDir, series, story);
  const variables = generateLoreVariables(passages);
  return { passages, variables };
}
