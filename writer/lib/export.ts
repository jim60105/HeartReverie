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

import type { StoryExportJson } from "../types.ts";

/** Chapter tuple consumed by all exporter renderers. */
export interface ExportChapter {
  readonly number: number;
  readonly content: string;
}

/**
 * Render a story as Markdown: one top-level heading naming the story, and
 * one `## Chapter N` heading per chapter, separated by blank lines.
 */
export function renderMarkdown(
  series: string,
  name: string,
  chapters: readonly ExportChapter[],
): string {
  const parts: string[] = [`# ${series} / ${name}`];
  for (const ch of chapters) {
    parts.push(`## Chapter ${ch.number}`);
    parts.push(ch.content.trim());
  }
  return parts.join("\n\n") + "\n";
}

/**
 * Render a story as a JSON string matching the `StoryExportJson` shape.
 * Chapters are assumed to be pre-sorted by ascending number.
 */
export function renderJson(
  series: string,
  name: string,
  chapters: readonly ExportChapter[],
): string {
  const payload: StoryExportJson = {
    series,
    name,
    exportedAt: new Date().toISOString(),
    chapters: chapters.map((ch) => ({ number: ch.number, content: ch.content })),
  };
  return JSON.stringify(payload, null, 2);
}

/**
 * Render a story as plain text: same structural layout as Markdown but with
 * Markdown syntax stripped from the chapter bodies (headings remain as plain
 * lines).
 */
export function renderPlainText(
  series: string,
  name: string,
  chapters: readonly ExportChapter[],
): string {
  const parts: string[] = [`${series} / ${name}`];
  for (const ch of chapters) {
    parts.push(`Chapter ${ch.number}`);
    parts.push(stripMarkdown(ch.content).trim());
  }
  return parts.join("\n\n") + "\n";
}

/**
 * Dependency-free Markdown → plain text transformation. Strips code fences,
 * inline code, emphasis markers, heading hashes, link/image syntax, raw HTML
 * tags, and blockquote markers. Preserves link/image alt text.
 */
export function stripMarkdown(text: string): string {
  let out = text;

  // Remove fenced code blocks (```lang ... ```), keep the inner content.
  out = out.replace(/```[^\n]*\n([\s\S]*?)```/g, "$1");

  // Remove raw HTML tags.
  out = out.replace(/<\/?[a-zA-Z][^>]*>/g, "");

  // Images: ![alt](url) → "" (drop image placeholder — alt is rarely useful
  // in plaintext and often empty).
  out = out.replace(/!\[([^\]]*)\]\([^)]*\)/g, "");

  // Links: [text](url) → text
  out = out.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

  // Strip inline code backticks.
  out = out.replace(/`+([^`]+)`+/g, "$1");

  // Strip leading heading markers (# ## ### etc.) from the start of a line.
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, "");

  // Strip blockquote markers.
  out = out.replace(/^\s{0,3}>\s?/gm, "");

  // Strip list markers (-, *, +) and numbered list markers at line starts.
  out = out.replace(/^\s{0,3}(?:[-*+]|\d+\.)\s+/gm, "");

  // Strip emphasis markers. Do bold (**/__) before single (*/_) to avoid
  // leaving stray underscores. Only match when delimiters are at word
  // boundaries to avoid corrupting prose like `foo_bar_baz` or `2 * 3 * 4`.
  out = out.replace(/\*\*(.+?)\*\*/g, "$1");
  out = out.replace(/(?<!\w)__(.+?)__(?!\w)/g, "$1");
  out = out.replace(/(?<!\w)\*([^*\n]+?)\*(?!\w)/g, "$1");
  out = out.replace(/(?<!\w)_([^_\n]+?)_(?!\w)/g, "$1");

  // Strip horizontal rules.
  out = out.replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, "");

  return out;
}

/**
 * Build an RFC 6266 / 5987 compliant `Content-Disposition` header value for
 * a story export download. Emits both an ASCII-safe `filename=` fallback and
 * a UTF-8 `filename*=` parameter so non-ASCII series/story names survive.
 */
export function buildContentDisposition(
  series: string,
  name: string,
  ext: "md" | "json" | "txt",
): string {
  const full = `${series}-${name}.${ext}`;
  const ascii = toAsciiFilename(full);
  const encoded = encodeRfc5987(full);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Replace non-ASCII/control/quote characters with `_` so the value is safe
 * to place inside a double-quoted `filename=` parameter.
 */
function toAsciiFilename(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0)!;
    if (code < 0x20 || code === 0x7f || code > 0x7e || ch === "\"" || ch === "\\") {
      out += "_";
    } else {
      out += ch;
    }
  }
  // Collapse runs of underscores and trim leading/trailing dots/spaces.
  out = out.replace(/_+/g, "_").replace(/^[.\s]+|[.\s]+$/g, "");
  return out.length > 0 ? out : "story-export";
}

/**
 * Percent-encode a UTF-8 string per RFC 5987 attr-char rules. `encodeURIComponent`
 * handles the bulk; we additionally escape the small set of characters that
 * are allowed by `encodeURIComponent` but forbidden in `attr-char`.
 */
function encodeRfc5987(input: string): string {
  return encodeURIComponent(input)
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
