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
import { extractChapterSummary } from "../../../plugins/context-compaction/extractor.ts";

Deno.test("extractChapterSummary", async (t) => {
  await t.step("extracts summary from valid tag", () => {
    const raw = `故事內容...\n<chapter_summary>\n第 1 章：事件摘要\n</chapter_summary>`;
    assertEquals(extractChapterSummary(raw), "第 1 章：事件摘要");
  });

  await t.step("returns null when no tag present", () => {
    const raw = "這是一段沒有摘要標籤的故事內容。";
    assertEquals(extractChapterSummary(raw), null);
  });

  await t.step("extracts first tag when multiple exist", () => {
    const raw = `<chapter_summary>第一段</chapter_summary>\n其他\n<chapter_summary>第二段</chapter_summary>`;
    assertEquals(extractChapterSummary(raw), "第一段");
  });

  await t.step("returns null for empty tag", () => {
    const raw = `故事\n<chapter_summary>\n  \n</chapter_summary>`;
    assertEquals(extractChapterSummary(raw), null);
  });

  await t.step("handles case-insensitive tags", () => {
    const raw = `內容\n<Chapter_Summary>混合大小寫</Chapter_Summary>`;
    assertEquals(extractChapterSummary(raw), "混合大小寫");
  });

  await t.step("handles multiline summary", () => {
    const raw = `故事\n<chapter_summary>\n第 5 章：角色 A 離開。\n伏筆：信件內容不明。\n</chapter_summary>`;
    assertEquals(extractChapterSummary(raw), "第 5 章：角色 A 離開。\n伏筆：信件內容不明。");
  });

  await t.step("returns null for malformed tag (no closing)", () => {
    const raw = `故事\n<chapter_summary>沒有結尾標籤`;
    assertEquals(extractChapterSummary(raw), null);
  });
});
