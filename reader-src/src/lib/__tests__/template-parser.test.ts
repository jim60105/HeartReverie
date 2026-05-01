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

import { describe, expect, it } from "vitest";
import {
  parseSystemTemplate,
  serializeMessageCards,
} from "@/lib/template-parser";
import type { MessageCard } from "@/types";

function stripIds(cards: MessageCard[] | null): Array<Omit<MessageCard, "id">> {
  return (cards ?? []).map(({ role, body }) => ({ role, body }));
}

describe("parseSystemTemplate", () => {
  it("parses a canonical three-message template", () => {
    const src =
      `{{ message "system" }}\nS\n{{ /message }}\n\n` +
      `{{ message "user" }}\nU\n{{ /message }}\n\n` +
      `{{ message "assistant" }}\nA\n{{ /message }}\n`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(result.topLevelContentDropped).toBe(false);
    expect(stripIds(result.cards)).toEqual([
      { role: "system", body: "S" },
      { role: "user", body: "U" },
      { role: "assistant", body: "A" },
    ]);
    for (const card of result.cards!) {
      expect(card.id).toMatch(/.+/);
    }
  });

  it("preserves echo expressions inside the body", () => {
    const src = `{{ message "user" }}\nHello {{ user_input }} world\n{{ /message }}\n`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(stripIds(result.cards)).toEqual([
      { role: "user", body: "Hello {{ user_input }} world" },
    ]);
  });

  it("preserves JS-style expressions inside the body", () => {
    const src = `{{ message "user" }}\n{{ a + b * 2 }}\n{{ /message }}\n`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(stripIds(result.cards)).toEqual([
      { role: "user", body: "{{ a + b * 2 }}" },
    ]);
  });

  it("accepts trim markers on message tags without preserving them", () => {
    const src = `{{- message "system" -}}body{{- /message -}}`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(stripIds(result.cards)).toEqual([
      { role: "system", body: "body" },
    ]);
  });

  it("strips the canonical pair of boundary newlines", () => {
    const result = parseSystemTemplate(
      `{{ message "system" }}\nS\n{{ /message }}`,
    );
    expect(stripIds(result.cards)).toEqual([{ role: "system", body: "S" }]);
  });

  it("preserves additional newlines beyond the canonical pair", () => {
    const result = parseSystemTemplate(
      `{{ message "system" }}\n\n S \n\n{{ /message }}`,
    );
    expect(stripIds(result.cards)).toEqual([
      { role: "system", body: "\n S \n" },
    ]);
  });

  it("preserves CRLF line endings inside the body", () => {
    const result = parseSystemTemplate(
      `{{ message "system" }}\r\nline1\r\nline2\r\n{{ /message }}`,
    );
    expect(stripIds(result.cards)).toEqual([
      { role: "system", body: "line1\r\nline2" },
    ]);
  });

  it("treats a no-message non-whitespace source as a single system card", () => {
    const result = parseSystemTemplate("Hello world\n");
    expect(result.parseError).toBeNull();
    expect(result.topLevelContentDropped).toBe(false);
    expect(stripIds(result.cards)).toEqual([
      { role: "system", body: "Hello world" },
    ]);
  });

  it("returns empty cards for whitespace-only source", () => {
    const result = parseSystemTemplate("   \n\n  ");
    expect(result.parseError).toBeNull();
    expect(result.cards).toEqual([]);
    expect(result.topLevelContentDropped).toBe(false);
  });

  it("coalesces leading top-level content into a system card without dropping flag", () => {
    const src = `Hello\n{{ message "user" }}\nU\n{{ /message }}\n`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(result.topLevelContentDropped).toBe(false);
    expect(stripIds(result.cards)).toEqual([
      { role: "system", body: "Hello" },
      { role: "user", body: "U" },
    ]);
  });

  it("drops trailing top-level content and sets the dropped flag", () => {
    const src =
      `{{ message "system" }}\nS\n{{ /message }}\n\nleftover-text\n`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(result.topLevelContentDropped).toBe(true);
    expect(stripIds(result.cards)).toEqual([{ role: "system", body: "S" }]);
  });

  it("drops inter-block top-level content and sets the dropped flag", () => {
    const src =
      `{{ message "system" }}\nS\n{{ /message }}\n\nbetween-text\n\n` +
      `{{ message "user" }}\nU\n{{ /message }}\n`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(result.topLevelContentDropped).toBe(true);
    expect(stripIds(result.cards)).toEqual([
      { role: "system", body: "S" },
      { role: "user", body: "U" },
    ]);
  });

  it("returns a parse error for unbalanced openers", () => {
    const result = parseSystemTemplate(`{{ message "user" }}\nbody\n`);
    expect(result.cards).toBeNull();
    expect(result.parseError).toMatch(/未閉合/);
  });

  it("returns a parse error for unmatched closers", () => {
    const result = parseSystemTemplate(`{{ /message }}`);
    expect(result.cards).toBeNull();
    expect(result.parseError).toMatch(/未配對/);
  });

  it("returns a parse error for unknown roles", () => {
    const result = parseSystemTemplate(
      `{{ message "tool" }}body{{ /message }}`,
    );
    expect(result.cards).toBeNull();
    expect(result.parseError).toMatch(/tool/);
    expect(result.parseError).toMatch(/system \/ user \/ assistant/);
  });

  it("returns a parse error for nested message blocks", () => {
    const src =
      `{{ message "system" }}\n` +
      `{{ message "user" }}inner{{ /message }}\n` +
      `{{ /message }}`;
    const result = parseSystemTemplate(src);
    expect(result.cards).toBeNull();
    expect(result.parseError).toMatch(/巢狀/);
  });

  it("returns the spec'd zh-TW reason for identifier-role openers", () => {
    const src = `{{ message dynamic_role }}body{{ /message }}`;
    const result = parseSystemTemplate(src);
    expect(result.cards).toBeNull();
    expect(result.parseError).toBe("動態角色訊息標籤需使用純文字模式編輯");
  });

  it("returns the spec'd zh-TW reason for JS-expression escapes", () => {
    const src = `prefix\n{{> someJsExpression() }}\nsuffix`;
    const result = parseSystemTemplate(src);
    expect(result.cards).toBeNull();
    expect(result.parseError).toBe(
      "偵測到 JavaScript 表達式（{{> ...}}），需使用純文字模式編輯",
    );
  });

  it("returns the spec'd zh-TW reason for echo blocks", () => {
    const src = `{{ echo }}raw {{ message "user" }} text{{ /echo }}`;
    const result = parseSystemTemplate(src);
    expect(result.cards).toBeNull();
    expect(result.parseError).toBe("偵測到 echo 區塊，需使用純文字模式編輯");
  });

  it("rejects an opener with no role", () => {
    const result = parseSystemTemplate(`{{ message }}body{{ /message }}`);
    expect(result.cards).toBeNull();
    expect(result.parseError).toMatch(/缺少角色/);
  });

  it("does not match `{{ message }}` text inside a Vento string literal", () => {
    // `{{ "{{ message \"user\" }}" }}` is a Vento expression whose value is the
    // literal string `{{ message "user" }}`. The scanner MUST NOT treat the
    // inner braces as a real opener — the whole expression is opaque body
    // content of the surrounding card.
    const src =
      `{{ message "system" }}\n` +
      `prefix {{ "{{ message \\"user\\" }}" }} suffix\n` +
      `{{ /message }}\n`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(stripIds(result.cards)).toEqual([
      {
        role: "system",
        body: `prefix {{ "{{ message \\"user\\" }}" }} suffix`,
      },
    ]);
  });

  it("does not match `{{ message }}` text inside a Vento comment", () => {
    // `{{# … #}}` is a Vento comment; anything until `#}}` is non-code and
    // MUST NOT trigger an opener match. Place the comment inside a message
    // block so it's captured as body content rather than top-level text.
    const src =
      `{{ message "system" }}\n` +
      `{{# {{ message "user" }} should-not-match #}}\n` +
      `body\n` +
      `{{ /message }}\n`;
    const result = parseSystemTemplate(src);
    expect(result.parseError).toBeNull();
    expect(stripIds(result.cards)).toEqual([
      {
        role: "system",
        body: `{{# {{ message "user" }} should-not-match #}}\nbody`,
      },
    ]);
  });
});

