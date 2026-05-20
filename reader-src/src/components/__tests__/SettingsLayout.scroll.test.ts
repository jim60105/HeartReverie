// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CSS contract test for the SettingsLayout independent-scroll cap.
 *
 * Validates that `SettingsLayout.vue` scoped style caps the layout to the
 * viewport, neutralizes inherited min-heights, and makes the drawer and the
 * content area scroll independently. Happy DOM does not perform real layout,
 * so this test asserts source-text declarations; runtime scroll behaviour is
 * verified by agent-browser smoke (see openspec design.md).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

declare const process: { cwd(): string };

const sfc = readFileSync(
  resolve(process.cwd(), "src/components/SettingsLayout.vue"),
  "utf8",
);

function extractBlock(selector: string): string {
  // Selector must appear as the start of a rule (possibly the first selector
  // of a list). We match until the matching close-brace, assuming no nested
  // braces (the layout's scoped rules are flat).
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = sfc.match(re);
  if (!m) throw new Error(`selector not found: ${selector}`);
  return m[1] ?? "";
}

describe("SettingsLayout.vue — independent scroll contract", () => {
  it(".settings-layout caps to 100vh/100dvh and hides overflow", () => {
    const body = extractBlock(".settings-layout");
    expect(body).toMatch(/height:\s*100vh\s*;/);
    expect(body).toMatch(/height:\s*100dvh\s*;/);
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow:\s*hidden\s*;/);
    expect(body).toMatch(/display:\s*flex\s*;/);
    expect(body).toMatch(/flex-direction:\s*column\s*;/);
  });

  it(".settings-layout declares 100vh before 100dvh for graceful fallback", () => {
    const body = extractBlock(".settings-layout");
    const idxVh = body.indexOf("100vh");
    const idxDvh = body.indexOf("100dvh");
    expect(idxVh).toBeGreaterThanOrEqual(0);
    expect(idxDvh).toBeGreaterThan(idxVh);
  });

  it(".settings-body has min-height: 0 and overflow: hidden", () => {
    const body = extractBlock(".settings-body");
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow:\s*hidden\s*;/);
    expect(body).toMatch(/flex:\s*1\s*;/);
  });

  it(".settings-sidebar has min-height: 0 and overflow-y: auto", () => {
    const body = extractBlock(".settings-sidebar");
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow-y:\s*auto\s*;/);
  });

  it(".settings-content has min-height: 0 and overflow-y: auto", () => {
    const body = extractBlock(".settings-content");
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow-y:\s*auto\s*;/);
    expect(body).toMatch(/min-width:\s*0\s*;/);
    expect(body).toMatch(/flex:\s*1\s*;/);
  });

  it("the old min-height: 100vh declaration is gone from .settings-layout", () => {
    const body = extractBlock(".settings-layout");
    expect(body).not.toMatch(/min-height:\s*100vh/);
  });
});
