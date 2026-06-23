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

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  applyInsertions,
  parseInsertEnvelope,
  resolveInsertions,
} from "../../../writer/lib/chat-chapter-insert.ts";
import { splitChapterParagraphs } from "../../../writer/lib/chapter-paragraphs.ts";
import { ChatError } from "../../../writer/lib/chat-types.ts";

Deno.test("parseInsertEnvelope", async (t) => {
  await t.step("parses a well-formed envelope", () => {
    const entries = parseInsertEnvelope(
      '{"insertions":[{"insertAfterParagraph":2,"text":"<image>x</image>"}]}',
    );
    assertEquals(entries.length, 1);
    assertEquals(entries[0]!.insertAfterParagraph, 2);
    assertEquals(entries[0]!.text, "<image>x</image>");
  });

  await t.step("accepts a json code fence and strips one outer layer", () => {
    const fenced = "```json\n" +
      '{"insertions":[{"insertAfterParagraph":0,"text":"a"}]}' +
      "\n```";
    const entries = parseInsertEnvelope(fenced);
    assertEquals(entries.length, 1);
    assertEquals(entries[0]!.text, "a");
  });

  await t.step("accepts a bare ``` fence", () => {
    const fenced = "```\n" +
      '{"insertions":[{"insertAfterParagraph":1,"text":"b"}]}' +
      "\n```";
    const entries = parseInsertEnvelope(fenced);
    assertEquals(entries[0]!.text, "b");
  });

  await t.step("accepts empty insertions array", () => {
    assertEquals(parseInsertEnvelope('{"insertions":[]}'), []);
  });

  await t.step("accepts same-line fenced JSON", () => {
    assertEquals(
      parseInsertEnvelope('```json {"insertions":[]} ```'),
      [],
    );
    assertEquals(
      parseInsertEnvelope('```{"insertions":[{"insertAfterParagraph":1,"text":"z"}]}```'),
      [{ insertAfterParagraph: 1, text: "z" }],
    );
  });

  await t.step("rejects non-JSON prose", () => {
    const err = assertThrows(
      () => parseInsertEnvelope("對不起，我無法完成此任務。"),
      ChatError,
    );
    assertEquals((err as ChatError).code, "insert-invalid-payload");
  });

  await t.step("rejects object without insertions array", () => {
    assertThrows(() => parseInsertEnvelope('{"foo":1}'), ChatError);
  });

  await t.step("rejects non-integer index", () => {
    const err = assertThrows(
      () => parseInsertEnvelope('{"insertions":[{"insertAfterParagraph":"two","text":"x"}]}'),
      ChatError,
    );
    assertEquals((err as ChatError).code, "insert-invalid-payload");
  });

  await t.step("rejects negative index", () => {
    assertThrows(
      () => parseInsertEnvelope('{"insertions":[{"insertAfterParagraph":-1,"text":"x"}]}'),
      ChatError,
    );
  });

  await t.step("rejects empty text", () => {
    assertThrows(
      () => parseInsertEnvelope('{"insertions":[{"insertAfterParagraph":1,"text":""}]}'),
      ChatError,
    );
  });
});

