// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Helpers shared by <SchemaField> and the page-level dirty-tracking logic.
// Kept as a separate .ts so it can be imported by both Vue SFCs and tests
// without forcing a circular .vue → .vue dependency.

import type { JsonSchema } from "@/lib/widget-registry";

export interface ShowWhenSpec {
  field: string;
  equals?: unknown;
  notEquals?: unknown;
  in?: unknown[];
}

// Path mini-grammar matches the server: `a.b[0].c`, `[0].name`, `a.b`, etc.
// We tokenise into "property names" or numeric indices.
type Token = { kind: "prop"; name: string } | { kind: "index"; idx: number };

export function tokenisePath(path: string): Token[] {
  if (!path) return [];
  const out: Token[] = [];
  // greedy: capture either `[N]` or a bare property segment delimited by `.` / `[`
  let i = 0;
  while (i < path.length) {
    if (path[i] === ".") {
      i += 1;
      continue;
    }
    if (path[i] === "[") {
      const end = path.indexOf("]", i + 1);
      if (end < 0) {
        // malformed — bail
        return out;
      }
      const raw = path.slice(i + 1, end);
      const idx = Number.parseInt(raw, 10);
      if (Number.isFinite(idx)) out.push({ kind: "index", idx });
      i = end + 1;
      continue;
    }
    // property — read until next `.` or `[`
    let j = i;
    while (j < path.length && path[j] !== "." && path[j] !== "[") j += 1;
    out.push({ kind: "prop", name: path.slice(i, j) });
    i = j;
  }
  return out;
}

export function getValueAtPath(root: unknown, path: string): unknown {
  const tokens = tokenisePath(path);
  let cur: unknown = root;
  for (const t of tokens) {
    if (cur === null || cur === undefined) return undefined;
    if (t.kind === "prop") {
      if (typeof cur !== "object" || Array.isArray(cur)) return undefined;
      cur = (cur as Record<string, unknown>)[t.name];
    } else {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[t.idx];
    }
  }
  return cur;
}

// Return the parent container path of a JSON-Pointer-ish path. Used to locate
// the sibling for an `x-show-when.field` reference.
export function parentPath(path: string): string {
  if (!path) return "";
  // Strip trailing `[N]` first
  const bracket = path.lastIndexOf("[");
  const dot = path.lastIndexOf(".");
  const cut = Math.max(bracket, dot);
  if (cut <= 0) return "";
  return path.slice(0, cut);
}

export function evaluateShowWhen(
  spec: unknown,
  fieldPath: string,
  rootModel: Record<string, unknown>,
): boolean {
  if (!spec || typeof spec !== "object") return true;
  const s = spec as Partial<ShowWhenSpec>;
  if (typeof s.field !== "string" || s.field.length === 0) return true;

  // sibling lookup: same parent container + named property
  const parent = parentPath(fieldPath);
  const siblingPath = parent ? `${parent}.${s.field}` : s.field;
  const sibling = getValueAtPath(rootModel, siblingPath);

  if (Object.prototype.hasOwnProperty.call(s, "equals")) {
    return deepEqual(sibling, s.equals);
  }
  if (Object.prototype.hasOwnProperty.call(s, "notEquals")) {
    return !deepEqual(sibling, s.notEquals);
  }
  if (Array.isArray(s.in)) {
    return s.in.some((candidate) => deepEqual(sibling, candidate));
  }
  // Malformed spec — fail safe and keep the field visible. Manifest-load-time
  // validation catches this server-side; this is just runtime defence.
  return true;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ak = Object.keys(a as object).sort();
    const bk = Object.keys(b as object).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i += 1) {
      if (ak[i] !== bk[i]) return false;
      const k = ak[i]!;
      if (
        !deepEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
        )
      ) {
        return false;
      }
    }
    return true;
  }
  return false;
}

/**
 * Given a root schema, a path inside the model, and the current root model,
 * determine whether the field at that path is currently hidden because some
 * ancestor evaluates `x-show-when` to false (or the field itself).
 *
 * Used by the page when constructing `_changedPaths` so hidden-field paths are
 * not added to the blocking scope. See conditional-field-visibility/spec.md.
 */
export function isPathHidden(
  rootSchema: JsonSchema,
  path: string,
  rootModel: Record<string, unknown>,
): boolean {
  const tokens = tokenisePath(path);
  let schema: JsonSchema = rootSchema;
  let currentPath = "";
  for (const t of tokens) {
    if (!schema || typeof schema !== "object") return false;
    if (t.kind === "prop") {
      const properties = schema["properties"];
      if (!properties || typeof properties !== "object") return false;
      const childSchema = (properties as Record<string, JsonSchema>)[t.name];
      if (!childSchema) return false;
      currentPath = currentPath ? `${currentPath}.${t.name}` : t.name;
      if (childSchema["x-show-when"]) {
        if (!evaluateShowWhen(childSchema["x-show-when"], currentPath, rootModel)) {
          return true;
        }
      }
      schema = childSchema;
    } else {
      const items = schema["items"];
      if (!items || typeof items !== "object") return false;
      currentPath = `${currentPath}[${t.idx}]`;
      schema = items as JsonSchema;
    }
  }
  return false;
}

/**
 * Compute the structural diff between two model snapshots, returning the list
 * of JSON-Pointer-ish paths that changed. Used by the page to derive
 * `_changedPaths`.
 */
export function diffPaths(
  before: unknown,
  after: unknown,
  basePath = "",
): string[] {
  const out: string[] = [];
  walkDiff(before, after, basePath, out);
  return out;
}

function walkDiff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (a === b) return;
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    if (Array.isArray(a) && Array.isArray(b)) {
      const len = Math.max(a.length, b.length);
      if (a.length !== b.length) {
        // length change is a change at the array itself
        out.push(path || "");
      }
      for (let i = 0; i < len; i += 1) {
        const childPath = path ? `${path}[${i}]` : `[${i}]`;
        walkDiff(a[i], b[i], childPath, out);
      }
      return;
    }
    if (!Array.isArray(a) && !Array.isArray(b)) {
      const ka = Object.keys(a as object);
      const kb = Object.keys(b as object);
      const all = new Set([...ka, ...kb]);
      for (const k of all) {
        const childPath = path ? `${path}.${k}` : k;
        walkDiff(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          childPath,
          out,
        );
      }
      return;
    }
  }
  out.push(path || "");
}
