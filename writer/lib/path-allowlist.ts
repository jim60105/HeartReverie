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

import { dirname, isAbsolute, resolve, SEPARATOR } from "@std/path";
import { isPathContained } from "./path-safety.ts";

/**
 * Hard-coded path root allowlist for `format: "path"` fields. The order is
 * authoritative and SHALL be exposed verbatim from `GET /settings/schema-meta`.
 */
export function getHardcodedPathRoots(pluginName: string): string[] {
  return [
    "playground/lore/",
    "playground/chapters/",
    `playground/_plugins/${pluginName}/`,
  ];
}

/**
 * Resolve a display root (e.g. `"playground/lore/"`) to an absolute filesystem
 * path under `projectRoot`.
 */
export function resolveDisplayRoot(
  projectRoot: string,
  display: string,
): string {
  return resolve(projectRoot, display);
}

/**
 * Intersect the hardcoded display root list with the manifest's `x-path-roots`.
 * Order follows the hardcoded list.
 */
export function intersectXPathRoots(
  hardcoded: readonly string[],
  xPathRoots: readonly string[] | null,
): string[] {
  if (xPathRoots == null) return [...hardcoded];
  const set = new Set(xPathRoots.map(normalizeRoot));
  return hardcoded.filter((r) => set.has(normalizeRoot(r)));
}

function normalizeRoot(s: string): string {
  let r = s.trim();
  if (!r.endsWith("/")) r = r + "/";
  return r;
}

/**
 * Returns `null` when the path satisfies the allowlist, otherwise an error
 * payload usable as the `params` of a `format` validation error.
 *
 * Algorithm:
 *   1. Reject absolute paths and any `..` segment (syntactic gate).
 *   2. Resolve the candidate against `projectRoot`.
 *   3. Compare against each `absoluteRoots` entry. The match SHALL be against
 *      the realpath of the candidate (or its nearest existing ancestor).
 */
export async function validatePathValue(
  candidate: string,
  absoluteRoots: readonly string[],
  projectRoot: string,
): Promise<{ ok: true } | { ok: false; reason: string; roots: string[] }> {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return { ok: false, reason: "empty", roots: [...absoluteRoots] };
  }
  if (isAbsolute(candidate)) {
    return { ok: false, reason: "absolute", roots: [...absoluteRoots] };
  }
  // Reject `..` segments to prevent traversal at the syntactic layer.
  const segments = candidate.split(/[\\/]+/);
  for (const s of segments) {
    if (s === "..") {
      return { ok: false, reason: "parent-traversal", roots: [...absoluteRoots] };
    }
  }

  const abs = resolve(projectRoot, candidate);

  // Resolve realpath of nearest existing ancestor.
  let realParent: string;
  try {
    realParent = await Deno.realPath(abs);
  } catch {
    let cur = abs;
    let resolved: string | null = null;
    while (true) {
      const parent = dirname(cur);
      if (parent === cur) break;
      try {
        resolved = await Deno.realPath(parent);
        break;
      } catch {
        cur = parent;
      }
    }
    if (resolved == null) {
      return {
        ok: false,
        reason: "unresolvable",
        roots: [...absoluteRoots],
      };
    }
    realParent = resolved;
  }

  for (const root of absoluteRoots) {
    let absRoot: string;
    try {
      absRoot = await Deno.realPath(root);
    } catch {
      // Root does not exist on disk: do a lexical containment check fallback.
      absRoot = root;
    }
    if (
      realParent === absRoot ||
      isPathContained(absRoot, realParent)
    ) {
      return { ok: true };
    }
  }

  return { ok: false, reason: "outside-allowlist", roots: [...absoluteRoots] };
}

/**
 * Resolve a `<pluginName>`-templated display root list to absolute filesystem
 * paths under `projectRoot`. Returned in the same order.
 */
export function resolveDisplayRoots(
  displays: readonly string[],
  projectRoot: string,
): string[] {
  return displays.map((d) => {
    let trimmed = d;
    if (trimmed.endsWith("/") || trimmed.endsWith(SEPARATOR)) {
      trimmed = trimmed.slice(0, -1);
    }
    return resolveDisplayRoot(projectRoot, trimmed);
  });
}
