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
 * @module lore-frontmatter
 *
 * Lightweight YAML frontmatter parser dedicated to lore passages. The
 * grammar is intentionally tiny (no nesting, only `tags`/`priority`/
 * `enabled`) so we hand-parse the three known keys instead of pulling in
 * a full YAML library.
 *
 * Returns sensible defaults on malformed/missing frontmatter so callers
 * never need to special-case the unhappy path.
 */

import type { LoreFrontmatter } from "./lore.ts";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

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
