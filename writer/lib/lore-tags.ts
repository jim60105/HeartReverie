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
 * @module lore-tags
 *
 * Tag computation primitives for lore passages: normalization (so a tag
 * can serve as a Vento template-variable suffix), directory-as-tag and
 * filename-as-tag resolution, and the `computeEffectiveTags` aggregator
 * that produces the deduplicated normalized tag list used by
 * `LorePassage.effectiveTags`.
 *
 * Aggregation invariants (must be preserved):
 *   - Order: frontmatter tags → directory tag → filename tag.
 *   - Normalize AFTER aggregation; dedupe by normalized form preserving
 *     first occurrence; drop empty or reserved names.
 *   - `resolveDirectoryTag` returns the raw parent directory name (NOT
 *     normalized) — normalization is owned by `computeEffectiveTags`.
 */

import type { LoreScope } from "./lore.ts";

const RESERVED_TAG_NAMES = new Set(["all", "tags"]);

/**
 * Normalize a tag name into a valid Vento template variable suffix.
 * Lowercase, hyphens/spaces → underscores, strip non-alphanumeric/underscore characters.
 * Returns null if the result is empty or a reserved name.
 */
export function normalizeTag(tag: string): string | null {
  const normalized = tag
    .toLowerCase()
    .replace(/[-\s]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

  if (!normalized || RESERVED_TAG_NAMES.has(normalized)) return null;
  return normalized;
}

/**
 * Determine the scope of a passage from its path relative to the lore root.
 * Returns null if the path doesn't match a known scope structure.
 * @deprecated Scope is now passed explicitly by the caller. Retained for backward compatibility.
 */
export function identifyScope(relPath: string): { scope: LoreScope; series?: string; story?: string } | null {
  const parts = relPath.split("/").filter(Boolean);
  if (parts.length < 2) return null; // At minimum: scope/file.md

  const scopePrefix = parts[0];
  if (scopePrefix === "global") {
    return { scope: "global" };
  }
  if (scopePrefix === "series" && parts.length >= 3) {
    return { scope: "series", series: parts[1] };
  }
  if (scopePrefix === "story" && parts.length >= 4) {
    return { scope: "story", series: parts[1], story: parts[2] };
  }
  return null;
}

/**
 * Compute the directory-implicit tag from a scope-relative passage path.
 * The path must be relative to the `_lore/` directory (e.g., "characters/alice.md" or "rules.md").
 * Returns the immediate parent directory name if the passage is NOT at the scope root level.
 */
export function resolveDirectoryTag(scopeRelPath: string): string | null {
  const parts = scopeRelPath.split("/").filter(Boolean);

  // A scope-relative path with ≤1 part is at the scope root (e.g., "rules.md")
  // A path with 2+ parts has a directory tag (e.g., "characters/alice.md" → "characters")
  if (parts.length < 2) return null;

  // The immediate parent directory is parts[parts.length - 2]
  return parts[parts.length - 2]!;
}

/**
 * Compute effective tags: union of frontmatter tags + directory-implicit tag + filename-implicit tag.
 * All tags are fully normalized (same transform as template variable names) and duplicates are removed.
 */
export function computeEffectiveTags(
  frontmatterTags: string[],
  directoryTag: string | null,
  filenameTag: string | null = null,
): string[] {
  const allTags = [...frontmatterTags];
  if (directoryTag) allTags.push(directoryTag);
  if (filenameTag) allTags.push(filenameTag);

  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of allTags) {
    const norm = normalizeTag(tag);
    if (norm && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }
  return result;
}

/**
 * Resolve the filename-implicit tag from a passage filename.
 * Strips the `.md` extension, passes the stem through `normalizeTag()`.
 * Returns null if the stem normalizes to empty or a reserved name.
 */
export function resolveFilenameTag(filename: string): string | null {
  const stem = filename.replace(/\.md$/i, "");
  return normalizeTag(stem);
}
