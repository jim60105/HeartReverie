// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU AFFERO GENERAL PUBLIC LICENSE for more details.
//
// You should have received a copy of the GNU AFFERO GENERAL PUBLIC LICENSE
// along with this program. If not, see <https://www.gnu.org/licenses/>.

import { stubSessionStorage } from "@/__tests__/setup";
import { reactive, ref, watch } from "vue";

const routeParams = reactive<Record<string, string | undefined>>({});
const wsConnected = ref(false);
const wsAuthenticated = ref(true);
const wsSend = vi.fn();
const wsHandlers = new Map<string, (msg: unknown) => void>();
const wsOnMessage = vi.fn(
  (type: string, handler: (msg: unknown) => void) => {
    wsHandlers.set(type, handler);
    return vi.fn(() => wsHandlers.delete(type));
  },
);

vi.mock("vue-router", () => ({
  useRoute: () => ({ params: routeParams }),
}));

vi.mock("@/router", () => ({
  default: { replace: vi.fn(() => Promise.resolve()) },
}));

vi.mock("@/composables/useAuth", () => ({
  useAuth: () => ({ getAuthHeaders: () => ({}) }),
}));

vi.mock("@/composables/useWebSocket", () => ({
  useWebSocket: () => ({
    isConnected: wsConnected,
    isAuthenticated: wsAuthenticated,
    send: wsSend,
    onMessage: wsOnMessage,
  }),
}));

function chapterListResponse(chapters: Array<{ number: number; content: string }>) {
  return {
    ok: true,
    status: 200,
    json: async () => chapters,
    headers: new Headers(),
  };
}

describe("useChapterNav — edit refresh & render invalidation", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    routeParams.series = undefined;
    routeParams.story = undefined;
    routeParams.chapter = undefined;
    wsConnected.value = false;
    wsHandlers.clear();
    vi.spyOn(globalThis, "setInterval").mockReturnValue(
      1 as unknown as ReturnType<typeof setInterval>,
    );
    vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function getNav() {
    const mod = await import("@/composables/useChapterNav");
    return mod.useChapterNav();
  }

  it("refreshAfterEdit keeps the user on the edited chapter (not the last)", async () => {
    const initialChapters = [
      { number: 1, content: "c1" },
      { number: 2, content: "c2" },
      { number: 3, content: "c3" },
    ];
    const editedChapters = [
      { number: 1, content: "c1" },
      { number: 2, content: "c2-edited" },
      { number: 3, content: "c3" },
    ];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chapterListResponse(initialChapters))
      .mockResolvedValueOnce(chapterListResponse(editedChapters));
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a", 2);
    expect(nav.currentIndex.value).toBe(1);
    expect(nav.currentContent.value).toBe("c2");

    await nav.refreshAfterEdit(2);

    expect(nav.currentIndex.value).toBe(1);
    expect(nav.currentContent.value).toBe("c2-edited");
  });

  it("byte-identical commit still invalidates dependents and bumps renderEpoch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "same" }]))
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "same" }]));
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a", 1);

    let watchHits = 0;
    const stopper = watch(nav.currentContent, () => {
      watchHits++;
    });
    const epochBefore = nav.renderEpoch.value;

    await nav.refreshAfterEdit(1);

    // Vue resolves watcher callbacks asynchronously; await a microtask.
    await Promise.resolve();
    await Promise.resolve();

    expect(nav.currentContent.value).toBe("same");
    expect(nav.renderEpoch.value).toBeGreaterThan(epochBefore);
    expect(watchHits).toBeGreaterThan(0);

    stopper();
  });

  it("clamps targetChapter into range when chapters were truncated", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        chapterListResponse([
          { number: 1, content: "c1" },
          { number: 2, content: "c2" },
          { number: 3, content: "c3" },
        ]),
      )
      .mockResolvedValueOnce(chapterListResponse([{ number: 1, content: "c1" }]));
    vi.stubGlobal("fetch", fetchMock);

    const nav = await getNav();
    await nav.loadFromBackend("series-a", "story-a", 3);
    expect(nav.currentIndex.value).toBe(2);

    await nav.refreshAfterEdit(3);

    expect(nav.currentIndex.value).toBe(0);
    expect(nav.currentContent.value).toBe("c1");
  });
});
