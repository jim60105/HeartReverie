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
 * @module chapter-paragraphs
 *
 * Canonical paragraph-segmentation model for the engine `insert` write mode.
 * This module is the SINGLE source of truth shared by both the
 * `numbered_paragraphs` reserved Vento variable and `insertAfterParagraph`
 * resolution, so the paragraph index the LLM is shown maps deterministically
 * to the byte offset the splice resolves against.
 *
 * Core trick (length-preserving mask): chapter prose is numbered on a
 * **position-preserving masked view** of the RAW content. Every span matched
 * by the combined `promptStripTags` patterns is replaced with whitespace of
 * IDENTICAL byte length (newlines preserved), so the masked view is the same
 * length as the raw string and every offset in the mask corresponds 1:1 to
 * the same offset in the raw string. Segmentation runs on the mask; the
 * returned `start`/`end` offsets therefore index the ORIGINAL raw string
 * directly (slicing the raw string by `[start, end)` yields that paragraph's
 * raw source span). An "after paragraph N" splice uses paragraph N's `end`
 * offset, which by construction lands in the inter-paragraph gap — never
 * inside a stripped span between paragraphs.
 */

/** A numbered chapter paragraph with raw-string offsets. */
export interface ChapterParagraph {
  /** 1-based sequence number. */
  readonly index: number;
  /** Trimmed visible text (sourced from the masked view; stripped markup absent). */
  readonly text: string;
  /** Inclusive start offset into the RAW chapter string. */
  readonly start: number;
  /** Exclusive end offset into the RAW chapter string. */
  readonly end: number;
}

/**
 * Build a length-preserving masked view of `rawContent`: every span matched
 * by `stripRegex` is replaced with whitespace of identical byte length, with
 * newlines (`\n`) preserved as newlines so the line structure (and thus
 * blank-line paragraph boundaries) is unchanged. The returned string has the
 * SAME length (and SAME UTF-16 code-unit count) as `rawContent`.
 *
 * `stripRegex` MUST be a global RegExp (the engine's `getStripTagPatterns()`
 * returns a `/.../gi` pattern). When `null`, the raw content is returned
 * unchanged (it is already its own mask).
 */
export function buildMaskedView(
  rawContent: string,
  stripRegex: RegExp | null,
): string {
  if (stripRegex === null) return rawContent;
  // Defensive: operate on a fresh global clone so we never mutate the
  // caller's lastIndex and always sweep the whole string.
  const flags = stripRegex.flags.includes("g") ? stripRegex.flags : stripRegex.flags + "g";
  const re = new RegExp(stripRegex.source, flags);
  let result = "";
  let cursor = 0;
  for (const match of rawContent.matchAll(re)) {
    const start = match.index;
    const matched = match[0];
    if (matched.length === 0) continue; // avoid zero-width infinite scan
    result += rawContent.slice(cursor, start);
    // Replace each UTF-16 code UNIT of the match with a space, EXCEPT newlines
    // which stay newlines so line structure (blank-line boundaries) is
    // preserved. We iterate by index (NOT `for..of`, which iterates by code
    // POINT and would emit one space for an astral character that occupies two
    // UTF-16 units — shifting every downstream offset and breaking the
    // length-preservation invariant the raw-offset mapping depends on).
    for (let i = 0; i < matched.length; i++) {
      const ch = matched[i];
      result += ch === "\n" ? "\n" : ch === "\r" ? "\r" : " ";
    }
    cursor = start + matched.length;
  }
  result += rawContent.slice(cursor);
  return result;
}

/**
 * Segment a chapter into numbered paragraphs using the canonical model.
 *
 * @param rawContent The RAW (unscrubbed) highest-numbered chapter content.
 * @param stripRegex The engine's combined prompt strip-tag regex (or `null`).
 * @returns The numbered paragraphs (1-based) with offsets that index
 *          `rawContent` directly. A chapter whose masked content has no
 *          non-empty paragraphs yields an empty list (count 0).
 */
export function splitChapterParagraphs(
  rawContent: string,
  stripRegex: RegExp | null,
): ChapterParagraph[] {
  const masked = buildMaskedView(rawContent, stripRegex);
  const paragraphs: ChapterParagraph[] = [];

  // Split on runs of two-or-more newlines (blank-line-delimited), treating
  // CRLF as a newline. We compute offsets manually so they index the raw
  // string. The separator regex matches a run that contains at least two
  // line breaks (a blank line between paragraphs).
  const sepRe = /(?:\r?\n[ \t]*){2,}/g;
  let segStart = 0;
  let m: RegExpExecArray | null;
  const pushSegment = (start: number, end: number): void => {
    // `start`/`end` bound a candidate segment in the masked view (== raw
    // offsets). Compute the trimmed visible text from the mask.
    const maskedSlice = masked.slice(start, end);
    const trimmedText = maskedSlice.trim();
    if (trimmedText.length === 0) return; // stripped-only / whitespace-only
    // Tighten offsets to the trimmed visible span so `start`/`end` bound the
    // visible text exactly (leading/trailing whitespace excluded). This keeps
    // the "after paragraph N" splice point right after the visible prose.
    const leading = maskedSlice.length - maskedSlice.trimStart().length;
    const trailing = maskedSlice.length - maskedSlice.trimEnd().length;
    paragraphs.push({
      index: paragraphs.length + 1,
      text: trimmedText,
      start: start + leading,
      end: end - trailing,
    });
  };

  while ((m = sepRe.exec(masked)) !== null) {
    pushSegment(segStart, m.index);
    segStart = m.index + m[0].length;
    if (m[0].length === 0) sepRe.lastIndex++; // safety against zero-width
  }
  pushSegment(segStart, masked.length);

  return paragraphs;
}

/**
 * Render the `numbered_paragraphs` reserved-variable string from the canonical
 * segmentation: one entry per paragraph, formatted with its 1-based sequence
 * number and its display text, entries separated by a blank line. Returns the
 * empty string for a zero-paragraph chapter.
 */
export function renderNumberedParagraphs(
  paragraphs: readonly ChapterParagraph[],
): string {
  return paragraphs
    .map((p) => `「${p.index}」 ${p.text}`)
    .join("\n\n");
}
