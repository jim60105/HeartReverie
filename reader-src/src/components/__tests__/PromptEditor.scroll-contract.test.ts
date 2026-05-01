// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CSS contract tests for PromptEditor scoped styles.
 *
 * Validates that the `.editor-textarea-wrap` clip rules and `.editor-textarea`
 * sizing rules required by the prompt-editor independent-scroll capability
 * are present in the SFC source. Asserts source text only — runtime layout
 * is verified by manual browser smoke (Happy DOM does not perform layout).
 */
import { describe, expect, it } from "vitest";
import promptEditorSource from "../PromptEditor.vue?raw";

function extractRule(source: string, selector: string): string | null {
  // Match the selector at the start of a rule (whitespace/newline before it),
  // then capture everything up to the matching closing brace. Naive but
  // sufficient for the simple flat scoped style block in PromptEditor.vue.
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`);
  const match = source.match(re);
  return match ? match[1] ?? null : null;
}

describe("PromptEditor.vue — editor-textarea-wrap clip contract", () => {
  it("declares flex: 1, min-height: 0, and overflow: hidden", () => {
    const body = extractRule(promptEditorSource, ".editor-textarea-wrap");
    expect(body, ".editor-textarea-wrap rule must exist").not.toBeNull();
    expect(body!).toMatch(/flex:\s*1\s*;/);
    expect(body!).toMatch(/min-height:\s*0\s*;/);
    expect(body!).toMatch(/overflow:\s*hidden\s*;/);
  });
});

describe("PromptEditor.vue — editor-textarea fills its wrap", () => {
  it("declares width: 100%, height: 100%, and resize: none", () => {
    const body = extractRule(promptEditorSource, ".editor-textarea");
    expect(body, ".editor-textarea rule must exist").not.toBeNull();
    expect(body!).toMatch(/width:\s*100%\s*;/);
    expect(body!).toMatch(/height:\s*100%\s*;/);
    expect(body!).toMatch(/resize:\s*none\s*;/);
  });
});
