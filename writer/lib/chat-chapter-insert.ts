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
 * @module chat-chapter-insert
 *
 * Pure helpers for the engine `insert-into-chapter` write mode:
 *  - {@link parseInsertEnvelope} — normalise + parse the accumulated LLM
 *    response into a validated insertion envelope (one outer code-fence strip,
 *    strict shape; no heuristic scavenging).
 *  - {@link resolveInsertions} — resolve each `insertAfterParagraph` against
 *    the canonical paragraph segmentation into a raw-string byte offset.
 *  - {@link applyInsertions} — splice every `text` byte-for-byte into the raw
 *    chapter snapshot, applying descending by offset so earlier splices don't
 *    shift later ones, grouping same-offset insertions in array order.
 *
 * Parsing/validation failures throw `ChatError("insert-invalid-payload", 422)`;
 * out-of-range indices throw `ChatError("insert-out-of-range", 422)`. The
 * caller MUST NOT write the chapter when either throws.
 */

import { ChatError } from "./chat-types.ts";
import type { ChapterParagraph } from "./chapter-paragraphs.ts";

/** A single validated insertion entry from the JSON envelope. */
export interface InsertionEntry {
  readonly insertAfterParagraph: number;
  readonly text: string;
}

/**
 * Normalise + parse the accumulated LLM response into a validated insertion
 * envelope. Normalisation: (1) `trim()`; (2) strip at most ONE surrounding
 * Markdown code fence (```` ```json … ``` ```` or ```` ``` … ``` ````) when the
 * trimmed content begins with a fence and ends with a closing fence; (3)
 * `JSON.parse`. The parsed value MUST be an object with an `insertions` array
 * whose every element is `{ insertAfterParagraph: safe-non-negative-int,
 * text: non-empty-string }`. Throws `ChatError("insert-invalid-payload", 422)`
 * on any violation. No heuristic scavenging beyond the single-fence strip.
 */
export function parseInsertEnvelope(accumulated: string): InsertionEntry[] {
  const trimmed = accumulated.trim();
  const unfenced = stripOuterFence(trimmed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(unfenced);
  } catch {
    throw new ChatError(
      "insert-invalid-payload",
      "insert response is not valid JSON",
      422,
    );
  }

  if (
    parsed === null || typeof parsed !== "object" || Array.isArray(parsed) ||
    !Array.isArray((parsed as { insertions?: unknown }).insertions)
  ) {
    throw new ChatError(
      "insert-invalid-payload",
      "insert response must be an object with an 'insertions' array",
      422,
    );
  }

  const rawInsertions = (parsed as { insertions: unknown[] }).insertions;
  const entries: InsertionEntry[] = [];
  for (const el of rawInsertions) {
    if (el === null || typeof el !== "object" || Array.isArray(el)) {
      throw new ChatError(
        "insert-invalid-payload",
        "each insertion must be an object",
        422,
      );
    }
    const obj = el as { insertAfterParagraph?: unknown; text?: unknown };
    const idx = obj.insertAfterParagraph;
    const text = obj.text;
    if (
      typeof idx !== "number" || !Number.isSafeInteger(idx) || idx < 0
    ) {
      throw new ChatError(
        "insert-invalid-payload",
        "insertAfterParagraph must be a safe non-negative integer",
        422,
      );
    }
    if (typeof text !== "string" || text.length === 0) {
      throw new ChatError(
        "insert-invalid-payload",
        "text must be a non-empty string",
        422,
      );
    }
    entries.push({ insertAfterParagraph: idx, text });
  }
  return entries;
}

/** Strip at most one outer Markdown code fence from `trimmed`. */
function stripOuterFence(trimmed: string): string {
  if (!trimmed.startsWith("```")) return trimmed;
  // Opening fence with payload on the NEXT line (the common case):
  //   ```json\n{ … }\n```
  const multiLine = trimmed.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (multiLine) return (multiLine[1] ?? "").trim();
  // Opening fence with payload on the SAME line (e.g. ```json { … } ``` or
  // ```{ … }```). Strip the leading fence (plus an optional info word that
  // does NOT start the JSON payload, i.e. a run of letters before whitespace)
  // and the trailing fence.
  if (trimmed.endsWith("```")) {
    let inner = trimmed.slice(3, -3); // drop the two fences
    // Drop an optional leading info word like `json` (letters only), then
    // surrounding whitespace.
    inner = inner.replace(/^[A-Za-z]+(?=\s)/, "").trim();
    return inner;
  }
  return trimmed;
}

/** A resolved insertion: raw-string offset + the byte-for-byte text. */
export interface ResolvedInsertion {
  /** Raw-string offset where the text's paragraph block is spliced. */
  readonly offset: number;
  /** Position in the original `insertions` array (for stable grouping). */
  readonly order: number;
  readonly text: string;
}

