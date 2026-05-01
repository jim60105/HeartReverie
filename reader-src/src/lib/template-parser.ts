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
 * Hand-rolled scanner that converts a Vento `system.md` source string into an
 * editable list of `MessageCard` objects, and a serialiser for the inverse.
 *
 * The parser is intentionally minimal — it only needs to find balanced
 * top-level `{{ message "<role>" }} … {{ /message }}` pairs and refuse to
 * parse constructs it cannot disambiguate (JS-expression escapes, echo
 * blocks, identifier-role openers). On any unsupported construct it returns
 * a parse error so the editor can fall back to raw-text mode.
 */

import type { MessageCard } from "@/types";

/** Result of `parseSystemTemplate`. */
export interface ParseResult {
  cards: MessageCard[] | null;
  parseError: string | null;
  topLevelContentDropped: boolean;
}

const ALLOWED_ROLES: ReadonlyArray<MessageCard["role"]> = [
  "system",
  "user",
  "assistant",
];

const ROLE_LITERAL_RE = /^"(system|user|assistant)"$/;
const ROLE_ANY_LITERAL_RE = /^"([^"]*)"$/;
const ROLE_IDENT_RE = /^[a-zA-Z_]\w*$/;

interface Tag {
  kind: "msg-open" | "msg-close";
  /** Source offset of the leading `{{`. */
  start: number;
  /** Source offset immediately after the trailing `}}`. */
  end: number;
  /** Captured role (only for `msg-open`). */
  role?: MessageCard["role"];
}

/** Generate a fresh client-side UUID for a new card. Falls back to a
 * timestamp+random string when `crypto.randomUUID()` is unavailable (older
 * test environments). */
