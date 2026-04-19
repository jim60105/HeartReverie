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

import { ref } from "vue";
import { stubSessionStorage } from "@/__tests__/setup";

const selectedSeries = ref("");
const selectedStory = ref("");

vi.mock("@/composables/useStorySelector", () => ({
  useStorySelector: () => ({
    selectedSeries,
    selectedStory,
    seriesList: ref([]),
    storyList: ref([]),
    fetchSeries: vi.fn(),
    fetchStories: vi.fn(),
    createStory: vi.fn(),
    navigateToStory: vi.fn(),
  }),
}));

describe("usePromptEditor preview and error paths", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    selectedSeries.value = "";
    selectedStory.value = "";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function getEditor() {
    const { usePromptEditor } = await import("@/composables/usePromptEditor");
    return usePromptEditor();
  }

  it("save throws fallback error detail when backend json parse fails", async () => {
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.includes("/api/plugins/parameters")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), headers: new Headers() });
      }
      if (init?.method === "PUT") {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.reject(new Error("invalid")), headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: "base", source: "default" }),
        headers: new Headers(),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "dirty";

    await expect(editor.save()).rejects.toThrow("Failed to save template");
  });

  it("previewTemplate uses fallback preview message and includes template when dirty", async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes("/api/plugins/parameters")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), headers: new Headers() });
      }
      if (url.includes("/preview-prompt")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ prompt: "ok" }), headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: "saved", source: "default" }),
        headers: new Headers(),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const editor = await getEditor();
    await editor.loadTemplate();
    editor.templateContent.value = "unsaved template";

    const result = await editor.previewTemplate("s", "t", "");
    expect(result).toEqual({ prompt: "ok" });

    const previewCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/preview-prompt"));
    const body = JSON.parse((previewCall?.[1] as RequestInit).body as string);
    expect(body.message).toBe("(preview)");
    expect(body.template).toBe("unsaved template");
  });

  it("previewTemplate throws backend message/detail on failure", async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.includes("/api/plugins/parameters")) {
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]), headers: new Headers() });
      }
      if (url.includes("/preview-prompt")) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () => Promise.resolve({ message: "bad preview" }),
          headers: new Headers(),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ content: "saved", source: "default" }),
        headers: new Headers(),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const editor = await getEditor();
    await expect(editor.previewTemplate("s", "t", "msg")).rejects.toThrow("bad preview");
  });
});