/**
 * Resolve every `insertAfterParagraph` against the canonical paragraph
 * segmentation into a raw-string offset.
 *
 * - `K` in `1..count` → paragraph `K`'s `end` offset.
 * - `K === 0` → the raw `start` offset of visible paragraph 1; for a
 *   zero-paragraph chapter, offset 0.
 * - `K < 0` or `K > count` → throws `ChatError("insert-out-of-range", 422)`.
 *
 * Throws BEFORE any write so the whole run aborts atomically.
 */
export function resolveInsertions(
  entries: readonly InsertionEntry[],
  paragraphs: readonly ChapterParagraph[],
): ResolvedInsertion[] {
  const count = paragraphs.length;
  const resolved: ResolvedInsertion[] = [];
  let order = 0;
  for (const entry of entries) {
    const k = entry.insertAfterParagraph;
    if (k < 0 || k > count) {
      throw new ChatError(
        "insert-out-of-range",
        `insertAfterParagraph ${k} is outside the valid range 0..${count}`,
        422,
      );
    }
    let offset: number;
    if (k === 0) {
      offset = count === 0 ? 0 : paragraphs[0]!.start;
    } else {
      offset = paragraphs[k - 1]!.end;
    }
    resolved.push({ offset, order: order++, text: entry.text });
  }
  return resolved;
}

/**
 * Splice every resolved insertion into `rawSnapshot` byte-for-byte.
 *
 * Application order: insertions are grouped by resolved offset and applied
 * descending by offset (so earlier splices don't shift later offsets).
 * Same-offset insertions keep their original array order (NOT reversed) and
 * are concatenated, each as its own paragraph block, before a single splice
 * at that offset.
 *
 * Each spliced chunk is wrapped with outer blank-line separators so it is its
 * own Markdown paragraph; the join is collapsed so no more than two
 * consecutive newlines appear at either boundary. The `text` bytes themselves
 * are never trimmed or newline-normalised internally.
 */
export function applyInsertions(
  rawSnapshot: string,
  resolved: readonly ResolvedInsertion[],
): string {
  if (resolved.length === 0) return rawSnapshot;

  // Group by offset, preserving array order within each group.
  const byOffset = new Map<number, ResolvedInsertion[]>();
  for (const r of resolved) {
    const arr = byOffset.get(r.offset);
    if (arr) arr.push(r);
    else byOffset.set(r.offset, [r]);
  }
  for (const arr of byOffset.values()) {
    arr.sort((a, b) => a.order - b.order);
  }

  // Apply groups descending by offset so earlier splices don't shift later.
  const offsets = Array.from(byOffset.keys()).sort((a, b) => b - a);
  let result = rawSnapshot;
  for (const offset of offsets) {
    const group = byOffset.get(offset)!;
    // Concatenate same-offset texts, each as its own paragraph block.
    const chunk = group.map((g) => g.text).join("\n\n");
    result = spliceAt(result, offset, chunk);
  }
  return result;
}

/**
 * Splice `chunk` into `content` at `offset` as its own paragraph block,
 * adding outer blank-line separators while collapsing the boundary so no more
 * than two consecutive line breaks appear at either join. `chunk` itself is
 * left byte-for-byte intact.
 *
 * Line-break detection is CRLF-aware: a run of trailing/leading `\r\n` or `\n`
 * sequences is counted as line breaks so a Windows-style chapter keeps a clean
 * blank-line separator instead of a mixed `\r\n\n` join. Added separators use
 * plain `\n` (the canonical separator the rest of the engine writes); only the
 * inserted chunk's own bytes are preserved verbatim.
 */
function spliceAt(content: string, offset: number, chunk: string): string {
  const before = content.slice(0, offset);
  const after = content.slice(offset);

  // Count the number of line breaks in the trailing run of `before` and the
  // leading run of `after`, treating `\r\n` and `\n` each as ONE line break.
  const trailingBreaks = countTrailingLineBreaks(before);
  const leadingBreaks = countLeadingLineBreaks(after);

  // We want exactly one blank line (two line breaks) at each join. When the
  // adjacent text is empty (offset 0 / end of file) we add no separator.
  const lead = before.length === 0 ? "" : "\n".repeat(Math.max(0, 2 - trailingBreaks));
  const trail = after.length === 0 ? "" : "\n".repeat(Math.max(0, 2 - leadingBreaks));

  return before + lead + chunk + trail + after;
}

/** Count trailing `\r\n`/`\n` line breaks (CRLF counts as one). */
function countTrailingLineBreaks(s: string): number {
  const m = s.match(/(?:\r?\n)+$/);
  return m ? (m[0].match(/\n/g)?.length ?? 0) : 0;
}

/** Count leading `\r\n`/`\n` line breaks (CRLF counts as one). */
function countLeadingLineBreaks(s: string): number {
  const m = s.match(/^(?:\r?\n)+/);
  return m ? (m[0].match(/\n/g)?.length ?? 0) : 0;
}
