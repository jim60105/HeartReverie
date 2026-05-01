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

import { assert, assertEquals, assertExists, assertMatch, assertThrows } from "@std/assert";
import { createTemplateEngine, validateTemplate } from "../../../writer/lib/template.ts";
import {
  ALLOWED_MESSAGE_ROLES,
  assertHasUserMessage,
  assertNoEmptyMessages,
  splitRenderedMessages,
} from "../../../writer/lib/vento-message-tag.ts";
import type { ChatMessage, RenderResult } from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

const mockPluginManager = {
  getPromptVariables: async () => ({ variables: {}, fragments: [] }),
  getDynamicVariables: async () => ({}),
} as unknown as PluginManager;

function newEngine() {
  return createTemplateEngine(mockPluginManager);
}

async function render(
  template: string,
  extra: Record<string, unknown> = {},
): Promise<RenderResult> {
  const { renderSystemPrompt } = newEngine();
  return await renderSystemPrompt("series", "story", {
    templateOverride: template,
    userInput: "hello",
    ...extra,
  });
}

Deno.test("vento-message-tag: literal role rendering", async (t) => {
  await t.step("system role produces single system message", async () => {
    const r = await render(`{{ message "system" }}content{{ /message }}{{ message "user" }}u{{ /message }}`);
    assertEquals(r.error, null);
    assertEquals(r.messages, [
      { role: "system", content: "content" },
      { role: "user", content: "u" },
    ]);
  });

  await t.step("all three literal roles emitted", async () => {
    const r = await render(
      `{{ message "system" }}sys{{ /message }}{{ message "user" }}usr{{ /message }}{{ message "assistant" }}ast{{ /message }}`,
    );
    assertEquals(r.error, null);
    assertEquals(r.messages, [
      { role: "system", content: "sys" },
      { role: "user", content: "usr" },
      { role: "assistant", content: "ast" },
    ]);
  });
});

Deno.test("vento-message-tag: identifier role resolved at runtime", async () => {
  // Pass `r` via a plugin-managed dynamic variable. Here we use a custom
  // pluginManager that injects `r`.
  const mgr = {
    getPromptVariables: async () => ({
      variables: { r: "user" },
      fragments: [],
    }),
    getDynamicVariables: async () => ({}),
  } as unknown as PluginManager;
  const { renderSystemPrompt } = createTemplateEngine(mgr);
  const r = await renderSystemPrompt("s", "n", {
    templateOverride: `{{ message r }}body{{ /message }}`,
    userInput: "x",
  });
  assertEquals(r.error, null);
  assertEquals(r.messages, [{ role: "user", content: "body" }]);
});

Deno.test("vento-message-tag: variable interpolation inside body", async () => {
  const mgr = {
    getPromptVariables: async () => ({
      variables: { name: "Aria" },
      fragments: [],
    }),
    getDynamicVariables: async () => ({}),
  } as unknown as PluginManager;
  const { renderSystemPrompt } = createTemplateEngine(mgr);
  const r = await renderSystemPrompt("s", "n", {
    templateOverride: `{{ message "user" }}Hello {{ name }}{{ /message }}`,
    userInput: "x",
  });
  assertEquals(r.error, null);
  assertEquals(r.messages, [{ role: "user", content: "Hello Aria" }]);
});

Deno.test("vento-message-tag: adjacent blocks produce three messages in order", async () => {
  const r = await render(
    `{{ message "system" }}A{{ /message }}{{ message "user" }}B{{ /message }}{{ message "assistant" }}C{{ /message }}`,
  );
  assertEquals(r.error, null);
  assertEquals(r.messages, [
    { role: "system", content: "A" },
    { role: "user", content: "B" },
    { role: "assistant", content: "C" },
  ]);
});

Deno.test("vento-message-tag: whitespace-only between blocks discarded", async () => {
  const r = await render(
    `{{ message "user" }}A{{ /message }}\n\n{{ message "assistant" }}B{{ /message }}`,
  );
  assertEquals(r.error, null);
  assertEquals(r.messages, [
    { role: "user", content: "A" },
    { role: "assistant", content: "B" },
  ]);
});

