// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { stubLocalStorage } from "@/__tests__/setup";
import ThemeSettingsPage from "@/components/ThemeSettingsPage.vue";

const THEME_LIST = [
  { id: "default", label: "心夢預設" },
  { id: "light", label: "晴書紙本" },
  { id: "dark", label: "月硯墨靜" },
];

const LIGHT_PAYLOAD = {
  id: "light",
  label: "晴書紙本",
  colorScheme: "light",
  backgroundImage: "",
  palette: { "--text-main": "rgba(40, 36, 32, 1)" },
};

function mockFetchRouter(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url === "/api/themes") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(THEME_LIST),
          text: () => Promise.resolve(JSON.stringify(THEME_LIST)),
          headers: new Headers(),
        });
      }
      if (url.startsWith("/api/themes/light")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(LIGHT_PAYLOAD),
          text: () => Promise.resolve(JSON.stringify(LIGHT_PAYLOAD)),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ status: 404, title: "Not Found" }),
        text: () => Promise.resolve(""),
        headers: new Headers(),
      });
    }),
  );
}

describe("ThemeSettingsPage", () => {
  beforeEach(() => {
    vi.resetModules();
    stubLocalStorage();
    mockFetchRouter();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders one option per theme returned by /api/themes", async () => {
    const wrapper = mount(ThemeSettingsPage);
    await flushPromises();
    const options = wrapper.findAll("option");
    expect(options.length).toBe(3);
    expect(options.map((o) => o.attributes("value"))).toEqual(["default", "light", "dark"]);
    expect(options.map((o) => o.text())).toEqual(["心夢預設", "晴書紙本", "月硯墨靜"]);
  });

  it("selecting an option triggers selectTheme and updates localStorage", async () => {
    const wrapper = mount(ThemeSettingsPage);
    await flushPromises();
    const select = wrapper.find("select");
    await select.setValue("light");
    await flushPromises();
    expect(localStorage.getItem("heartReverie.themeId")).toBe("light");
    const cached = localStorage.getItem("heartReverie.themeCache.light");
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toMatchObject({ id: "light" });
  });
});