function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `card-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Locate the matching `}}` (or `-}}`) for a Vento expression that starts at
 * `src[start..start+2] === "{{"`. Returns the offset immediately after the
 * closing braces, or `-1` when unterminated. String literals (single- or
 * double-quoted) inside the expression are skipped so they can legally
 * contain `}}` substrings.
 */
function findExpressionEnd(src: string, start: number): number {
  let i = start + 2;
  if (src[i] === "-") i++;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      const quote = c;
      i++;
      while (i < src.length) {
        const ch = src[i]!;
        if (ch === "\\") {
          i += 2;
          continue;
        }
        if (ch === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "-" && src[i + 1] === "}" && src[i + 2] === "}") {
      return i + 3;
    }
    if (c === "}" && src[i + 1] === "}") {
      return i + 2;
    }
    i++;
  }
  return -1;
}

/**
 * Strip exactly one leading `\n` or `\r\n` and exactly one trailing `\n` or
 * `\r\n` from a body string per the canonical-delimiter model defined in the
 * `prompt-editor-message-cards` spec.
 */
function stripCanonicalNewlines(body: string): string {
  let out = body;
  if (out.startsWith("\r\n")) {
    out = out.slice(2);
  } else if (out.startsWith("\n")) {
    out = out.slice(1);
  }
  if (out.endsWith("\r\n")) {
    out = out.slice(0, -2);
  } else if (out.endsWith("\n")) {
    out = out.slice(0, -1);
  }
  return out;
}

/**
 * Parse a Vento template source string into a list of `MessageCard` objects.
 * On any unsupported construct, returns `{ cards: null, parseError, ... }`
 * so the editor can fall back to raw-text mode.
 */
export function parseSystemTemplate(source: string): ParseResult {
  if (source.trim().length === 0) {
    return { cards: [], parseError: null, topLevelContentDropped: false };
  }

  const tags: Tag[] = [];
  let i = 0;
  while (i < source.length) {
    const next = source.indexOf("{{", i);
    if (next === -1) break;

    // Vento comment: `{{# … #}}`
    if (source[next + 2] === "#") {
      const end = source.indexOf("#}}", next + 3);
      if (end === -1) {
        i = next + 2;
        continue;
      }
      i = end + 3;
      continue;
    }

    const exprEnd = findExpressionEnd(source, next);
    if (exprEnd === -1) {
      // Unterminated expression — surface as malformed opener.
      return {
        cards: null,
        parseError: "範本語法錯誤：偵測到未閉合的 Vento 表達式，需使用純文字模式編輯",
        topLevelContentDropped: false,
      };
    }

    let inner = source.slice(next + 2, exprEnd - 2);
    if (inner.startsWith("-")) inner = inner.slice(1);
    if (inner.endsWith("-")) inner = inner.slice(0, -1);
    inner = inner.trim();

    if (inner.startsWith(">")) {
      return {
        cards: null,
        parseError: "偵測到 JavaScript 表達式（{{> ...}}），需使用純文字模式編輯",
        topLevelContentDropped: false,
      };
    }
    if (inner === "echo" || /^echo\s/.test(inner) || inner === "/echo") {
      return {
        cards: null,
        parseError: "偵測到 echo 區塊，需使用純文字模式編輯",
        topLevelContentDropped: false,
      };
    }

    if (inner === "/message") {
      tags.push({ kind: "msg-close", start: next, end: exprEnd });
      i = exprEnd;
      continue;
    }

    if (inner === "message" || /^message\s/.test(inner)) {
      const roleExpr = inner.slice("message".length).trim();
      if (roleExpr.length === 0) {
        return {
          cards: null,
          parseError: "範本語法錯誤：{{ message }} 缺少角色，需使用純文字模式編輯",
          topLevelContentDropped: false,
        };
      }
      const literal = ROLE_LITERAL_RE.exec(roleExpr);
      if (literal) {
        tags.push({
          kind: "msg-open",
          start: next,
          end: exprEnd,
          role: literal[1] as MessageCard["role"],
        });
        i = exprEnd;
        continue;
      }
      const anyLiteral = ROLE_ANY_LITERAL_RE.exec(roleExpr);
      if (anyLiteral) {
        return {
          cards: null,
          parseError: `不支援的訊息角色：${anyLiteral[1]}（僅支援 system / user / assistant），需使用純文字模式編輯`,
          topLevelContentDropped: false,
        };
      }
      if (ROLE_IDENT_RE.test(roleExpr)) {
        return {
          cards: null,
          parseError: "動態角色訊息標籤需使用純文字模式編輯",
          topLevelContentDropped: false,
        };
      }
      return {
        cards: null,
        parseError: `範本語法錯誤：無法解析的訊息角色表達式（${roleExpr}），需使用純文字模式編輯`,
        topLevelContentDropped: false,
      };
    }

    i = exprEnd;
  }

  // No message tags at all — treat entire source as a single system card.
  if (tags.length === 0) {
    const trimmed = source.trim();
    if (trimmed.length === 0) {
      return { cards: [], parseError: null, topLevelContentDropped: false };
    }
    return {
      cards: [{ id: newId(), role: "system", body: trimmed }],
      parseError: null,
      topLevelContentDropped: false,
    };
  }

  // Pair up openers/closers and detect nesting.
  const cards: MessageCard[] = [];
  const stack: Tag[] = [];
  let droppedTopLevel = false;
  let prevCloseEnd = -1;
  let firstOpenerStart = -1;

  for (const tag of tags) {
    if (tag.kind === "msg-open") {
      if (stack.length > 0) {
        return {
          cards: null,
          parseError: "範本語法錯誤：{{ message }} 區塊不可巢狀，需使用純文字模式編輯",
          topLevelContentDropped: false,
        };
      }
      if (firstOpenerStart === -1) {
        firstOpenerStart = tag.start;
      } else if (prevCloseEnd !== -1) {
        const gap = source.slice(prevCloseEnd, tag.start);
        if (gap.trim().length > 0) {
          droppedTopLevel = true;
        }
      }
      stack.push(tag);
    } else {
      const opener = stack.pop();
      if (!opener) {
        return {
          cards: null,
          parseError: "範本語法錯誤：偵測到未配對的 {{ /message }}，需使用純文字模式編輯",
          topLevelContentDropped: false,
        };
      }
      const rawBody = source.slice(opener.end, tag.start);
      const body = stripCanonicalNewlines(rawBody);
      cards.push({
        id: newId(),
        role: opener.role!,
        body,
      });
      prevCloseEnd = tag.end;
    }
  }

  if (stack.length > 0) {
    return {
      cards: null,
      parseError: "範本語法錯誤：偵測到未閉合的 {{ message }} 區塊，需使用純文字模式編輯",
      topLevelContentDropped: false,
    };
  }

  // Leading top-level content (before the first opener).
  const leading = source.slice(0, firstOpenerStart);
  const leadingTrimmed = leading.trim();
  if (leadingTrimmed.length > 0) {
    cards.unshift({ id: newId(), role: "system", body: leadingTrimmed });
  }

  // Trailing top-level content (after the last closer).
  if (prevCloseEnd !== -1) {
    const trailing = source.slice(prevCloseEnd);
    if (trailing.trim().length > 0) {
      droppedTopLevel = true;
    }
  }

  return {
    cards,
    parseError: null,
    topLevelContentDropped: droppedTopLevel,
  };
}

/**
 * Serialise a list of `MessageCard` objects back into a Vento template string.
 *
 * Output format per the spec: each card emits
 * `{{ message "<role>" }}\n<body>\n{{ /message }}` and adjacent blocks are
 * joined by a single blank line (`"\n\n"`). The output ends with a trailing
 * newline. An empty array serialises to the empty string. Bodies are written
 * verbatim — no escaping, no normalisation of internal line endings.
 *
 * Throws `RangeError` when any card has a role outside the allow-list.
 */
export function serializeMessageCards(cards: MessageCard[]): string {
  if (cards.length === 0) return "";
  const blocks: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    if (!ALLOWED_ROLES.includes(card.role)) {
      throw new RangeError(
        `serializeMessageCards: invalid role "${card.role}" at card index ${i}`,
      );
    }
    blocks.push(`{{ message "${card.role}" }}\n${card.body}\n{{ /message }}`);
  }
  return `${blocks.join("\n\n")}\n`;
}
