// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * CSS contract test for the ToolsLayout independent-scroll cap.
 *
 * Mirrors SettingsLayout.scroll.test.ts for ToolsLayout. Happy DOM does not
 * perform real layout, so this test asserts source-text declarations; runtime
 * scroll behaviour is verified by agent-browser smoke.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

declare const process: { cwd(): string };

const sfc = readFileSync(
  resolve(process.cwd(), "src/components/ToolsLayout.vue"),
  "utf8",
);

function extractBlock(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`);
  const m = sfc.match(re);
  if (!m) throw new Error(`selector not found: ${selector}`);
  return m[1] ?? "";
}

describe("ToolsLayout.vue — independent scroll contract", () => {
  it(".tools-layout caps to 100vh/100dvh and hides overflow", () => {
    const body = extractBlock(".tools-layout");
    expect(body).toMatch(/height:\s*100vh\s*;/);
    expect(body).toMatch(/height:\s*100dvh\s*;/);
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow:\s*hidden\s*;/);
    expect(body).toMatch(/display:\s*flex\s*;/);
    expect(body).toMatch(/flex-direction:\s*column\s*;/);
  });

  it(".tools-layout declares 100vh before 100dvh for graceful fallback", () => {
    const body = extractBlock(".tools-layout");
    const idxVh = body.indexOf("100vh");
    const idxDvh = body.indexOf("100dvh");
    expect(idxVh).toBeGreaterThanOrEqual(0);
    expect(idxDvh).toBeGreaterThan(idxVh);
  });

  it(".tools-body has min-height: 0 and overflow: hidden", () => {
    const body = extractBlock(".tools-body");
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow:\s*hidden\s*;/);
    expect(body).toMatch(/flex:\s*1\s*;/);
  });

  it(".tools-sidebar has min-height: 0 and overflow-y: auto", () => {
    const body = extractBlock(".tools-sidebar");
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow-y:\s*auto\s*;/);
  });

  it(".tools-content has min-height: 0 and overflow-y: auto", () => {
    const body = extractBlock(".tools-content");
    expect(body).toMatch(/min-height:\s*0\s*;/);
    expect(body).toMatch(/overflow-y:\s*auto\s*;/);
    expect(body).toMatch(/min-width:\s*0\s*;/);
    expect(body).toMatch(/flex:\s*1\s*;/);
  });

  it("the old min-height: 100vh declaration is gone from .tools-layout", () => {
    const body = extractBlock(".tools-layout");
    expect(body).not.toMatch(/min-height:\s*100vh/);
  });
});
