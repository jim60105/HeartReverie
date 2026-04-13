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

import { join, relative } from "@std/path";

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

// ── Constants ──

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const RESERVED_TAG_NAMES = new Set(["all", "tags"]);
const SEPARATOR = "\n\n---\n\n";

// ── Frontmatter Parser ──

/**
 * Parse YAML frontmatter from a Markdown passage.
 * Returns parsed frontmatter + body content. Handles missing or malformed frontmatter gracefully.
 */
export function parseFrontmatter(raw: string): { frontmatter: LoreFrontmatter; content: string } {
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) {
    return {
      frontmatter: { tags: [], priority: 0, enabled: true },
      content: raw.trim(),
    };
  }

  const yamlBlock = match[1]!;
  const content = match[2]!.trim();

  // Lightweight YAML parsing (avoids heavy dependency — frontmatter is simple key-value)
  const tags = parseYamlStringArray(yamlBlock, "tags");
  const priority = parseYamlNumber(yamlBlock, "priority", 0);
  const enabled = parseYamlBoolean(yamlBlock, "enabled", true);

  return {
    frontmatter: { tags, priority, enabled },
    content,
  };
}

/** Extract a string array from a YAML block for the given key. */
function parseYamlStringArray(yaml: string, key: string): string[] {
  // Match inline array: tags: [a, b, c]
  const inlineMatch = new RegExp(`^${key}\\s*:\\s*\\[([^\\]]*)\\]`, "m").exec(yaml);
  if (inlineMatch) {
    return inlineMatch[1]!
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter((s) => s.length > 0);
  }

  // Match block array:
  // tags:
  //   - a
  //   - b
  const blockMatch = new RegExp(`^${key}\\s*:\\s*$`, "m").exec(yaml);
  if (blockMatch) {
    const afterKey = yaml.slice(blockMatch.index! + blockMatch[0].length);
    const items: string[] = [];
    for (const line of afterKey.split("\n")) {
      const itemMatch = /^\s+-\s+(.+)$/.exec(line);
      if (itemMatch) {
        items.push(itemMatch[1]!.trim().replace(/^["']|["']$/g, ""));
      } else if (line.trim() && !/^\s+-/.test(line)) {
        break; // End of list
      }
    }
    return items;
  }

  return [];
}

/** Extract a number from a YAML block for the given key. */
function parseYamlNumber(yaml: string, key: string, defaultValue: number): number {
  const match = new RegExp(`^${key}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`, "m").exec(yaml);
  if (!match) return defaultValue;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

/** Extract a boolean from a YAML block for the given key. */
function parseYamlBoolean(yaml: string, key: string, defaultValue: boolean): boolean {
  const match = new RegExp(`^${key}\\s*:\\s*(true|false)`, "m").exec(yaml);
  if (!match) return defaultValue;
  return match[1] === "true";
}

// ── Tag Normalization ──

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

// ── Scope Identification ──

/**
 * Determine the scope of a passage from its path relative to the lore root.
 * Returns null if the path doesn't match a known scope structure.
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

// ── Directory-as-Tag Resolution ──

/**
 * Compute the directory-implicit tag from a passage path.
 * Returns the immediate parent directory name if the passage is NOT at the scope root level.
 * Scope root varies: global/ for global, series/<S>/ for series, story/<S>/<T>/ for story.
 */
export function resolveDirectoryTag(relPath: string, scope: LoreScope): string | null {
  const parts = relPath.split("/").filter(Boolean);

  // Determine the minimum depth for "scope root" (where no dir tag is assigned)
  // global/file.md → parts = ["global", "file.md"] → depth 2, root level
  // global/characters/file.md → parts = ["global", "characters", "file.md"] → depth 3, dir tag = "characters"
  // series/S/file.md → depth 3, root level
  // series/S/characters/file.md → depth 4, dir tag = "characters"
  // story/S/T/file.md → depth 4, root level
  // story/S/T/characters/file.md → depth 5, dir tag = "characters"

  const rootDepth: Record<LoreScope, number> = {
    global: 2,
    series: 3,
    story: 4,
  };

  const minForDirTag = rootDepth[scope] + 1;
  if (parts.length < minForDirTag) return null;

  // The immediate parent directory is parts[parts.length - 2]
  return parts[parts.length - 2]!;
}

/**
 * Compute effective tags: union of frontmatter tags + directory-implicit tag.
 * All tags are fully normalized (same transform as template variable names) and duplicates are removed.
 */
export function computeEffectiveTags(frontmatterTags: string[], directoryTag: string | null): string[] {
  const allTags = [...frontmatterTags];
  if (directoryTag) allTags.push(directoryTag);

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

// ── Scope Collection (Retrieval Engine) ──

/**
 * Scan a scope directory and collect all .md passages.
 * Scans root level and immediate tag subdirectories only (one level deep).
 */
export async function collectPassagesFromScope(
  scopeDir: string,
  scope: LoreScope,
  loreRoot: string,
): Promise<LorePassage[]> {
  const passages: LorePassage[] = [];

  try {
    const entries: Deno.DirEntry[] = [];
    for await (const entry of Deno.readDir(scopeDir)) {
      entries.push(entry);
    }

    // Process .md files at scope root
    for (const entry of entries) {
      if (entry.isFile && entry.name.endsWith(".md")) {
        const filepath = join(scopeDir, entry.name);
        const passage = await readPassage(filepath, loreRoot, scope);
        if (passage) passages.push(passage);
      }
    }

    // Process immediate subdirectories (tag directories)
    for (const entry of entries) {
      if (entry.isDirectory && !entry.name.startsWith(".")) {
        const subDir = join(scopeDir, entry.name);
        try {
          for await (const subEntry of Deno.readDir(subDir)) {
            if (subEntry.isFile && subEntry.name.endsWith(".md")) {
              const filepath = join(subDir, subEntry.name);
              const passage = await readPassage(filepath, loreRoot, scope);
              if (passage) passages.push(passage);
            }
          }
        } catch {
          // Subdirectory read error — skip
        }
      }
    }
  } catch {
    // Scope directory may not exist — return empty
  }

  return passages;
}

/** Read and parse a single passage file. */
async function readPassage(
  filepath: string,
  loreRoot: string,
  scope: LoreScope,
): Promise<LorePassage | null> {
  try {
    const raw = await Deno.readTextFile(filepath);
    const { frontmatter, content } = parseFrontmatter(raw);
    const relPath = relative(loreRoot, filepath);
    const directoryTag = resolveDirectoryTag(relPath, scope);
    const effectiveTags = computeEffectiveTags(frontmatter.tags, directoryTag);
    const parts = relPath.split("/").filter(Boolean);
    const filename = parts[parts.length - 1]!;
    const directory = parts.length > 1 ? parts.slice(0, -1).join("/") : "";

    // Relative path from scope root (e.g. "characters/hero.md" or "setting.md")
    const rootDepth: Record<LoreScope, number> = { global: 1, series: 2, story: 3 };
    const scopeParts = parts.slice(rootDepth[scope]);
    const relativePath = scopeParts.join("/");

    return {
      filename,
      filepath,
      relativePath,
      scope,
      directory,
      frontmatter,
      effectiveTags,
      content,
    };
  } catch {
    return null;
  }
}

// ── Multi-Scope Collection ──

/**
 * Collect all passages applicable to a given series/story context.
 * Scans global, series (if provided), and story (if both provided) scopes.
 */
export async function collectAllPassages(
  loreRoot: string,
  series?: string,
  story?: string,
): Promise<LorePassage[]> {
  const tasks: Promise<LorePassage[]>[] = [];

  // Always include global
  tasks.push(collectPassagesFromScope(join(loreRoot, "global"), "global", loreRoot));

  // Series scope
  if (series) {
    tasks.push(collectPassagesFromScope(join(loreRoot, "series", series), "series", loreRoot));
  }

  // Story scope
  if (series && story) {
    tasks.push(collectPassagesFromScope(join(loreRoot, "story", series, story), "story", loreRoot));
  }

  const results = await Promise.all(tasks);
  return results.flat();
}

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
    // Passages are already sorted from the global sort
    // But we need to deduplicate since a passage may appear under multiple tags
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
  loreRoot: string,
  series?: string,
  story?: string,
): Promise<LoreTemplateVars> {
  const passages = await collectAllPassages(loreRoot, series, story);
  return generateLoreVariables(passages);
}