Deno.test("vento-message-tag: top-level text auto-roled to system", async () => {
  const r = await render(
    `Prefix {{ message "user" }}live{{ /message }} Suffix`,
  );
  assertEquals(r.error, null);
  assertEquals(r.messages, [
    { role: "system", content: "Prefix" },
    { role: "user", content: "live" },
    { role: "system", content: "Suffix" },
  ]);
});

Deno.test("vento-message-tag: adjacent system messages coalesce", async () => {
  const r = await render(
    `{{ message "system" }}first{{ /message }}{{ message "system" }}second{{ /message }}{{ message "user" }}u{{ /message }}`,
  );
  assertEquals(r.error, null);
  assertEquals(r.messages, [
    { role: "system", content: "first\nsecond" },
    { role: "user", content: "u" },
  ]);
});

Deno.test("vento-message-tag: control flow inside body", async (t) => {
  await t.step("if true branch", async () => {
    const mgr = {
      getPromptVariables: async () => ({
        variables: { cond: true },
        fragments: [],
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(mgr);
    const r = await renderSystemPrompt("s", "n", {
      templateOverride: `{{ message "user" }}{{ if cond }}A{{ else }}B{{ /if }}{{ /message }}`,
      userInput: "x",
    });
    assertEquals(r.error, null);
    assertEquals(r.messages, [{ role: "user", content: "A" }]);
  });

  await t.step("if false branch", async () => {
    const mgr = {
      getPromptVariables: async () => ({
        variables: { cond: false },
        fragments: [],
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(mgr);
    const r = await renderSystemPrompt("s", "n", {
      templateOverride: `{{ message "user" }}{{ if cond }}A{{ else }}B{{ /if }}{{ /message }}`,
      userInput: "x",
    });
    assertEquals(r.error, null);
    assertEquals(r.messages, [{ role: "user", content: "B" }]);
  });
});

Deno.test("vento-message-tag: for-loop emits one message per iteration", async () => {
  // Member access (`ex.q`) is rejected by the SSTI whitelist for templateOverride,
  // so this exercise uses a flat list of strings — adequate to validate that the
  // sentinel/buffer side-channel survives loop iteration.
  const mgr = {
    getPromptVariables: async () => ({
      variables: { items: ["one", "two", "three"] },
      fragments: [],
    }),
    getDynamicVariables: async () => ({}),
  } as unknown as PluginManager;
  const { renderSystemPrompt } = createTemplateEngine(mgr);
  const r = await renderSystemPrompt("s", "n", {
    templateOverride:
      `{{ for entry of items }}{{ message "user" }}{{ entry }}{{ /message }}{{ /for }}`,
    userInput: "x",
  });
  assertEquals(r.error, null);
  assertEquals(r.messages, [
    { role: "user", content: "one" },
    { role: "user", content: "two" },
    { role: "user", content: "three" },
  ]);
});

Deno.test("vento-message-tag: nested blocks rejected at compile time", async (t) => {
  await t.step("direct nesting", async () => {
    const r = await render(
      `{{ message "system" }}outer{{ message "user" }}inner{{ /message }}{{ /message }}`,
    );
    assertExists(r.error);
    assertEquals(r.error?.type, "multi-message:nested");
  });

  await t.step("nesting under {{ if false }} still rejected at compile time", async () => {
    const r = await render(
      `{{ message "system" }}outer{{ if false }}{{ message "user" }}inner{{ /message }}{{ /if }}{{ /message }}{{ message "user" }}u{{ /message }}`,
    );
    assertExists(r.error);
    assertEquals(r.error?.type, "multi-message:nested");
  });

  await t.step("nesting under {{ for }} rejected at compile time", async () => {
    const r = await render(
      `{{ message "system" }}o{{ for x of xs }}{{ message "user" }}i{{ /message }}{{ /for }}{{ /message }}`,
    );
    assertExists(r.error);
    assertEquals(r.error?.type, "multi-message:nested");
  });
});

Deno.test("vento-message-tag: invalid literal role rejected at SSTI level for templateOverride", async () => {
  // Disallowed literal "tool" is rejected by the SSTI whitelist before even
  // reaching the plugin's compile-time handler. The non-override path (reading
  // system.md from disk) is covered by the plugin's own SourceError throw —
  // see "missing role expression" below for the same code path under the
  // template-override route.
  const r = await render(`{{ message "tool" }}body{{ /message }}`);
  assertExists(r.error);
  // SSTI rejection produces a "Template Validation Error" without a `type`
  // field — the important guarantee is that the disallowed role NEVER renders.
  assertEquals(r.messages, []);
});

Deno.test("vento-message-tag: invalid identifier role rejected at runtime", async (t) => {
  await t.step("identifier resolves to disallowed role string", async () => {
    const mgr = {
      getPromptVariables: async () => ({
        variables: { r: "tool" },
        fragments: [],
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(mgr);
    const result = await renderSystemPrompt("s", "n", {
      templateOverride: `{{ message r }}b{{ /message }}`,
      userInput: "x",
    });
    assertExists(result.error);
    assertEquals(result.error?.type, "multi-message:invalid-role");
  });

  await t.step("identifier resolves to empty string", async () => {
    const mgr = {
      getPromptVariables: async () => ({
        variables: { r: "" },
        fragments: [],
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(mgr);
    const result = await renderSystemPrompt("s", "n", {
      templateOverride: `{{ message r }}b{{ /message }}`,
      userInput: "x",
    });
    assertExists(result.error);
    assertEquals(result.error?.type, "multi-message:invalid-role");
  });

  await t.step("identifier resolves to non-string", async () => {
    const mgr = {
      getPromptVariables: async () => ({
        variables: { r: 42 },
        fragments: [],
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(mgr);
    const result = await renderSystemPrompt("s", "n", {
      templateOverride: `{{ message r }}b{{ /message }}`,
      userInput: "x",
    });
    assertExists(result.error);
    assertEquals(result.error?.type, "multi-message:invalid-role");
  });
});

Deno.test("vento-message-tag: malformed tag shapes rejected", async (t) => {
  await t.step("unclosed message block", async () => {
    const r = await render(`{{ message "user" }}body with no closer`);
    assertExists(r.error);
  });

  await t.step("stray /message tag", async () => {
    const r = await render(`{{ /message }}{{ message "user" }}u{{ /message }}`);
    assertExists(r.error);
  });

  await t.step("missing role expression rejected by plugin compile-time check", async () => {
    // The bare `{{ message }}` keyword passes the SSTI simple-identifier
    // pattern (which permits any bare identifier) but the plugin's compile-time
    // handler throws SourceError("multi-message:invalid-role: …") which
    // buildVentoError tags as `multi-message:invalid-role`.
    const r = await render(`{{ message }}body{{ /message }}`);
    assertExists(r.error);
    assertEquals(r.error?.type, "multi-message:invalid-role");
  });
});

Deno.test("vento-message-tag: assertHasUserMessage", async (t) => {
  await t.step("no user message produces no-user-message error from renderSystemPrompt", async () => {
    const r = await render(`{{ message "system" }}only system{{ /message }}`);
    assertExists(r.error);
    assertEquals(r.error?.type, "multi-message:no-user-message");
    assertEquals(r.messages, []);
  });

  await t.step("direct unit: assertHasUserMessage throws on no user", () => {
    assertThrows(
      () => assertHasUserMessage([{ role: "system", content: "x" }]),
      Error,
      "multi-message:no-user-message",
    );
  });

  await t.step("direct unit: assertHasUserMessage passes when a user role exists", () => {
    assertHasUserMessage([
      { role: "system", content: "x" },
      { role: "user", content: "y" },
    ]);
  });
});

Deno.test("vento-message-tag: splitRenderedMessages direct unit tests", async (t) => {
  const nonce = "test-nonce-1234";
  const sentinel = (i: number) => `\u0000MSG_${nonce}_${i}\u0000`;

  await t.step("sentinel at start", () => {
    const buffer: ChatMessage[] = [{ role: "user", content: "U" }];
    const out = splitRenderedMessages(`${sentinel(0)} trailing`, nonce, buffer);
    assertEquals(out, [
      { role: "user", content: "U" },
      { role: "system", content: "trailing" },
    ]);
  });

  await t.step("sentinel at end", () => {
    const buffer: ChatMessage[] = [{ role: "user", content: "U" }];
    const out = splitRenderedMessages(`leading ${sentinel(0)}`, nonce, buffer);
    assertEquals(out, [
      { role: "system", content: "leading" },
      { role: "user", content: "U" },
    ]);
  });

  await t.step("adjacent sentinels with no text between", () => {
    const buffer: ChatMessage[] = [
      { role: "user", content: "A" },
      { role: "assistant", content: "B" },
    ];
    const out = splitRenderedMessages(
      `${sentinel(0)}${sentinel(1)}`,
      nonce,
      buffer,
    );
    assertEquals(out, [
      { role: "user", content: "A" },
      { role: "assistant", content: "B" },
    ]);
  });

  await t.step("no sentinels, all text → one system message", () => {
    const out = splitRenderedMessages("just plain text", nonce, []);
    assertEquals(out, [{ role: "system", content: "just plain text" }]);
  });

  await t.step("empty rendered string → empty array", () => {
    const out = splitRenderedMessages("", nonce, []);
    assertEquals(out, []);
  });

  await t.step("whitespace-only rendered string → empty array", () => {
    const out = splitRenderedMessages("   \n\n  ", nonce, []);
    assertEquals(out, []);
  });

  await t.step("out-of-bounds sentinel index → assembly-corrupt", () => {
    const buffer: ChatMessage[] = [{ role: "user", content: "U" }];
    assertThrows(
      () => splitRenderedMessages(sentinel(5), nonce, buffer),
      Error,
      "multi-message:assembly-corrupt",
    );
  });

  await t.step("duplicate sentinel index → assembly-corrupt", () => {
    const buffer: ChatMessage[] = [{ role: "user", content: "U" }];
    assertThrows(
      () => splitRenderedMessages(`${sentinel(0)} ${sentinel(0)}`, nonce, buffer),
      Error,
      "multi-message:assembly-corrupt",
    );
  });

  await t.step("sentinels with mismatched nonce remain literal", () => {
    // A different-nonce sentinel must NOT be matched.
    const otherNonce = "other-nonce";
    const literal = `\u0000MSG_${otherNonce}_0\u0000`;
    const buffer: ChatMessage[] = [{ role: "user", content: "U" }];
    const out = splitRenderedMessages(`prefix ${literal}`, nonce, buffer);
    // The other-nonce sentinel survives as part of the system text.
    assertEquals(out.length, 1);
    assertEquals(out[0]!.role, "system");
    assert(out[0]!.content.includes("MSG_other-nonce_0"));
  });

  await t.step("top-level segments coalesced around messages per design D5", () => {
    const buffer: ChatMessage[] = [
      { role: "user", content: "U" },
      { role: "assistant", content: "A" },
    ];
    const rendered = `text-A${sentinel(0)}text-B\ntext-C${sentinel(1)}text-D`;
    const out = splitRenderedMessages(rendered, nonce, buffer);
    assertEquals(out, [
      { role: "system", content: "text-A" },
      { role: "user", content: "U" },
      { role: "system", content: "text-B\ntext-C" },
      { role: "assistant", content: "A" },
      { role: "system", content: "text-D" },
    ]);
  });

  await t.step("adjacent same-role non-system messages preserved", () => {
    const buffer: ChatMessage[] = [
      { role: "user", content: "A" },
      { role: "user", content: "B" },
    ];
    const out = splitRenderedMessages(`${sentinel(0)}${sentinel(1)}`, nonce, buffer);
    assertEquals(out, [
      { role: "user", content: "A" },
      { role: "user", content: "B" },
    ]);
  });
});

Deno.test("vento-message-tag: per-render nonce isolation under concurrent renders", async () => {
  const mgrA = {
    getPromptVariables: async () => ({
      variables: { tag: "A" },
      fragments: [],
    }),
    getDynamicVariables: async () => ({}),
  } as unknown as PluginManager;
  const mgrB = {
    getPromptVariables: async () => ({
      variables: { tag: "B" },
      fragments: [],
    }),
    getDynamicVariables: async () => ({}),
  } as unknown as PluginManager;

  const engineA = createTemplateEngine(mgrA);
  const engineB = createTemplateEngine(mgrB);

  const tplA = `{{ message "user" }}A:{{ tag }}{{ /message }}`;
  const tplB = `{{ message "user" }}B:{{ tag }}{{ /message }}`;

  const [rA, rB] = await Promise.all([
    engineA.renderSystemPrompt("s", "n", { templateOverride: tplA, userInput: "x" }),
    engineB.renderSystemPrompt("s", "n", { templateOverride: tplB, userInput: "x" }),
  ]);

  assertEquals(rA.error, null);
  assertEquals(rB.error, null);
  assertEquals(rA.messages, [{ role: "user", content: "A:A" }]);
  assertEquals(rB.messages, [{ role: "user", content: "B:B" }]);

  // Concurrent renders on the same engine instance also keep state isolated.
  const [r1, r2] = await Promise.all([
    engineA.renderSystemPrompt("s", "n", {
      templateOverride: `{{ message "user" }}one{{ /message }}`,
      userInput: "x",
    }),
    engineA.renderSystemPrompt("s", "n", {
      templateOverride: `{{ message "user" }}two{{ /message }}`,
      userInput: "x",
    }),
  ]);
  assertEquals(r1.error, null);
  assertEquals(r2.error, null);
  assertEquals(r1.messages, [{ role: "user", content: "one" }]);
  assertEquals(r2.messages, [{ role: "user", content: "two" }]);
});

Deno.test("vento-message-tag: SSTI whitelist accepts and rejects per spec", async (t) => {
  await t.step("accepts literal-role opening tags for the three valid roles", () => {
    for (const role of ALLOWED_MESSAGE_ROLES) {
      assertEquals(
        validateTemplate(`{{ message "${role}" }}body{{ /message }}`),
        [],
        `role ${role} should be accepted`,
      );
    }
  });

  await t.step("accepts identifier-role opening tag", () => {
    assertEquals(
      validateTemplate(`{{ message dynamic_role }}body{{ /message }}`),
      [],
    );
  });

  await t.step("accepts /message closer", () => {
    assertEquals(validateTemplate(`{{ /message }}`), []);
  });

  await t.step("rejects member-access role expression", () => {
    const errs = validateTemplate(`{{ message obj.role }}body{{ /message }}`);
    assert(errs.length > 0);
    assertMatch(errs[0]!, /Unsafe template expression/);
  });

  await t.step("rejects function-call role expression", () => {
    const errs = validateTemplate(`{{ message foo() }}body{{ /message }}`);
    assert(errs.length > 0);
  });

  await t.step("rejects role expression with disallowed string literal at SSTI level", () => {
    // The literal "tool" is rejected by the role-literal regex — only
    // system/user/assistant string literals match.
    const errs = validateTemplate(`{{ message "tool" }}body{{ /message }}`);
    assert(errs.length > 0);
  });

  await t.step("rejects bare `message` keyword at plugin compile-time check", () => {
    // The SSTI whitelist's simple-identifier rule allows the bare `message`
    // keyword to pass validation; rejection happens inside the plugin via
    // SourceError("multi-message:invalid-role: missing role expression").
    // Direct integration coverage lives in the "missing role expression" step
    // above. The validateTemplate-only check here documents the boundary.
    assertEquals(validateTemplate(`{{ message }}`), []);
  });

  await t.step("rejects empty-string role literal", () => {
    const errs = validateTemplate(`{{ message "" }}body{{ /message }}`);
    assert(errs.length > 0);
  });

  await t.step("rejects __messageState identifier through SSTI member access", () => {
    // `__messageState.nonce` is property access — the SSTI whitelist forbids it.
    const errs = validateTemplate(`{{ __messageState.nonce }}`);
    assert(errs.length > 0);
  });

  await t.step("rejects bare __messageState identifier (defence-in-depth)", () => {
    // Any identifier starting with `__` is forbidden, including the bare form,
    // pipe chains, message/if/for operands, and index access. This blocks the
    // side-channel from being read or forged through a user-supplied template.
    assert(validateTemplate(`{{ __messageState }}`).length > 0);
    assert(validateTemplate(`{{ __messageState |> toString }}`).length > 0);
    assert(validateTemplate(`{{ message __messageState }}`).length > 0);
    assert(
      validateTemplate(`{{ for x of __messageState }}body{{ /for }}`).length > 0,
    );
    assert(validateTemplate(`{{ if __messageState }}body{{ /if }}`).length > 0);
    assert(validateTemplate(`{{ __foo.bar }}`).length > 0);
    assert(validateTemplate(`{{ __messageState[0] }}`).length > 0);
  });
});

Deno.test("vento-message-tag: SSTI edge cases (trim markers, single quotes)", () => {
  // Document current behaviour for cross-layer mismatches.
  // Vento trim markers `{{- … -}}` are accepted by the frontend parser as
  // ordinary message tags but are NOT in the backend SSTI whitelist —
  // user-supplied templates with trim markers are rejected at the override
  // path. The default system.md (read from disk) bypasses validateTemplate
  // and therefore is unaffected.
  const trimErrs = validateTemplate(
    `{{- message "user" -}}x{{- /message -}}`,
  );
  assert(trimErrs.length > 0);

  // Single-quoted role literal is NOT in the whitelist (only double quotes).
  const sqErrs = validateTemplate(`{{ message 'user' }}body{{ /message }}`);
  assert(sqErrs.length > 0);
});

Deno.test("vento-message-tag: simple template with no message blocks → single system message via auto-roling", async () => {
  // No {{ message }} block — the whole rendered text is auto-roled to system.
  // assertHasUserMessage will therefore reject this template (no-user-message).
  const r = await render(`Plain {{ user_input }} body`);
  assertExists(r.error);
  assertEquals(r.error?.type, "multi-message:no-user-message");
});

Deno.test("vento-message-tag: empty / whitespace-only message content rejected", async (t) => {
  await t.step("empty user content → multi-message:empty-message", async () => {
    const r = await render(`{{ message "user" }}{{ /message }}`);
    assertExists(r.error);
    assertEquals(r.error?.type, "multi-message:empty-message");
    assertEquals(r.messages, []);
  });

  await t.step("whitespace-only assistant content → multi-message:empty-message", async () => {
    const r = await render(
      `{{ message "user" }}u{{ /message }}{{ message "assistant" }}\n  \n{{ /message }}`,
    );
    assertExists(r.error);
    assertEquals(r.error?.type, "multi-message:empty-message");
  });

  await t.step("mix: valid user + whitespace-only user → rejected", async () => {
    const r = await render(
      `{{ message "user" }}u{{ /message }}{{ message "user" }}   {{ /message }}`,
    );
    assertExists(r.error);
    assertEquals(r.error?.type, "multi-message:empty-message");
  });

  await t.step("direct unit: assertNoEmptyMessages passes for non-empty content", () => {
    assertNoEmptyMessages([
      { role: "user", content: "hi" },
      { role: "system", content: "ok" },
    ]);
  });

  await t.step("direct unit: assertNoEmptyMessages throws for empty content", () => {
    assertThrows(
      () => assertNoEmptyMessages([{ role: "user", content: "   " }]),
      Error,
      "multi-message:empty-message",
    );
  });
});
