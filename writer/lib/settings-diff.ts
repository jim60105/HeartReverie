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
 * Path / diff helpers used by the plugin-settings transactional flow.
 *
 * Previously inlined at the end of {@link PluginManager}; extracted so they
 * can be tested in isolation and to keep `plugin-manager.ts` focused on
 * plugin lifecycle concerns. Pure functions: no I/O, no global state.
 *
 * - {@link computeDeepDiff} — list JSON-pointer-ish paths where two values
 *   differ.
 * - {@link unionPaths} — set union of two path arrays.
 * - {@link computeHiddenPaths} — walk a schema's `x-show-when` directives to
 *   identify hidden field paths.
 * - {@link excludeHiddenFromDiff} — filter paths that are at or under any
 *   hidden path.
 * - {@link isPathInScope} — true when a path lies at or under any path in a
 *   scope set.
 */

/**
 * Compute a deep diff between two JSON-shaped values and return the list of
 * JSON-Pointer-ish paths at which they differ. Paths use `.` for object key
 * descent and `[i]` for array index descent (e.g. `items[0].name`).
 *
 * Strategy: emit the deepest diverging path. When two arrays differ in
 * length, the parent path is emitted; otherwise per-index diffs. When a key
 * is present in only one side, the path of that key is emitted.
 */
export function computeDeepDiff(
  a: unknown,
  b: unknown,
  prefix: string = "",
): string[] {
  if (Object.is(a, b)) return [];
  const out: string[] = [];

  const isObj = (v: unknown): v is Record<string, unknown> =>
    v !== null && typeof v === "object" && !Array.isArray(v);

  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      const childPath = prefix ? `${prefix}.${k}` : k;
      if (!(k in a) || !(k in b)) {
        out.push(childPath);
        continue;
      }
      out.push(...computeDeepDiff(a[k], b[k], childPath));
    }
    return out;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push(prefix || "[]");
      return out;
    }
    for (let i = 0; i < a.length; i++) {
      out.push(...computeDeepDiff(a[i], b[i], `${prefix}[${i}]`));
    }
    return out;
  }

  // Primitive or type mismatch.
  if (!deepValueEqual(a, b)) {
    out.push(prefix || "");
  }
  return out;
}

function deepValueEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepValueEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    if (ak.length !== Object.keys(bo).length) return false;
    for (const k of ak) {
      if (!(k in bo)) return false;
      if (!deepValueEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}

export function unionPaths(a: string[], b: string[]): string[] {
  const set = new Set<string>([...a, ...b]);
  return [...set];
}

/**
 * Walk an object schema and collect property paths whose `x-show-when`
 * evaluates `false` against the supplied value. Only top-level + nested
 * object-property paths are inspected (mirrors the frontend semantics).
 * Returns paths in dotted form (e.g. `details`, `nested.detail`).
 */
export function computeHiddenPaths(
  schema: unknown,
  value: unknown,
  prefix = "",
): string[] {
  if (
    !schema || typeof schema !== "object" || Array.isArray(schema) ||
    !value || typeof value !== "object" || Array.isArray(value)
  ) {
    return [];
  }
  const sch = schema as Record<string, unknown>;
  if (sch["type"] !== "object") return [];
  const props = sch["properties"];
  if (!props || typeof props !== "object") return [];
  const obj = value as Record<string, unknown>;
  const out: string[] = [];
  for (const [key, propSchema] of Object.entries(props as Record<string, unknown>)) {
    if (!propSchema || typeof propSchema !== "object") continue;
    const p = propSchema as Record<string, unknown>;
    const path = prefix ? `${prefix}.${key}` : key;
    const sw = p["x-show-when"];
    if (sw && typeof sw === "object" && !Array.isArray(sw)) {
      const cond = sw as Record<string, unknown>;
      const field = cond["field"];
      if (typeof field === "string") {
        const sibling = obj[field];
        let visible = true;
        if ("equals" in cond) visible = deepValueEqual(sibling, cond["equals"]);
        else if ("notEquals" in cond) {
          visible = !deepValueEqual(sibling, cond["notEquals"]);
        } else if ("in" in cond && Array.isArray(cond["in"])) {
          visible = (cond["in"] as unknown[]).some((v) =>
            deepValueEqual(sibling, v)
          );
        }
        if (!visible) {
          out.push(path);
          continue;
        }
      }
    }
    // Recurse into nested object schemas.
    if (p["type"] === "object" && key in obj) {
      out.push(...computeHiddenPaths(p, obj[key], path));
    }
  }
  return out;
}

/**
 * Filter out paths that are at or under any of the `hidden` paths.
 */
export function excludeHiddenFromDiff(
  diffPaths: string[],
  hidden: readonly string[],
): string[] {
  if (hidden.length === 0) return diffPaths;
  return diffPaths.filter((p) => !isPathInScope(p, hidden));
}

/**
 * Returns `true` when `errPath` is at or under any of the `scope` paths.
 * "Under" means: `errPath === scope` OR `errPath` starts with `scope` followed
 * by `.` or `[`.
 */
export function isPathInScope(errPath: string, scope: readonly string[]): boolean {
  for (const s of scope) {
    if (errPath === s) return true;
    if (
      errPath.length > s.length && errPath.startsWith(s) &&
      (errPath[s.length] === "." || errPath[s.length] === "[")
    ) return true;
  }
  return false;
}
