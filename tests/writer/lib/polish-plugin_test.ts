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

import { assert, assertEquals, assertFalse } from "@std/assert";
import vento from "ventojs";
import { messageTagPlugin, splitRenderedMessages } from "../../../writer/lib/vento-message-tag.ts";
import { validateTemplate } from "../../../writer/lib/template.ts";

/**
 * Render `plugins/polish/polish-instruction.md` through the same Vento engine
 * + message-tag pipeline the run-prompt route uses, returning the assembled
 * `{ role, content }[]` array.
 */
type RenderedMessage = { role: "system" | "user" | "assistant"; content: string };

async function renderPolish(
  vars: Record<string, unknown>,
): Promise<RenderedMessage[]> {
  const env = vento();
  env.use(messageTagPlugin());
  const tpl = await Deno.readTextFile("plugins/polish/polish-instruction.md");
  const messageState = {
    nonce: crypto.randomUUID(),
    messages: [] as RenderedMessage[],
  };
  const result = await env.runString(tpl, { ...vars, __messageState: messageState });
  return splitRenderedMessages(
    result.content,
    messageState.nonce,
    messageState.messages,
  ) as RenderedMessage[];
}

Deno.test("polish plugin.json is valid JSON with correct structure", async () => {
  const raw = await Deno.readTextFile("plugins/polish/plugin.json");
  const manifest = JSON.parse(raw);

  assertEquals(manifest.name, "polish");
  assertEquals(manifest.type, "full-stack");
  assertEquals(manifest.frontendModule, "./frontend.js");
  assert(Array.isArray(manifest.actionButtons));
  assertEquals(manifest.actionButtons.length, 1);
  assertEquals(manifest.actionButtons[0].id, "polish");
  assertEquals(manifest.actionButtons[0].visibleWhen, "last-chapter-backend");
  assert(typeof manifest.actionButtons[0].label === "string");
  assert(manifest.actionButtons[0].label.length > 0);
  assert(manifest.actionButtons[0].label.length <= 40);
});

Deno.test("polish-instruction.md is SFW — no forbidden content", async () => {
  const content = await Deno.readTextFile(
    "plugins/polish/polish-instruction.md",
  );
  const forbidden = [
    /18\+/i,
    /NSFW/i,
    /RPJB/i,
    /no content restrictions/i,
    /jailbreak/i,
    /bypass/i,
    /DO NOT DISCLOSE/i,
  ];
  for (const pattern of forbidden) {
    assertFalse(
      pattern.test(content),
      `polish-instruction.md must not match ${pattern}`,
    );
  }
});

Deno.test("polish-instruction.md has correct Vento message structure", async () => {
  const content = await Deno.readTextFile(
    "plugins/polish/polish-instruction.md",
  );

  const systemMatches = content.match(/\{\{\s*message\s+"system"\s*\}\}/g);
  assertEquals(
    systemMatches?.length,
    1,
    'Expected exactly one {{ message "system" }} block',
  );

  const userMatches = content.match(/\{\{\s*message\s+"user"\s*\}\}/g);
  assertEquals(
    userMatches?.length,
    1,
    'Expected exactly one {{ message "user" }} block',
  );

  assert(content.includes("{{ draft }}"), "Must include {{ draft }} variable");
  assert(content.includes("<draft>"), "Must wrap draft in <draft> tags");
  assert(content.includes("</draft>"), "Must close </draft> tags");
});

Deno.test("polish-instruction.md passes the SSTI whitelist (validateTemplate)", async () => {
  // The run-prompt route runs the prompt file through validateTemplate() as a
  // templateOverride BEFORE rendering. The directive branch uses Vento
  // whitespace-trim markers ({{- ... }}), which the validator MUST accept;
  // otherwise every polish run with a directive fails with 422 "Template
  // rendering error". Regression guard for that exact bug.
  const tpl = await Deno.readTextFile("plugins/polish/polish-instruction.md");
  assertEquals(validateTemplate(tpl), []);
});

