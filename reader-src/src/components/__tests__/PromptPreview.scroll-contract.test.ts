// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CSS contract tests for PromptPreview scoped styles.
 *
 * Validates `.preview-root` and the hardened `.preview-content` clip rules
 * required by the prompt-editor independent-scroll capability.
 */
import { describe, expect, it } from "vitest";
import promptPreviewSource from "../PromptPreview.vue?raw";

function extractRule(source: string, selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`);
  const match = source.match(re);
  return match ? match[1] ?? null : null;
}

describe("PromptPreview.vue — preview-root clip contract", () => {
  it("declares flex: 1, min-height: 0, and overflow: hidden", () => {
    const body = extractRule(promptPreviewSource, ".preview-root");
    expect(body, ".preview-root rule must exist").not.toBeNull();
    expect(body!).toMatch(/flex:\s*1\s*;/);
    expect(body!).toMatch(/min-height:\s*0\s*;/);
    expect(body!).toMatch(/overflow:\s*hidden\s*;/);
  });
});

describe("PromptPreview.vue — preview-content hardened scroll contract", () => {
  it("declares flex: 1, overflow: auto, min-height: 0, margin: 0, box-sizing: border-box", () => {
    const body = extractRule(promptPreviewSource, ".preview-content");
    expect(body, ".preview-content rule must exist").not.toBeNull();
    expect(body!).toMatch(/flex:\s*1\s*;/);
    expect(body!).toMatch(/overflow:\s*auto\s*;/);
    expect(body!).toMatch(/min-height:\s*0\s*;/);
    expect(body!).toMatch(/margin:\s*0\s*;/);
    expect(body!).toMatch(/box-sizing:\s*border-box\s*;/);
  });
});
