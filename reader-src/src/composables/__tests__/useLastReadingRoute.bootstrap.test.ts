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

import { createRouter, createMemoryHistory } from "vue-router";
import { defineComponent } from "vue";
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";

const Stub = defineComponent({ template: "<div />" });

function buildRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/", name: "home", component: Stub },
      { path: "/:series", name: "story", component: Stub },
      {
        path: "/:series/:story/chapter/:chapter",
        name: "chapter",
        component: Stub,
      },
      {
        path: "/settings",
        name: "settings",
        component: Stub,
        children: [
          { path: "llm", name: "settings-llm", component: Stub },
          { path: "lore", name: "settings-lore", component: Stub },
        ],
      },
    ],
  });
}

describe("router afterEach + useLastReadingRoute integration", () => {
  beforeEach(() => {
    const { clear } = useLastReadingRoute();
    clear();
  });

  it("captures the very first reading route when guard is registered before navigation", async () => {
    const router = buildRouter();
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    // Mirror main.ts: register the guard BEFORE the initial navigation.
    router.afterEach((to) => recordReadingRoute(to));
    await router.push("/storyA/storyB/chapter/3");
    await router.isReady();
    expect(lastReadingRoute.value).toMatchObject({
      name: "chapter",
      params: { series: "storyA", story: "storyB", chapter: "3" },
    });
  });

  it("leaves the ref null when the user enters directly on a /settings/ route", async () => {
    const router = buildRouter();
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    router.afterEach((to) => recordReadingRoute(to));
    await router.push("/settings/llm");
    await router.isReady();
    expect(lastReadingRoute.value).toBeNull();
  });

  it("preserves the last reading capture across intra-settings navigation", async () => {
    const router = buildRouter();
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    router.afterEach((to) => recordReadingRoute(to));
    await router.push("/storyA");
    await router.push("/settings/llm");
    await router.push("/settings/lore");
    expect(lastReadingRoute.value).toMatchObject({
      name: "story",
      params: { series: "storyA" },
    });
  });

  it("does not misclassify top-level paths whose first segment starts with 'settings'", async () => {
    const router = buildRouter();
    const { lastReadingRoute, recordReadingRoute } = useLastReadingRoute();
    router.afterEach((to) => recordReadingRoute(to));
    await router.push("/settings-archive");
    expect(lastReadingRoute.value).toMatchObject({
      name: "story",
      params: { series: "settings-archive" },
    });
  });
});
