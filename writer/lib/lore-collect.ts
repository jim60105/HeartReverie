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
 * @module lore-collect
 *
 * Filesystem traversal for lore passages. Scans a scope directory (one
 * level deep: root files + immediate tag subdirectories) and assembles
 * `LorePassage` records by combining each `.md` file's frontmatter with
 * its directory-implicit and filename-implicit tags.
 *
 * `collectAllPassages` runs the global/series/story scope scans in
 * parallel and flattens the results. NotFound on any scope directory is
 * treated as "scope absent" (empty result), not an error.
 */

import { errorMessage } from "./errors.ts";
import { join, relative } from "@std/path";
import { createLogger } from "./logger.ts";
import { parseFrontmatter } from "./lore-frontmatter.ts";
import { computeEffectiveTags, resolveDirectoryTag, resolveFilenameTag } from "./lore-tags.ts";
import type { LorePassage, LoreScope } from "./lore.ts";

const log = createLogger("lore");

/**
 * Scan a scope directory and collect all .md passages.
 * Scans root level and immediate tag subdirectories only (one level deep).
 * The scope is passed explicitly by the caller.
 */
export async function collectPassagesFromScope(
  scopeDir: string,
  scope: LoreScope,
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
        const passage = await readPassage(filepath, scopeDir, scope);
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
              const passage = await readPassage(filepath, scopeDir, scope);
              if (passage) passages.push(passage);
            }
          }
        } catch (err: unknown) {
          if (err instanceof Deno.errors.NotFound) continue;
          throw err;
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }

  return passages;
}

/** Read and parse a single passage file. scopeDir is the _lore/ directory for this scope. */
async function readPassage(
  filepath: string,
  scopeDir: string,
  scope: LoreScope,
): Promise<LorePassage | null> {
  try {
    const raw = await Deno.readTextFile(filepath);
    const { frontmatter, content } = parseFrontmatter(raw);
    // Scope-relative path (relative to _lore/ directory): e.g. "characters/hero.md" or "rules.md"
    const scopeRelPath = relative(scopeDir, filepath);
    const directoryTag = resolveDirectoryTag(scopeRelPath);
    const filenameTag = resolveFilenameTag(scopeRelPath.split("/").filter(Boolean).pop()!);
    const effectiveTags = computeEffectiveTags(frontmatter.tags, directoryTag, filenameTag);
    const parts = scopeRelPath.split("/").filter(Boolean);
    const filename = parts[parts.length - 1]!;
    const directory = parts.length > 1 ? parts.slice(0, -1).join("/") : "";

    return {
      filename,
      filepath,
      relativePath: scopeRelPath,
      scope,
      directory,
      frontmatter,
      effectiveTags,
      content,
    };
  } catch (err: unknown) {
    if (!(err instanceof Deno.errors.NotFound)) {
      log.warn(`[lore:readPassage] Failed to read ${filepath}: ${errorMessage(err)}`);
    }
    return null;
  }
}

/**
 * Collect all passages applicable to a given series/story context.
 * Scans global (_lore/), series (<series>/_lore/), and story (<series>/<story>/_lore/) scopes.
 */
export async function collectAllPassages(
  playgroundDir: string,
  series?: string,
  story?: string,
): Promise<LorePassage[]> {
  const tasks: Promise<LorePassage[]>[] = [];

  // Always include global
  tasks.push(collectPassagesFromScope(join(playgroundDir, "_lore"), "global"));

  // Series scope
  if (series) {
    tasks.push(collectPassagesFromScope(join(playgroundDir, series, "_lore"), "series"));
  }

  // Story scope
  if (series && story) {
    tasks.push(collectPassagesFromScope(join(playgroundDir, series, story, "_lore"), "story"));
  }

  const results = await Promise.all(tasks);
  return results.flat();
}
