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
 * @module templates-lore-enum
 *
 * Walks every `_lore` directory under the playground (global + every series
 * + every story) and emits flat listing entries for the template editor.
 * Used by `GET /api/templates` so the editor surfaces every lore file
 * regardless of which story is currently loaded — scoping by `series` /
 * `story` would hide files the user wants to edit.
 *
 * Series and story directory names are filtered through `isValidSegment`
 * from `templates-path.ts` so the resulting `templatePath` round-trips
 * through `parseTemplatePath` without rejecting names containing `:` or
 * other separator characters.
 */

import { isValidSegment } from "./templates-path.ts";

/** Recursively yield absolute paths of `.md` files under `root`. */
export async function* walkMd(root: string): AsyncGenerator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const e of Deno.readDir(root)) entries.push(e);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = `${root}/${e.name}`;
    if (e.isDirectory) {
      yield* walkMd(full);
    } else if (e.isFile && e.name.endsWith(".md")) {
      yield full;
    }
  }
}

export async function enumerateAllLore(
  playgroundDir: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];

  async function walk(scopeRoot: string, builder: (rel: string) => { tp: string; label: string; scope: "global" | "series" | "story" }) {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(scopeRoot);
    } catch {
      return;
    }
    if (!stat.isDirectory) return;
    for await (const top of walkMd(scopeRoot)) {
      const rel = top.slice(scopeRoot.length).replace(/^[/\\]+/, "");
      const meta = builder(rel);
      let sizeBytes = 0;
      try {
        sizeBytes = (await Deno.stat(top)).size;
      } catch { /* ignore */ }
      out.push({
        id: meta.tp,
        label: meta.label,
        path: rel,
        templatePath: meta.tp,
        kind: "lore",
        loreScope: meta.scope,
        editable: true,
        sizeBytes,
      });
    }
  }

  // Global scope
  await walk(`${playgroundDir}/_lore`, (rel) => ({
    tp: `lore:global:${rel}`,
    label: `global → ${rel}`,
    scope: "global" as const,
  }));

  // Series + story scopes
  let topEntries: Deno.DirEntry[] = [];
  try {
    for await (const e of Deno.readDir(playgroundDir)) topEntries.push(e);
  } catch { topEntries = []; }
  for (const seriesEntry of topEntries) {
    if (!seriesEntry.isDirectory) continue;
    const seriesName = seriesEntry.name;
    if (!isValidSegment(seriesName)) continue;
    const seriesPath = `${playgroundDir}/${seriesName}`;
    await walk(`${seriesPath}/_lore`, (rel) => ({
      tp: `lore:series:${seriesName}:${rel}`,
      label: `series (${seriesName}) → ${rel}`,
      scope: "series" as const,
    }));

    let storyEntries: Deno.DirEntry[] = [];
    try {
      for await (const e of Deno.readDir(seriesPath)) storyEntries.push(e);
    } catch { storyEntries = []; }
    for (const storyEntry of storyEntries) {
      if (!storyEntry.isDirectory) continue;
      const storyName = storyEntry.name;
      if (!isValidSegment(storyName)) continue;
      const storyPath = `${seriesPath}/${storyName}`;
      await walk(`${storyPath}/_lore`, (rel) => ({
        tp: `lore:story:${seriesName}:${storyName}:${rel}`,
        label: `story (${seriesName}/${storyName}) → ${rel}`,
        scope: "story" as const,
      }));
    }
  }

  return out;
}
