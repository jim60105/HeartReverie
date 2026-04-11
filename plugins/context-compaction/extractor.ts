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

const TAG_REGEX = /<chapter_summary>([\s\S]*?)<\/chapter_summary>/i;

/**
 * Extract the content of the first `<chapter_summary>` tag from raw chapter text.
 * @param rawContent - The raw (unstripped) chapter content.
 * @returns The summary text (trimmed), or null if no tag is found.
 */
export function extractChapterSummary(rawContent: string): string | null {
  const match = rawContent.match(TAG_REGEX);
  if (!match || !match[1]) return null;
  const content = match[1].trim();
  return content.length > 0 ? content : null;
}
