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

import { extractChapterSummary } from "./extractor.ts";
import type { CompactionConfig } from "./config.ts";

/**
 * Apply tiered context compaction to the previousContext array.
 *
 * Three tiers:
 * - L0: Concatenated chapter summaries from L1-zone chapters, wrapped in `<story_summary>`.
 * - L1: Chapters outside the L2 window — replaced by their extracted summary if available,
 *        otherwise kept as full stripped text (fallback).
 * - L2: The most recent N chapters, kept as full stripped text.
 *
 * @param previousContext - Stripped chapter texts (tags already removed by stripPromptTags).
 * @param rawChapters - Raw (unstripped) chapter contents, same length and order as previousContext.
 * @param config - Compaction configuration.
 * @returns Modified previousContext array with tiered structure.
 */
export function compactContext(
  previousContext: string[],
  rawChapters: string[],
  config: CompactionConfig,
): string[] {
  const total = previousContext.length;

  // If story fits within L2 window, no compaction needed
  if (total <= config.recentChapters) {
    return previousContext;
  }

  const l2Start = total - config.recentChapters;

  // L2: recent chapters as-is (already stripped)
  const l2Chapters = previousContext.slice(l2Start);

  // Process L1 zone: extract summaries from raw chapters
  const l0Summaries: string[] = [];
  const l1Entries: string[] = [];

  for (let i = 0; i < l2Start; i++) {
    const rawChapter = rawChapters[i];
    const stripped = previousContext[i];
    if (!rawChapter || !stripped) continue;

    const summary = extractChapterSummary(rawChapter);
    if (summary) {
      l0Summaries.push(summary);
    } else {
      // No summary — keep full stripped text as fallback
      l1Entries.push(stripped);
    }
  }

  const result: string[] = [];

  // L0: concatenated summaries wrapped in <story_summary>
  if (l0Summaries.length > 0) {
    result.push(`<story_summary>\n${l0Summaries.join("\n\n")}\n</story_summary>`);
  }

  // L1 fallback entries (chapters without summaries)
  result.push(...l1Entries);

  // L2: recent chapters
  result.push(...l2Chapters);

  return result;
}
