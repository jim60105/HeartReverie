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
 * Capture the engine-written leading `<user_message>` envelope from a raw
 * chapter so `replace-last-chapter` mode can re-prepend it verbatim after the
 * LLM rewrites the prose.
 *
 * The `user-message` plugin's `pre-write` hook writes the block as the very
 * first bytes of a `write-new-chapter` file
 * (`<user_message>\n{msg}\n</user_message>\n\n{prose}`), so the canonical
 * location is byte 0. This helper preserves ONLY that leading block; a
 * `<user_message>` block that appears anywhere else is ordinary stripped
 * content and is not preserved.
 */

/**
 * Anchored, case-sensitive, non-greedy match for a leading `<user_message>`
 * block plus its bounded trailing separator.
 *
 * - `^` anchors at byte 0 (NO leading `^\s*`): we only ever preserve the
 *   engine's own leading envelope and never absorb pre-tag whitespace/BOM.
 * - `<user_message\b[^>]*>` matches the open tag (tolerating attributes),
 *   case-sensitive to the engine's lowercase emission.
 * - `[\s\S]*?` is the non-greedy body up to the first close tag.
 * - `(?:\r?\n){0,2}` captures AT MOST two trailing line breaks — exactly the
 *   `\n\n` separator the hook emits (tolerant of a single `\n` or CRLF) —
 *   instead of a greedy `\s*` that would swallow blank lines / indentation
 *   belonging to the prose body.
 */
const LEADING_USER_MESSAGE_RE = /^<user_message\b[^>]*>[\s\S]*?<\/user_message>(?:\r?\n){0,2}/;

/**
 * Return the leading `<user_message>…</user_message>` block (plus its bounded
 * trailing separator) from `raw`, or the empty string when there is no
 * matching block anchored at byte 0.
 *
 * The returned substring is intended to be re-prepended verbatim ahead of the
 * rewritten prose, so it is captured as opaque bytes and is never re-stripped,
 * re-wrapped, or transformed.
 *
 * Edge cases (all return `""`):
 * - no `<user_message>` block at all;
 * - an unterminated/malformed block (missing `</user_message>`);
 * - a block that appears only mid-body or is preceded by any other content
 *   (i.e. not at byte 0);
 * - an uppercase `<USER_MESSAGE>` block (capture is case-sensitive).
 *
 * @param raw The raw chapter file content.
 * @returns The captured leading block (with separator) or `""`.
 */
export function extractLeadingUserMessage(raw: string): string {
  const match = raw.match(LEADING_USER_MESSAGE_RE);
  return match ? match[0] : "";
}
