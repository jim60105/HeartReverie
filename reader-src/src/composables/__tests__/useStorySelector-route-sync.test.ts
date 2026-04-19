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

import { reactive, ref, nextTick } from "vue";
import { stubSessionStorage } from "@/__tests__/setup";

const route = reactive({
  params: {
    series: undefined as string | undefined,
    story: undefined as string | undefined,
  },
});

const usageReset = vi.fn();
const usageLoad = vi.fn(() => Promise.resolve());
const routerPush = vi.fn();

vi.mock("vue-router", () => ({
  useRoute: () => route,
}));

vi.mock("@/router", () => ({
  default: {
    push: routerPush,
  },
}));

vi.mock("@/composables/useUsage", () => ({
  useUsage: () => ({
    records: ref([]),
    totals: ref({ promptTokens: 0, completionTokens: 0, totalTokens: 0, count: 0 }),
    currentKey: ref(""),
    load: usageLoad,
    pushRecord: vi.fn(),
    reset: usageReset,
  }),
}));

describe("useStorySelector route synchronization", () => {
  beforeEach(() => {
    vi.resetModules();
    stubSessionStorage();
    route.params.series = undefined;
    route.params.story = undefined;
    usageReset.mockClear();
    usageLoad.mockClear();
    routerPush.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(url.includes("/api/stories/") ? ["story-a"] : ["series-a"]),
          headers: new Headers(),
        })
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function flushRouteSync(): Promise<void> {
    await nextTick();
    await Promise.resolve();
    await Promise.resolve();
  }

  it("reacts to route params by syncing selection and usage", async () => {
    const { useStorySelector } = await import("@/composables/useStorySelector");
    const selector = useStorySelector();

    route.params.series = "series-a";
    route.params.story = "story-a";
    await flushRouteSync();

    expect(selector.selectedSeries.value).toBe("series-a");
    expect(selector.selectedStory.value).toBe("story-a");
    expect(usageReset).toHaveBeenCalled();
    expect(usageLoad).toHaveBeenCalledWith("series-a", "story-a");
  });

  it("changing selectedSeries clears story and loads stories unless route already matches", async () => {
    const { useStorySelector } = await import("@/composables/useStorySelector");
    const selector = useStorySelector();

    route.params.series = "same-series";
    selector.selectedStory.value = "keep";
    selector.selectedSeries.value = "same-series";
    await flushRouteSync();

    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    const beforeCalls = fetchMock.mock.calls.length;

    selector.selectedSeries.value = "other-series";
    await flushRouteSync();

    expect(selector.selectedStory.value).toBe("");
    expect(fetchMock.mock.calls.length).toBeGreaterThan(beforeCalls);
  });
});
