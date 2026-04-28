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

import { useLastReadingRoute } from "@/composables/useLastReadingRoute";
import type { RouteLocationNormalizedLoaded } from "vue-router";

function makeRoute(
  partial: Partial<RouteLocationNormalizedLoaded> & { path: string },
): RouteLocationNormalizedLoaded {
  return {
    name: undefined,
    params: {},
    query: {},
    hash: "",
    fullPath: partial.path,
    matched: [],
    meta: {},
    redirectedFrom: undefined,
    ...partial,
  } as RouteLocationNormalizedLoaded;
}

describe("useLastReadingRoute", () => {
  beforeEach(() => {
    const { clear } = useLastReadingRoute();
    clear();
  });

  it("captures a non-settings named route into the ref", () => {
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    const to = makeRoute({
      path: "/storyA/storyB/chapter/3",
      name: "chapter",
      params: { series: "storyA", story: "storyB", chapter: "3" },
      query: { x: "1" },
      hash: "#anchor",
    });
    recordReadingRoute(to);
    expect(lastReadingRoute.value).toEqual({
      name: "chapter",
      params: { series: "storyA", story: "storyB", chapter: "3" },
      query: { x: "1" },
      hash: "#anchor",
    });
  });

  it("is a no-op when given exactly /settings (preserves previous value: null)", () => {
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    recordReadingRoute(makeRoute({ path: "/settings", name: "settings" }));
    expect(lastReadingRoute.value).toBeNull();
  });

  it("is a no-op when given a /settings/ child path (preserves previous reading capture)", () => {
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    recordReadingRoute(
      makeRoute({ path: "/storyA", name: "story", params: { series: "storyA" } }),
    );
    const before = lastReadingRoute.value;
    recordReadingRoute(makeRoute({ path: "/settings/llm", name: "settings-llm" }));
    expect(lastReadingRoute.value).toEqual(before);
    expect(lastReadingRoute.value).toEqual({
      name: "story",
      params: { series: "storyA" },
      query: {},
      hash: "",
    });
  });

  it("DOES capture a top-level path whose first segment merely starts with 'settings' (predicate edge case)", () => {
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    recordReadingRoute(
      makeRoute({
        path: "/settings-archive/my-story",
        name: "story",
        params: { series: "settings-archive", story: "my-story" },
      }),
    );
    expect(lastReadingRoute.value).toEqual({
      name: "story",
      params: { series: "settings-archive", story: "my-story" },
      query: {},
      hash: "",
    });
  });

  it("overwrites the ref when called repeatedly with different non-settings routes (newest wins)", () => {
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    recordReadingRoute(makeRoute({ path: "/", name: "home" }));
    recordReadingRoute(
      makeRoute({ path: "/storyA", name: "story", params: { series: "storyA" } }),
    );
    expect(lastReadingRoute.value).toMatchObject({
      name: "story",
      params: { series: "storyA" },
    });
  });

  it("captures unnamed routes via path fallback (no fullPath string)", () => {
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    recordReadingRoute(
      makeRoute({ path: "/some/unnamed/path", query: { y: "2" }, hash: "" }),
    );
    expect(lastReadingRoute.value).toEqual({
      path: "/some/unnamed/path",
      query: { y: "2" },
      hash: "",
    });
    expect(lastReadingRoute.value).not.toHaveProperty("name");
  });

  it("clear() resets the ref to null", () => {
    const { lastReadingRoute, recordReadingRoute, clear } = useLastReadingRoute();
    recordReadingRoute(makeRoute({ path: "/storyA", name: "story" }));
    expect(lastReadingRoute.value).not.toBeNull();
    clear();
    expect(lastReadingRoute.value).toBeNull();
  });

  it("multiple useLastReadingRoute() calls share the same ref (singleton)", () => {
    const a = useLastReadingRoute();
    const b = useLastReadingRoute();
    a.recordReadingRoute(makeRoute({ path: "/storyA", name: "story" }));
    expect(b.lastReadingRoute.value).toEqual(a.lastReadingRoute.value);
    expect(b.lastReadingRoute.value).not.toBeNull();
  });
});