describe("serializeMessageCards", () => {
  it("emits the canonical block format for two cards", () => {
    const out = serializeMessageCards([
      { id: "a", role: "system", body: "S" },
      { id: "b", role: "user", body: "U" },
    ]);
    expect(out).toBe(
      `{{ message "system" }}\nS\n{{ /message }}\n\n` +
      `{{ message "user" }}\nU\n{{ /message }}\n`,
    );
  });

  it("preserves bodies verbatim", () => {
    const body = "Hello {{ user_input }} world\n\n  spaced  \n\n";
    const out = serializeMessageCards([
      { id: "a", role: "user", body },
    ]);
    expect(out).toBe(`{{ message "user" }}\n${body}\n{{ /message }}\n`);
  });

  it("returns an empty string for an empty cards array", () => {
    expect(serializeMessageCards([])).toBe("");
  });

  it("throws RangeError on invalid role and names the card index", () => {
    expect(() =>
      serializeMessageCards([
        { id: "a", role: "system", body: "x" },
        { id: "b", role: "tool" as MessageCard["role"], body: "y" },
      ]),
    ).toThrow(/index 1/);
  });
});

describe("parse + serialize round-trip", () => {
  it("round-trips a canonical 3-card template", () => {
    const cards: MessageCard[] = [
      { id: "1", role: "system", body: "system body" },
      { id: "2", role: "user", body: "user body with {{ user_input }}" },
      { id: "3", role: "assistant", body: "assistant body" },
    ];
    const serialised = serializeMessageCards(cards);
    const parsed = parseSystemTemplate(serialised);
    expect(parsed.parseError).toBeNull();
    expect(stripIds(parsed.cards)).toEqual(stripIds(cards));
  });

  it("round-trips bodies that contain blank lines", () => {
    const cards: MessageCard[] = [
      { id: "1", role: "system", body: "a\n\nb" },
      { id: "2", role: "user", body: "u" },
    ];
    const parsed = parseSystemTemplate(serializeMessageCards(cards));
    expect(stripIds(parsed.cards)).toEqual(stripIds(cards));
  });
});
