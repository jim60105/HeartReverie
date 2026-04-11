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

import { assertEquals } from "@std/assert";
import { compactContext } from "../../../plugins/context-compaction/compactor.ts";
import type { CompactionConfig } from "../../../plugins/context-compaction/config.ts";

const DEFAULT_CONFIG: CompactionConfig = { recentChapters: 3, enabled: true };

Deno.test("compactContext", async (t) => {
  await t.step("all three tiers present", () => {
    const previousContext = [
      "ch1 stripped", "ch2 stripped", "ch3 stripped",
      "ch4 stripped", "ch5 stripped",
      "ch6 stripped", "ch7 stripped", "ch8 stripped",
    ];
    const rawChapters = [
      "ch1 raw <chapter_summary>第 1 章：事件 A</chapter_summary>",
      "ch2 raw <chapter_summary>第 2 章：事件 B</chapter_summary>",
      "ch3 raw <chapter_summary>第 3 章：事件 C</chapter_summary>",
      "ch4 raw <chapter_summary>第 4 章：事件 D</chapter_summary>",
      "ch5 raw <chapter_summary>第 5 章：事件 E</chapter_summary>",
      "ch6 stripped",
      "ch7 stripped",
      "ch8 stripped",
    ];

    const result = compactContext(previousContext, rawChapters, DEFAULT_CONFIG);

    assertEquals(result.length, 4); // 1 story_summary + 3 L2
    assertEquals(
      result[0],
      "<story_summary>\n第 1 章：事件 A\n\n第 2 章：事件 B\n\n第 3 章：事件 C\n\n第 4 章：事件 D\n\n第 5 章：事件 E\n</story_summary>",
    );
    assertEquals(result[1], "ch6 stripped");
    assertEquals(result[2], "ch7 stripped");
    assertEquals(result[3], "ch8 stripped");
  });

  await t.step("no summaries available — fallback", () => {
    const previousContext = [
      "ch1 text", "ch2 text", "ch3 text", "ch4 text", "ch5 text",
    ];
    const rawChapters = [
      "ch1 raw no summary", "ch2 raw no summary",
      "ch3 raw no summary", "ch4 raw no summary", "ch5 raw no summary",
    ];

    const result = compactContext(previousContext, rawChapters, DEFAULT_CONFIG);

    // L1 fallback: ch1, ch2 kept as-is; L2: ch3, ch4, ch5
    assertEquals(result.length, 5);
    assertEquals(result[0], "ch1 text");
    assertEquals(result[1], "ch2 text");
    assertEquals(result[2], "ch3 text");
    assertEquals(result[3], "ch4 text");
    assertEquals(result[4], "ch5 text");
  });

  await t.step("partial summaries available", () => {
    const previousContext = [
      "ch1 stripped", "ch2 stripped", "ch3 stripped",
      "ch4 stripped", "ch5 stripped",
    ];
    const rawChapters = [
      "ch1 <chapter_summary>第 1 章：摘要</chapter_summary>",
      "ch2 no summary raw",
      "ch3 stripped",
      "ch4 stripped",
      "ch5 stripped",
    ];

    const result = compactContext(previousContext, rawChapters, DEFAULT_CONFIG);

    // L0: summary from ch1; L1 fallback: ch2; L2: ch3, ch4, ch5
    assertEquals(result.length, 5);
    assertEquals(result[0], "<story_summary>\n第 1 章：摘要\n</story_summary>");
    assertEquals(result[1], "ch2 stripped");
    assertEquals(result[2], "ch3 stripped");
    assertEquals(result[3], "ch4 stripped");
    assertEquals(result[4], "ch5 stripped");
  });

  await t.step("fewer chapters than L2 window — no compaction", () => {
    const previousContext = ["ch1 text", "ch2 text"];
    const rawChapters = [
      "ch1 <chapter_summary>摘要</chapter_summary>",
      "ch2 text",
    ];

    const result = compactContext(previousContext, rawChapters, DEFAULT_CONFIG);

    // Should return unchanged
    assertEquals(result, previousContext);
  });

  await t.step("exactly L2 window size — no compaction", () => {
    const previousContext = ["ch1 text", "ch2 text", "ch3 text"];
    const rawChapters = ["ch1 raw", "ch2 raw", "ch3 raw"];

    const result = compactContext(previousContext, rawChapters, DEFAULT_CONFIG);
    assertEquals(result, previousContext);
  });

  await t.step("custom recentChapters config", () => {
    const config: CompactionConfig = { recentChapters: 1, enabled: true };
    const previousContext = ["ch1 stripped", "ch2 stripped", "ch3 stripped"];
    const rawChapters = [
      "ch1 <chapter_summary>摘要 1</chapter_summary>",
      "ch2 <chapter_summary>摘要 2</chapter_summary>",
      "ch3 stripped",
    ];

    const result = compactContext(previousContext, rawChapters, config);

    assertEquals(result.length, 2); // 1 story_summary + 1 L2
    assertEquals(
      result[0],
      "<story_summary>\n摘要 1\n\n摘要 2\n</story_summary>",
    );
    assertEquals(result[1], "ch3 stripped");
  });

  await t.step("L0 concatenation preserves chronological order", () => {
    const previousContext = ["a", "b", "c", "d", "e"];
    const rawChapters = [
      "<chapter_summary>第 1 章</chapter_summary>",
      "<chapter_summary>第 2 章</chapter_summary>",
      "no summary",
      "d raw",
      "e raw",
    ];
    const config: CompactionConfig = { recentChapters: 2, enabled: true };

    const result = compactContext(previousContext, rawChapters, config);

    assertEquals(result[0], "<story_summary>\n第 1 章\n\n第 2 章\n</story_summary>");
    assertEquals(result[1], "c"); // fallback — no summary
    assertEquals(result[2], "d");
    assertEquals(result[3], "e");
  });
});
