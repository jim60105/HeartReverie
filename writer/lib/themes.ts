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

import { parse as parseToml } from "@std/toml";
import { createLogger } from "./logger.ts";

const log = createLogger("themes");

const KEBAB_CASE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
// Allow: url('/path'), url('data:...'), CSS gradient functions, or empty
const SAFE_BG =
  /^(?:url\(\s*'\/[^']*'\s*\)|url\(\s*'data:[^']*'\s*\)|(?:linear|radial|conic|repeating-linear|repeating-radial|repeating-conic)-gradient\([\s\S]+\))$/;

export interface Theme {
  readonly id: string;
  readonly label: string;
  readonly colorScheme: string;
  readonly backgroundImage: string;
  readonly palette: Record<string, string>;
}

export interface ThemeIndex {
  readonly themes: ReadonlyMap<string, Theme>;
  readonly loaded: number;
  readonly skipped: number;
}

let index: Map<string, Theme> = new Map();

function validateBackgroundImage(v: unknown): string {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string" || !SAFE_BG.test(v)) {
    throw new Error(
      `backgroundImage must be url('/same-origin'), url('data:...'), or a CSS gradient function; got ${JSON.stringify(v)}`,
    );
  }
  return v;
}

function parseThemeFile(filename: string, content: string): Theme {
  const stem = filename.replace(/\.toml$/, "");
  const raw = parseToml(content) as Record<string, unknown>;

  const id = raw.id;
  if (typeof id !== "string" || id === "" || !KEBAB_CASE.test(id)) {
    throw new Error(`id must be a non-empty kebab-case string; got ${JSON.stringify(id)}`);
  }
  if (id !== stem) {
    throw new Error(`id "${id}" does not match filename stem "${stem}"`);
  }

  const label = raw.label;
  if (typeof label !== "string" || label === "") {
    throw new Error(`label must be a non-empty string; got ${JSON.stringify(label)}`);
  }

  const colorScheme = raw.colorScheme ?? "dark";
  if (colorScheme !== "light" && colorScheme !== "dark") {
    throw new Error(
      `colorScheme must be "light" or "dark"; got ${JSON.stringify(colorScheme)}`,
    );
  }

  const backgroundImage = validateBackgroundImage(raw.backgroundImage);

  const rawPalette = raw.palette;
  if (typeof rawPalette !== "object" || rawPalette === null || Array.isArray(rawPalette)) {
    throw new Error(`[palette] must be a TOML table`);
  }
  const palette: Record<string, string> = {};
  for (const [key, value] of Object.entries(rawPalette as Record<string, unknown>)) {
    if (typeof value !== "string") {
      throw new Error(`palette key "${key}" must be a string value; got ${typeof value}`);
    }
    palette[`--${key}`] = value;
  }

  return { id, label, colorScheme: colorScheme as string, backgroundImage, palette };
}

export async function loadThemes(dir: string): Promise<ThemeIndex> {
  const newIndex = new Map<string, Theme>();
  let loaded = 0;
  let skipped = 0;

  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const entry of Deno.readDir(dir)) {
      entries.push(entry);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      log.warn("Theme directory not found; starting with empty index", { dir });
      index = newIndex;
      return { themes: newIndex, loaded: 0, skipped: 0 };
    }
    throw err;
  }

  for (const entry of entries) {
    if (!entry.isFile || !entry.name.endsWith(".toml")) continue;
    const filepath = `${dir}/${entry.name}`;
    try {
      const content = await Deno.readTextFile(filepath);
      const theme = parseThemeFile(entry.name, content);
      newIndex.set(theme.id, theme);
      loaded++;
    } catch (err) {
      log.error("Failed to load theme file; skipping", {
        file: filepath,
        error: err instanceof Error ? err.message : String(err),
      });
      skipped++;
    }
  }

  index = newIndex;
  log.info("Themes loaded", { loaded, skipped });
  return { themes: newIndex, loaded, skipped };
}

export function getTheme(id: string): Theme | null {
  return index.get(id) ?? null;
}

export function listThemes(): Array<{ id: string; label: string }> {
  return [...index.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, t]) => ({ id: t.id, label: t.label }));
}

export async function refreshThemes(dir: string): Promise<ThemeIndex> {
  return loadThemes(dir);
}
