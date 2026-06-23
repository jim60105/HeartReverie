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
import {
  buildMaskedView,
  renderNumberedParagraphs,
  splitChapterParagraphs,
} from "../../../writer/lib/chapter-paragraphs.ts";

/** Strip regex matching the codebase's `getStripTagPatterns()` shape. */
function stripFor(...tags: string[]): RegExp {
  const src = tags.map((t) => `<${t}>[\\s\\S]*?</${t}>`).join("|");
  return new RegExp(src, "gi");
}

Deno.test("splitChapterParagraphs", async (t) => {
  await t.step("blank-line-delimited paragraphs are numbered 1..N", () => {
    const raw = "段落一。\n\n段落二。\n\n段落三。";
    const paras = splitChapterParagraphs(raw, null);
    assertEquals(paras.map((p) => p.index), [1, 2, 3]);
    assertEquals(paras.map((p) => p.text), ["段落一。", "段落二。", "段落三。"]);
  });

  await t.step("raw offsets address the original string", () => {
    const raw = "段落一。\n\n段落二。\n\n段落三。";
    const paras = splitChapterParagraphs(raw, null);
    for (const p of paras) {
      assertEquals(raw.slice(p.start, p.end), p.text);
    }
  });

  await t.step("stripped tags are excluded from numbering", () => {
    const raw = "<user_message>玩家輸入</user_message>\n\n正文段落。";
    const strip = stripFor("user_message");
    const paras = splitChapterParagraphs(raw, strip);
    assertEquals(paras.length, 1);
    assertEquals(paras[0]!.text, "正文段落。");
    assertEquals(paras[0]!.index, 1);
    // Raw offset still indexes the raw string.
    assertEquals(raw.slice(paras[0]!.start, paras[0]!.end), "正文段落。");
  });

  await t.step(
    "stripped tag between two paragraphs does not merge or split them",
    () => {
      const raw = "第一段。\n\n<image>### a ###</image>\n\n第二段。";
      const strip = stripFor("image");
      const paras = splitChapterParagraphs(raw, strip);
      assertEquals(paras.length, 2);
      assertEquals(paras.map((p) => p.text), ["第一段。", "第二段。"]);
      // insertAfterParagraph:1 → paragraph 1's end offset → right after 第一段。
      const p1End = paras[0]!.end;
      assertEquals(raw.slice(0, p1End), "第一段。");
      // The end offset is BEFORE the masked image region (in the gap).
      assertEquals(raw.slice(p1End).startsWith("\n\n<image>"), true);
    },
  );

  await t.step("mask preserves length so raw offsets are exact", () => {
    const raw = "前言\n\n<image>### body\nwith newline ###</image>\n\n結語";
    const strip = stripFor("image");
    const masked = buildMaskedView(raw, strip);
    assertEquals(masked.length, raw.length);
    const paras = splitChapterParagraphs(raw, strip);
    for (const p of paras) {
      assertEquals(raw.slice(p.start, p.end), p.text);
    }
  });

  await t.step("stripped tag before paragraph 1 (K=0 lands after it)", () => {
    const raw = "<imgthink>hidden</imgthink>\n\n第一段。";
    const strip = stripFor("imgthink");
    const paras = splitChapterParagraphs(raw, strip);
    assertEquals(paras.length, 1);
    // start offset of visible paragraph 1 is AFTER the stripped block.
    assertEquals(paras[0]!.start > 0, true);
    assertEquals(raw.slice(paras[0]!.start, paras[0]!.end), "第一段。");
  });

  await t.step("leading/trailing blank lines do not create empty paragraphs", () => {
    const raw = "\n\n  \n第一段。\n\n\n\n第二段。\n\n";
    const paras = splitChapterParagraphs(raw, null);
    assertEquals(paras.length, 2);
    assertEquals(paras.map((p) => p.text), ["第一段。", "第二段。"]);
  });

  await t.step("astral char inside stripped span preserves mask length + offsets", () => {
    // 😀 is a surrogate pair (2 UTF-16 units). The mask MUST emit 2 spaces,
    // not 1, or downstream offsets drift.
    const raw = "<imgthink>😀 hidden 🎨</imgthink>\n\n第一段。\n\n第二段。";
    const strip = stripFor("imgthink");
    const masked = buildMaskedView(raw, strip);
    assertEquals(masked.length, raw.length, "mask length == raw length");
    const paras = splitChapterParagraphs(raw, strip);
    assertEquals(paras.length, 2);
    for (const p of paras) {
      assertEquals(raw.slice(p.start, p.end), p.text);
    }
    assertEquals(paras[0]!.text, "第一段。");
  });

  await t.step("CRLF line endings are handled", () => {
    const raw = "第一段。\r\n\r\n第二段。";
    const paras = splitChapterParagraphs(raw, null);
    assertEquals(paras.length, 2);
    assertEquals(paras.map((p) => p.text), ["第一段。", "第二段。"]);
    for (const p of paras) {
      assertEquals(raw.slice(p.start, p.end), p.text);
    }
  });

  await t.step("empty chapter yields zero paragraphs", () => {
    assertEquals(splitChapterParagraphs("", null).length, 0);
    assertEquals(splitChapterParagraphs("   \n\n  \n", null).length, 0);
  });

  await t.step("whitespace-only after strip yields zero paragraphs", () => {
    const raw = "<image>### x ###</image>";
    const strip = stripFor("image");
    assertEquals(splitChapterParagraphs(raw, strip).length, 0);
  });

  await t.step("insertAfterParagraph: N resolves to paragraph N's end offset", () => {
    const raw = "甲。\n\n乙。\n\n丙。\n\n丁。";
    const paras = splitChapterParagraphs(raw, null);
    assertEquals(paras.length, 4);
    // Paragraph 2's end is right after "乙。".
    assertEquals(raw.slice(0, paras[1]!.end), "甲。\n\n乙。");
  });
});

Deno.test("renderNumberedParagraphs", async (t) => {
  await t.step("formats sequence numbers and text, blank-line separated", () => {
    const raw = "甲。\n\n乙。";
    const paras = splitChapterParagraphs(raw, null);
    const rendered = renderNumberedParagraphs(paras);
    assertEquals(rendered, "「1」 甲。\n\n「2」 乙。");
  });

  await t.step("empty list renders empty string", () => {
    assertEquals(renderNumberedParagraphs([]), "");
  });
});
