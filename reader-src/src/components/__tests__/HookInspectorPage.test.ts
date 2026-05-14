// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";

const getAuthHeadersMock = vi.fn(() => ({ "X-Passphrase": "test-pass" }));
vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({ getAuthHeaders: getAuthHeadersMock }),
}));
vi.mock("@/composables/useNotification", () => ({
  useNotification: () => ({ notify: () => {} }),
}));

const sampleDump = {
  backend: {
    "post-response": [
      { plugin: "demo", priority: 100, errorCount: 7 },
    ],
  },
  manifestDeclarations: [
    { plugin: "demo", hooks: [{ stage: "post-response" }] },
  ],
  stripTags: [],
  pipelineFields: [{ stage: "response-stream", field: "chunk" }],
  generatedAt: "2026-01-01T00:00:00Z",
};

describe("HookInspectorPage", () => {
  beforeEach(() => {
    getAuthHeadersMock.mockClear();
  });

  it("fetches with X-Passphrase header and renders stage blocks", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleDump,
    });
    vi.stubGlobal("fetch", fetchMock);

    const HookInspectorPage = (
      await import("@/components/HookInspectorPage.vue")
    ).default;
    const wrapper = mount(HookInspectorPage);
    await nextTick();
    await new Promise((r) => setTimeout(r, 10));
    await nextTick();

    expect(fetchMock).toHaveBeenCalled();
    const call = fetchMock.mock.calls[0]!;
    expect(call[0]).toBe("/api/plugin-introspection/hooks");
    expect(call[1]?.headers).toEqual({ "X-Passphrase": "test-pass" });

    const html = wrapper.html();
    expect(html).toContain("post-response");
    expect(html).toContain("demo");
    expect(html).toContain("自上次重啟以來");
  });

  it("401 surfaces a passphrase error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    const HookInspectorPage = (
      await import("@/components/HookInspectorPage.vue")
    ).default;
    const wrapper = mount(HookInspectorPage);
    await nextTick();
    await new Promise((r) => setTimeout(r, 10));
    await nextTick();

    expect(wrapper.html()).toContain("通行碼");
  });

  it("Refresh button re-fetches the report", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => sampleDump,
    });
    vi.stubGlobal("fetch", fetchMock);

    const HookInspectorPage = (
      await import("@/components/HookInspectorPage.vue")
    ).default;
    const wrapper = mount(HookInspectorPage);
    await nextTick();
    await new Promise((r) => setTimeout(r, 10));

    const initialCount = fetchMock.mock.calls.length;
    const btn = wrapper.findAll("button").find((b) => /refresh|重新整理|更新/i.test(b.text()));
    expect(btn?.exists()).toBe(true);
    await btn!.trigger("click");
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCount);
  });
});