Deno.test("resolveInsertions + applyInsertions", async (t) => {
  const raw = "甲。\n\n乙。\n\n丙。\n\n丁。";
  const paras = splitChapterParagraphs(raw, null);

  await t.step("insert after a middle paragraph", () => {
    const resolved = resolveInsertions(
      [{ insertAfterParagraph: 2, text: "X" }],
      paras,
    );
    const out = applyInsertions(raw, resolved);
    assertEquals(out, "甲。\n\n乙。\n\nX\n\n丙。\n\n丁。");
  });

  await t.step("insert at the top (K=0)", () => {
    const resolved = resolveInsertions(
      [{ insertAfterParagraph: 0, text: "TOP" }],
      paras,
    );
    const out = applyInsertions(raw, resolved);
    assertEquals(out, "TOP\n\n甲。\n\n乙。\n\n丙。\n\n丁。");
  });

  await t.step("text spliced byte-for-byte (internal newlines preserved)", () => {
    const text = "<imgthink>line1\nline2</imgthink>\n<image>【A】### p ### n ### nl ###</image>";
    const resolved = resolveInsertions(
      [{ insertAfterParagraph: 1, text }],
      paras,
    );
    const out = applyInsertions(raw, resolved);
    assert(out.includes(text), "exact text substring preserved");
    assert(!out.includes("\n\n\n"), "no more than two consecutive newlines at joins");
  });

  await t.step("out-of-range index throws (no partial)", () => {
    const err = assertThrows(
      () =>
        resolveInsertions(
          [{ insertAfterParagraph: 9, text: "X" }],
          paras,
        ),
      ChatError,
    );
    assertEquals((err as ChatError).code, "insert-out-of-range");
  });

  await t.step("multiple insertions do not corrupt positions", () => {
    const resolved = resolveInsertions(
      [
        { insertAfterParagraph: 1, text: "A" },
        { insertAfterParagraph: 2, text: "B" },
        { insertAfterParagraph: 3, text: "C" },
      ],
      paras,
    );
    const out = applyInsertions(raw, resolved);
    assertEquals(out, "甲。\n\nA\n\n乙。\n\nB\n\n丙。\n\nC\n\n丁。");
  });

  await t.step("same-paragraph insertions keep array order (not reversed)", () => {
    const resolved = resolveInsertions(
      [
        { insertAfterParagraph: 2, text: "A" },
        { insertAfterParagraph: 2, text: "B" },
      ],
      paras,
    );
    const out = applyInsertions(raw, resolved);
    // A appears before B, both after paragraph 2.
    const idxA = out.indexOf("A");
    const idxB = out.indexOf("B");
    assert(idxA < idxB);
    assertEquals(out, "甲。\n\n乙。\n\nA\n\nB\n\n丙。\n\n丁。");
  });

  await t.step("zero-paragraph chapter accepts only K=0", () => {
    const empty: ReturnType<typeof splitChapterParagraphs> = [];
    const resolved = resolveInsertions(
      [{ insertAfterParagraph: 0, text: "X" }],
      empty,
    );
    assertEquals(resolved[0]!.offset, 0);
    assertThrows(
      () => resolveInsertions([{ insertAfterParagraph: 1, text: "X" }], empty),
      ChatError,
    );
  });

  await t.step("top insert preserves leading stripped content", () => {
    const strip = /<imgthink>[\s\S]*?<\/imgthink>/gi;
    const rawWithLead = "<imgthink>hidden</imgthink>\n\n第一段。";
    const p = splitChapterParagraphs(rawWithLead, strip);
    const resolved = resolveInsertions([{ insertAfterParagraph: 0, text: "X" }], p);
    const out = applyInsertions(rawWithLead, resolved);
    // X lands after the stripped block, before 第一段。
    assert(out.startsWith("<imgthink>hidden</imgthink>"));
    assert(
      out.includes("X\n\n第一段。") ||
        out.includes("X") && out.indexOf("X") < out.indexOf("第一段。"),
    );
    assert(out.indexOf("X") > out.indexOf("</imgthink>"));
  });

  await t.step("empty resolved list returns snapshot unchanged", () => {
    assertEquals(applyInsertions(raw, []), raw);
  });

  await t.step("CRLF chapter: middle insert keeps clean blank-line join (no mixed runs)", () => {
    const crlf = "甲。\r\n\r\n乙。\r\n\r\n丙。";
    const p = splitChapterParagraphs(crlf, null);
    assertEquals(p.length, 3);
    const resolved = resolveInsertions([{ insertAfterParagraph: 1, text: "X" }], p);
    const out = applyInsertions(crlf, resolved);
    // X is its own paragraph after 甲。; no run of 3+ line breaks at the joins.
    assert(out.includes("X"), out);
    assert(out.indexOf("X") > out.indexOf("甲。"), "X after 甲。");
    assert(out.indexOf("X") < out.indexOf("乙。"), "X before 乙。");
    assert(!/(?:\r?\n){3,}/.test(out), "no run of 3+ line breaks at joins");
  });

  await t.step("CRLF chapter: top insert (K=0)", () => {
    const crlf = "甲。\r\n\r\n乙。";
    const p = splitChapterParagraphs(crlf, null);
    const resolved = resolveInsertions([{ insertAfterParagraph: 0, text: "TOP" }], p);
    const out = applyInsertions(crlf, resolved);
    assert(out.startsWith("TOP\n\n甲。") || out.startsWith("TOP"), out);
    assert(out.indexOf("TOP") < out.indexOf("甲。"));
    assert(!/(?:\r?\n){3,}/.test(out));
  });
});
