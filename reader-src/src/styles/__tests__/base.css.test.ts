// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CSS contract test for the prompt-editor independent-scroll cap.
 *
 * Validates that `reader-src/src/styles/base.css` contains the route-scoped
 * `:has(.editor-page)` rule that pins the settings shell to the viewport.
 *
 * The frontend test environment is Happy DOM, which does not perform real
 * layout. This test asserts only the source-text declaration; runtime layout
 * is verified by manual browser smoke (see openspec design.md Decision 6).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

declare const process: { cwd(): string };

const baseCss = readFileSync(
  resolve(process.cwd(), "src/styles/base.css"),
  "utf8",
);

describe("base.css — settings layout viewport cap (prompt-editor route)", () => {
  it("declares a :has(.editor-page) rule on .settings-layout with boosted specificity", () => {
    // Duplicated class chain `.settings-layout.settings-layout` raises
    // specificity above the scoped `.settings-layout[data-v-*]` rule in
    // SettingsLayout.vue so the min-height neutralization wins on mobile.
    expect(baseCss).toContain(
      ".settings-layout.settings-layout:has(.editor-page)",
    );
  });

  it("caps the height to 100vh / 100dvh, neutralizes min-height, and hides overflow", () => {
    // Extract the rule body for the boosted-specificity selector.
    const match = baseCss.match(
      /\.settings-layout\.settings-layout:has\(\.editor-page\)\s*\{([^}]*)\}/,
    );
    expect(match, "rule block must exist").not.toBeNull();
    const body = match![1] ?? "";
    expect(body).toMatch(/height:\s*100vh\s*;/);
    expect(body).toMatch(/height:\s*100dvh\s*;/);
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow:\s*hidden\s*;/);
  });

  it("declares 100vh before 100dvh so older browsers fall back gracefully", () => {
    const match = baseCss.match(
      /\.settings-layout\.settings-layout:has\(\.editor-page\)\s*\{([^}]*)\}/,
    );
    const body = match![1] ?? "";
    const idxVh = body.indexOf("100vh");
    const idxDvh = body.indexOf("100dvh");
    expect(idxVh).toBeGreaterThanOrEqual(0);
    expect(idxDvh).toBeGreaterThan(idxVh);
  });
});
