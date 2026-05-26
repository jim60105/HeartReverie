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
 * CodeMirror 6 completion source for Vento templates. Two trigger sites:
 *
 *  • After `|>`  → list every entry of `VENTO_HELPERS` with a short doc.
 *  • After `{{` or `{{-` (in tag opening context) → list the variable catalog
 *    passed in by the caller, each entry attributed to its source
 *    (core / lore / plugin-fragment / plugin-dynamic / vento-helper).
 */

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import { VENTO_HELPERS, type VentoHelper } from "@/lib/template";
import type { VariableEntry } from "@/lib/template-api";

const HELPER_DOCS: Record<VentoHelper, string> = {
  empty: "若值為 null/undefined/空字串/空陣列/空物件則回傳指定預設值，否則回傳原值。",
  escape: "將值轉換為 HTML 實體（&、<、>、\"、' → &amp; 等）。",
  unescape: "將 HTML 實體還原為原始字元。",
};

const SOURCE_BADGE: Record<VariableEntry["source"], string> = {
  "core": "core",
  "lore": "lore",
  "plugin-fragment": "plugin-fragment",
  "plugin-dynamic": "plugin-dynamic",
  "plugin-parameter": "plugin-parameter",
  "vento-helper": "vento-helper",
};

function helperCompletions(): Completion[] {
  return VENTO_HELPERS.map((name) => ({
    label: name,
    type: "function",
    detail: "vento-helper",
    info: HELPER_DOCS[name],
    boost: 50,
  }));
}

function variableCompletions(catalog: VariableEntry[]): Completion[] {
  return catalog.map((v) => {
    const badge = SOURCE_BADGE[v.source] ?? v.source;
    return {
      label: v.name,
      type: v.source === "vento-helper" ? "function" : "variable",
      detail: v.pluginName ? `${badge} · ${v.pluginName}` : badge,
      info: v.description ?? (v.type ? `type: ${v.type}` : undefined),
    } satisfies Completion;
  });
}

/**
 * Build a `CompletionSource` that reads the latest variable catalog from
 * a getter (so the editor can swap the catalog on file selection without
 * rebuilding the entire `EditorState`).
 */
export function ventoCompletionSource(
  getVariables: () => VariableEntry[],
): CompletionSource {
  return (ctx: CompletionContext): CompletionResult | null => {
    const lineText = ctx.state.doc.lineAt(ctx.pos).text;
    const colInLine = ctx.pos - ctx.state.doc.lineAt(ctx.pos).from;
    const before = lineText.slice(0, colInLine);
    // Pipe-filter context: last `|>` after the most-recent `{{`.
    const lastOpen = before.lastIndexOf("{{");
    const lastClose = before.lastIndexOf("}}");
    const inTag = lastOpen > lastClose;
    if (!inTag) return null;

    const tagSlice = before.slice(lastOpen);
    const pipeIdx = tagSlice.lastIndexOf("|>");
    if (pipeIdx >= 0) {
      // Match identifier prefix after `|>` (allow whitespace then word chars).
      const after = tagSlice.slice(pipeIdx + 2);
      const m = /([A-Za-z_$][\w$]*)?$/.exec(after);
      const word = m ? m[1] ?? "" : "";
      const from = ctx.pos - word.length;
      if (!ctx.explicit && word.length === 0) return null;
      return {
        from,
        options: helperCompletions(),
        validFor: /^[\w$]*$/,
      };
    }

    // Variable context: typed identifier prefix after `{{` or `{{-`.
    const afterOpen = tagSlice.replace(/^\{\{-?\s*/, "");
    const m = /([A-Za-z_$][\w$]*)?$/.exec(afterOpen);
    const word = m ? m[1] ?? "" : "";
    if (!ctx.explicit && word.length === 0 && !/\{\{-?\s*$/.test(before)) {
      return null;
    }
    const from = ctx.pos - word.length;
    return {
      from,
      options: variableCompletions(getVariables()),
      validFor: /^[\w$]*$/,
    };
  };
}

export function ventoCompletions(
  getVariables: () => VariableEntry[],
): ReturnType<typeof autocompletion> {
  return autocompletion({
    override: [ventoCompletionSource(getVariables)],
    activateOnTyping: true,
    closeOnBlur: true,
  });
}
