// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubLocalStorage } from "@/__tests__/setup";

const SAMPLE_THEME = {
  id: "light",
  label: "Light",
  colorScheme: "light",
  backgroundImage: "url('/assets/heart.webp')",
  palette: {
    "--text-main": "rgba(40, 36, 32, 1)",
    "--panel-bg": "#EAE4D8",
  },
};

function mockFetchSequence(responses: Array<{ status: number; body: unknown }>): void {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      const r = responses[Math.min(i++, responses.length - 1)]!;
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
        text: () => Promise.resolve(JSON.stringify(r.body)),
        headers: new Headers(),
      });
    }),
  );
}

describe("useTheme", () => {
  beforeEach(() => {
    vi.resetModules();
    stubLocalStorage();
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getUseTheme() {
    const mod = await import("@/composables/useTheme");
    return mod.useTheme();
  }

  it("applyTheme writes palette to documentElement", async () => {
    mockFetchSequence([{ status: 200, body: SAMPLE_THEME }]);
    const { applyTheme } = await getUseTheme();
    applyTheme(SAMPLE_THEME);
    expect(document.documentElement.style.getPropertyValue("--text-main")).toBe(
      "rgba(40, 36, 32, 1)",
    );
    expect(document.documentElement.style.getPropertyValue("--panel-bg")).toBe("#EAE4D8");
    expect(document.documentElement.style.getPropertyValue("color-scheme")).toBe("light");
  });

  it("applyTheme writes backgroundImage verbatim to body", async () => {
    mockFetchSequence([{ status: 200, body: SAMPLE_THEME }]);
    const { applyTheme } = await getUseTheme();
    applyTheme(SAMPLE_THEME);
    // Browser-normalised form may use double quotes; assert the URL is present.
    expect(document.body.style.backgroundImage).toContain("/assets/heart.webp");
    expect(document.body.style.backgroundImage).toMatch(/^url\(/);
  });

  it("applyTheme accepts a CSS gradient as backgroundImage", async () => {
    const gradient = "linear-gradient(160deg, #F5F0E6 0%, #E8E0D2 100%)";
    const theme = { ...SAMPLE_THEME, backgroundImage: gradient };
    mockFetchSequence([{ status: 200, body: theme }]);
    const { applyTheme } = await getUseTheme();
    applyTheme(theme);
    expect(document.body.style.backgroundImage).toContain("linear-gradient");
  });

  it("applyTheme clears the body image when backgroundImage is empty", async () => {
    mockFetchSequence([{ status: 200, body: { ...SAMPLE_THEME, backgroundImage: "" } }]);
    const { applyTheme } = await getUseTheme();
    document.body.style.backgroundImage = "url('stale')";
    applyTheme({ ...SAMPLE_THEME, backgroundImage: "" });
    expect(document.body.style.backgroundImage).toBe("none");
  });

  it("selectTheme persists id and caches the payload in localStorage", async () => {
    mockFetchSequence([{ status: 200, body: SAMPLE_THEME }]);
    const { selectTheme } = await getUseTheme();
    await selectTheme("light");
    expect(localStorage.getItem("heartReverie.themeId")).toBe("light");
    const cached = localStorage.getItem("heartReverie.themeCache.light");
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toMatchObject({ id: "light" });
  });

  it("selectTheme falls back to default and clears the stale id on 404", async () => {
    localStorage.setItem("heartReverie.themeId", "vanished");
    mockFetchSequence([
      { status: 404, body: { title: "Not Found", status: 404 } },
      { status: 200, body: SAMPLE_THEME },
    ]);
    const { selectTheme, currentThemeId } = await getUseTheme();
    await selectTheme("vanished");
    expect(currentThemeId.value).toBe("default");
    // After fallback, the default fetch succeeded and persisted "default"
    expect(localStorage.getItem("heartReverie.themeId")).toBe("default");
  });

  it("listThemes populates the themes ref", async () => {
    mockFetchSequence([{ status: 200, body: [{ id: "default", label: "預設" }, { id: "light", label: "Light" }] }]);
    const { listThemes, themes } = await getUseTheme();
    await listThemes();
    expect(themes.value.length).toBe(2);
    expect(themes.value[0]!.id).toBe("default");
  });
});