Deno.test("polish-instruction.md omits the directive branch when no directive is given", async () => {
  // NOTE: the exact prompt prose is intentionally NOT asserted here — the
  // wording of polish-instruction.md is author-managed and may change by hand.
  // We only lock the structural contract of the no-directive branch: a system
  // + user message pair, the draft wrapped verbatim, and no <polish_instruction>
  // envelope.
  for (const vars of [{ draft: "DRAFT_BODY" }, { draft: "DRAFT_BODY", polish_instruction: "" }]) {
    const msgs = await renderPolish(vars);
    assertEquals(msgs.length, 2, `expected system+user pair for ${JSON.stringify(vars)}`);

    const system = msgs.find((m) => m.role === "system")!;
    const user = msgs.find((m) => m.role === "user")!;
    assert(system, "must emit a system message");
    assert(user, "must emit a user message");

    assert(
      user.content.includes("<draft>\nDRAFT_BODY\n</draft>"),
      "draft must be wrapped verbatim",
    );
    assertFalse(
      user.content.includes("<polish_instruction>"),
      "must not render the directive envelope when no directive is given",
    );
    assertFalse(
      system.content.includes("潤飾指示"),
      "must not mention the reader directive when no directive is given",
    );
  }
});

Deno.test("polish-instruction.md surfaces the directive in both blocks when set", async () => {
  const msgs = await renderPolish({
    draft: "DRAFT_BODY",
    polish_instruction: "讓對白更尖銳",
  });

  assertEquals(msgs.length, 2);
  const system = msgs.find((m) => m.role === "system")!;
  const user = msgs.find((m) => m.role === "user")!;

  // System block gains the honour-the-directive framing.
  assert(
    system.content.includes("潤飾指示"),
    "system block must mention the reader directive when polish_instruction is set",
  );
  // Baseline constraints are still present.
  assert(system.content.includes("以對話推進劇情"));

  // User block wraps the directive verbatim in a <polish_instruction> envelope
  // ahead of the <draft>.
  assert(user.content.includes("<polish_instruction>\n讓對白更尖銳\n</polish_instruction>"));
  const instrIdx = user.content.indexOf("<polish_instruction>");
  const draftIdx = user.content.indexOf("<draft>");
  assert(instrIdx >= 0 && draftIdx >= 0 && instrIdx < draftIdx, "directive must precede draft");
  assert(user.content.includes("DRAFT_BODY"));
});

Deno.test("polish-instruction.md passes XML-like directive markup through verbatim", async () => {
  const directive = "用 <emphasis> 強調雨聲，甚至 </draft> 也要保留 & 不轉義";
  const msgs = await renderPolish({ draft: "DRAFT_BODY", polish_instruction: directive });
  const user = msgs.find((m) => m.role === "user")!;
  assert(
    user.content.includes(directive),
    "directive markup must appear verbatim with no HTML/XML escaping",
  );
  assertFalse(user.content.includes("&lt;"), "must not HTML-escape '<'");
  assertFalse(user.content.includes("&amp;"), "must not HTML-escape '&'");
});

Deno.test("polish-instruction.md treats a whitespace-only directive as present (defense-in-depth)", async () => {
  // The frontend trims before sending, so a whitespace-only directive becomes
  // "" and is omitted. But if a caller bypasses the trim, Vento sees a truthy
  // non-empty string and renders the envelope — it must still produce a valid
  // single-user-message prompt (never crash / never drop the user turn).
  const msgs = await renderPolish({ draft: "DRAFT_BODY", polish_instruction: "   " });
  assertEquals(msgs.filter((m) => m.role === "user").length, 1);
  const user = msgs.find((m) => m.role === "user")!;
  assert(user.content.includes("<polish_instruction>"));
  assert(user.content.includes("<draft>\nDRAFT_BODY\n</draft>"));
});

Deno.test("polish-instruction.md emits exactly one user message in every branch", async () => {
  for (const vars of [{ draft: "D" }, { draft: "D", polish_instruction: "改寫風格" }]) {
    const msgs = await renderPolish(vars);
    const userCount = msgs.filter((m) => m.role === "user").length;
    assertEquals(userCount, 1, `expected one user message for ${JSON.stringify(vars)}`);
  }
});

Deno.test("polish frontend.js exists and exports register", async () => {
  const stat = await Deno.stat("plugins/polish/frontend.js");
  assert(stat.isFile, "frontend.js must be a file");

  const content = await Deno.readTextFile("plugins/polish/frontend.js");
  assert(
    content.includes("export function register"),
    "Must export register function",
  );
  assert(
    content.includes("action-button:click"),
    "Must subscribe to action-button:click",
  );
  assert(
    content.includes("replace: true"),
    "Must pass replace: true to runPluginPrompt",
  );
});
