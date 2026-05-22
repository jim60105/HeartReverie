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
 * Vento source-position helpers + the regex-based unknown-variable check.
 *
 * These were extracted from `template-lint.ts` so the lint pipeline
 * (`lintTemplate`) keeps focus on orchestration and severity policy while
 * this module owns the parse-error-shape decoding and the identifier
 * scan.
 *
 * Implementation note: ventojs@^2.3.1 does not expose a stable AST
 * walker, so `checkUnknownVariables` scans the source text for `{{ … }}`
 * tag bodies and extracts identifier tokens. False positives are
 * acceptable since the diagnostic is `warning` severity and never blocks
 * save.
 */

import type { Template as VentoTemplate } from "ventojs/core/environment";
import type { Diagnostic, VariableRef } from "./template-lint.ts";

/** Vento keywords that AST identifier walking should never flag as unknown vars. */
const VENTO_KEYWORDS: ReadonlySet<string> = new Set([
  "for",
  "of",
  "if",
  "else",
  "message",
  "echo",
  "true",
  "false",
  "null",
  "undefined",
  "set",
  "include",
  "__messageState",
]);

/**
 * Map a Vento `SourceError.message` containing a `multi-message:nested` /
 * `multi-message:invalid-role` tag to the corresponding lint diagnostic
 * ruleId. Returns `null` when the message has no recognised multi-message
 * tag (caller should fall back to `vento.parse-error`).
 */
export function multiMessageRuleId(message: string): string | null {
  if (message.includes("multi-message:nested")) return "vento.message-nested";
  if (message.includes("multi-message:invalid-role")) {
    return "vento.message-invalid-role";
  }
  return null;
}

/** Extract 1-based line/column from a Vento SourceError. */
export function positionFromError(
  err: unknown,
  source: string,
): { line: number; column: number } {
  const e = err as
    | { position?: number; line?: number; column?: number }
    | null;
  if (e && typeof e.line === "number" && typeof e.column === "number") {
    return { line: Math.max(1, e.line), column: Math.max(1, e.column) };
  }
  if (e && typeof e.position === "number") {
    return positionFromOffset(source, e.position);
  }
  return { line: 1, column: 1 };
}

export function positionFromOffset(
  source: string,
  offset: number,
): { line: number; column: number } {
  if (offset < 0) return { line: 1, column: 1 };
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else col++;
  }
  return { line, column: col };
}

/**
 * Walk a compiled Vento template AST identifier set and emit
 * `vento.unknown-variable` warnings for any reference not present in the
 * catalog. See module-level comment for the false-positive policy.
 */
export function checkUnknownVariables(
  ast: VentoTemplate,
  source: string,
  catalog: ReadonlyArray<VariableRef>,
): Diagnostic[] {
  const known = new Set<string>([
    ...catalog.map((v) => v.name),
    ...VENTO_KEYWORDS,
  ]);

  // Collect for-of binders from the source itself (cheap, no AST needed):
  // pattern: {{ for <ident> of <iter> }}
  const binderRe = /\{\{\s*for\s+([a-zA-Z_]\w*)\s+of\s+([a-zA-Z_]\w*)/g;
  let binderMatch: RegExpExecArray | null;
  while ((binderMatch = binderRe.exec(source)) !== null) {
    known.add(binderMatch[1]!);
  }

  // Walk every tag body — only simple-identifier tokens count. Pipe filters
  // RHS are already captured as known via VENTO_HELPERS in the catalog.
  const tagRe = /\{\{([\s\S]*?)\}\}/g;
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(source)) !== null) {
    const raw = m[1]!.trim();
    if (!raw || raw.startsWith("#")) continue;
    if (raw === "else" || /^\/(for|if|message)$/.test(raw)) continue;

    // Strip string literals (single and double quoted) before identifier
    // extraction so e.g. `{{ message "user" }}` does not flag `user` as
    // unknown. Vento string syntax matches JS-style quoting.
    const expr = raw
      .replace(/"(?:[^"\\]|\\.)*"/g, "")
      .replace(/'(?:[^'\\]|\\.)*'/g, "");

    const idents = expr.match(/\b[A-Za-z_]\w*\b/g) ?? [];
    for (const id of idents) {
      if (known.has(id) || VENTO_KEYWORDS.has(id)) continue;
      if (id.startsWith("__")) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const offset = m.index + m[0].indexOf(id);
      const pos = positionFromOffset(source, offset);
      diagnostics.push({
        ruleId: "vento.unknown-variable",
        severity: "warning",
        line: pos.line,
        column: pos.column,
        message: `Unknown variable: ${id}`,
      });
    }
  }
  // unused parameter — `ast` accepted for future AST-based replacement
  void ast;
  return diagnostics;
}
