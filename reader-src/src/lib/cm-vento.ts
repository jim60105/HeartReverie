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
 * CodeMirror 6 StreamLanguage for the Vento template syntax used by HeartReverie.
 * Provides token highlighting for `{{ ... }}`, `{{> ... }}`, `{{- ... -}}` and a
 * lint extension that maps backend diagnostics onto CodeMirror diagnostics.
 *
 * Forbidden keywords inside tag bodies — `set`, `/set`, `include` — are tokenised
 * as `tagName.error` so they render red even before the backend lint round-trip.
 */

import {
  StreamLanguage,
  LanguageSupport,
  HighlightStyle,
  type StreamParser,
} from "@codemirror/language";
import { linter, type Diagnostic as CmDiagnostic } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";
import type { Diagnostic } from "@/lib/template-api";

const FORBIDDEN_KEYWORDS = new Set(["set", "/set", "include"]);

export const VENTO_FORBIDDEN_HINT =
  "使用 `{{> include }}` 是不允許的；改用主模板具名變數、plugin promptFragments 或 getDynamicVariables() 注入內容";

interface VentoState {
  inTag: boolean;
  /** First non-whitespace token inside the current tag has been seen. */
  sawKeyword: boolean;
  /** Set when the tag opened with `{{>` — every identifier inside is forbidden. */
  isInclude: boolean;
}

function startState(): VentoState {
  return { inTag: false, sawKeyword: false, isInclude: false };
}

function copyState(s: VentoState): VentoState {
  return { inTag: s.inTag, sawKeyword: s.sawKeyword, isInclude: s.isInclude };
}

const parser: StreamParser<VentoState> = {
  name: "vento",
  startState,
  copyState,
  token(stream, state) {
    if (!state.inTag) {
      if (stream.match("{{>")) {
        state.inTag = true;
        state.sawKeyword = false;
        state.isInclude = true;
        return "tagName.error";
      }
      if (stream.match("{{-") || stream.match("{{")) {
        state.inTag = true;
        state.sawKeyword = false;
        state.isInclude = false;
        return "brace";
      }
      // Consume up to the next `{{`.
      while (!stream.eol()) {
        if (stream.peek() === "{" && (stream.string[stream.pos + 1] === "{")) {
          break;
        }
        stream.next();
      }
      return null;
    }
    // Inside a tag.
    if (stream.match("-}}") || stream.match("}}")) {
      state.inTag = false;
      state.sawKeyword = false;
      state.isInclude = false;
      return "brace";
    }
    if (stream.eatSpace()) return null;
    // String literal.
    if (stream.match(/^"([^"\\]|\\.)*"/) || stream.match(/^'([^'\\]|\\.)*'/)) {
      return "string";
    }
    // Pipe-filter operator.
    if (stream.match("|>")) {
      return "operator";
    }
    // Numeric literal.
    if (stream.match(/^[0-9][0-9_.]*/)) return "number";
    // Identifier / keyword.
    const m = stream.match(/^\/?[A-Za-z_$][\w$]*/) as RegExpMatchArray | null;
    if (m) {
      const tok = m[0];
      if (FORBIDDEN_KEYWORDS.has(tok) || state.isInclude) {
        state.sawKeyword = true;
        return "tagName.error";
      }
      if (!state.sawKeyword) {
        state.sawKeyword = true;
        return "keyword";
      }
      return "variableName";
    }
    stream.next();
    return null;
  },
};

export const ventoStreamLanguage = StreamLanguage.define(parser);

export function ventoLanguage(): LanguageSupport {
  return new LanguageSupport(ventoStreamLanguage);
}

/**
 * Theme-reactive syntax highlight for Vento templates.
 *
 * Colors resolve via CSS custom properties (`var(--...)`) so every active
 * theme — including ones loaded at runtime from `themes/*.toml` — restyles
 * the editor automatically without rebuilding the EditorView. Designed so
 * both light (`light.toml`) and dark (`default.toml`, `dark.toml`) palettes
 * remain legible without any CodeMirror reconfiguration on theme change.
 *
 * Token → token mapping mirrors the lexer in `parser.token()`:
 *   - `keyword`    → first identifier inside `{{ … }}` (e.g. `for`, `message`)
 *   - `string`     → "…" / '…' literals
 *   - `number`     → numeric literals
 *   - `operator`   → `|>` pipe-filter
 *   - `variableName` → non-keyword identifiers
 *   - `brace`      → `{{`, `}}`, `{{-`, `-}}`
 *   - `tagName` (error) → `{{> include }}` body and FORBIDDEN_KEYWORDS
 */
export const ventoHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "var(--text-label)", fontWeight: "600" },
  { tag: t.string, color: "var(--text-quote)" },
  { tag: t.number, color: "var(--accent-line)" },
  { tag: t.operator, color: "var(--text-name)" },
  { tag: t.variableName, color: "var(--text-name)" },
  { tag: t.brace, color: "var(--text-title)", fontWeight: "600" },
  { tag: t.comment, color: "var(--text-italic)", fontStyle: "italic" },
  // `tagName.error` is emitted for `{{> include }}` bodies. The host
  // component (`VentoCodeEditor.vue`) overlays underline-wavy styling on
  // `.cm-tagName-error` via a scoped rule; the color here is the
  // fallback used by CodeMirror's syntax-highlighting layer.
  { tag: t.tagName, color: "var(--accent-solid)", fontWeight: "600" },
]);

/** Convert a backend diagnostic to a CodeMirror 6 diagnostic. */
export function toCodeMirrorDiagnostic(
  view: EditorView,
  d: Diagnostic,
): CmDiagnostic {
  const doc = view.state.doc;
  const line = Math.max(1, Math.min(d.line || 1, doc.lines));
  const lineInfo = doc.line(line);
  const fromCol = Math.max(0, (d.column ?? 1) - 1);
  const from = Math.min(lineInfo.from + fromCol, lineInfo.to);
  let to = from + 1;
  if (typeof d.endLine === "number" && typeof d.endColumn === "number") {
    const eLine = Math.max(1, Math.min(d.endLine, doc.lines));
    const eLineInfo = doc.line(eLine);
    const eCol = Math.max(0, d.endColumn - 1);
    to = Math.min(eLineInfo.from + eCol, eLineInfo.to);
  } else {
    to = Math.min(lineInfo.to, from + 1);
  }
  if (to <= from) to = Math.min(lineInfo.to, from + 1);
  return {
    from,
    to,
    severity: d.severity === "error" ? "error" : d.severity === "warning" ? "warning" : "info",
    message: d.message + (
      d.ruleId === "vento.unsafe-expression" ? `\n${VENTO_FORBIDDEN_HINT}` : ""
    ),
    source: d.ruleId,
  };
}

/**
 * Build a CodeMirror lint extension backed by externally supplied diagnostics
 * (e.g. fetched from `POST /api/templates/lint`). The diagnostics getter is
 * polled by CodeMirror whenever the document changes; callers should update
 * the underlying ref + call `forceLinting(view)` after each backend round-trip.
 */
export function ventoLinter(
  getDiagnostics: () => Diagnostic[],
): ReturnType<typeof linter> {
  return linter((view) => {
    return getDiagnostics().map((d) => toCodeMirrorDiagnostic(view, d));
  }, { delay: 0 });
}
