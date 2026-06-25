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
import { extractLeadingUserMessage } from "../../../writer/lib/user-message-prefix.ts";

Deno.test("extractLeadingUserMessage: captures leading block incl. <=2-break separator", () => {
  const raw = "<user_message>\n玩家輸入\n</user_message>\n\n散文。\n";
  assertEquals(
    extractLeadingUserMessage(raw),
    "<user_message>\n玩家輸入\n</user_message>\n\n",
  );
});

Deno.test("extractLeadingUserMessage: single LF separator captured", () => {
  const raw = "<user_message>\nx\n</user_message>\n散文";
  assertEquals(
    extractLeadingUserMessage(raw),
    "<user_message>\nx\n</user_message>\n",
  );
});

Deno.test("extractLeadingUserMessage: no separator (immediately followed by prose)", () => {
  const raw = "<user_message>\nx\n</user_message>散文";
  assertEquals(
    extractLeadingUserMessage(raw),
    "<user_message>\nx\n</user_message>",
  );
});

Deno.test("extractLeadingUserMessage: no block at all returns empty string", () => {
  assertEquals(extractLeadingUserMessage("只是純散文，沒有任何標籤。\n"), "");
});

Deno.test("extractLeadingUserMessage: unterminated/malformed block returns empty string", () => {
  const raw = "<user_message>\n沒有結束標籤的內容\n\n更多散文";
  assertEquals(extractLeadingUserMessage(raw), "");
});

Deno.test("extractLeadingUserMessage: mid-body-only block returns empty string", () => {
  const raw = "開頭散文。\n\n<user_message>\n中段\n</user_message>\n\n結尾。";
  assertEquals(extractLeadingUserMessage(raw), "");
});

Deno.test("extractLeadingUserMessage: block preceded by other content returns empty string", () => {
  const raw = "<meta>頭</meta>\n<user_message>\nx\n</user_message>\n\n散文";
  assertEquals(extractLeadingUserMessage(raw), "");
});

Deno.test("extractLeadingUserMessage: leading whitespace before tag returns empty string", () => {
  // Byte-0 anchor — even a single leading newline disqualifies the match.
  const raw = "\n<user_message>\nx\n</user_message>\n\n散文";
  assertEquals(extractLeadingUserMessage(raw), "");
});

Deno.test("extractLeadingUserMessage: over-long trailing whitespace bounded to 2 breaks", () => {
  const raw = "<user_message>\nx\n</user_message>\n\n\n   散文";
  // Only the first two line breaks are absorbed; the third break and the
  // indentation belong to the prose body.
  assertEquals(
    extractLeadingUserMessage(raw),
    "<user_message>\nx\n</user_message>\n\n",
  );
});

Deno.test("extractLeadingUserMessage: uppercase USER_MESSAGE not captured (case-sensitive)", () => {
  const raw = "<USER_MESSAGE>\nx\n</USER_MESSAGE>\n\n散文";
  assertEquals(extractLeadingUserMessage(raw), "");
});

Deno.test("extractLeadingUserMessage: CRLF separator captured", () => {
  const raw = "<user_message>\r\nx\r\n</user_message>\r\n\r\n散文";
  assertEquals(
    extractLeadingUserMessage(raw),
    "<user_message>\r\nx\r\n</user_message>\r\n\r\n",
  );
});

Deno.test("extractLeadingUserMessage: open tag with attributes captured", () => {
  const raw = '<user_message data-x="1">\nx\n</user_message>\n\n散文';
  assertEquals(
    extractLeadingUserMessage(raw),
    '<user_message data-x="1">\nx\n</user_message>\n\n',
  );
});
