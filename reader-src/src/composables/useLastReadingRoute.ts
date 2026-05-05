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

import { ref, type Ref } from "vue";
import type {
  RouteLocationNormalizedLoaded,
  RouteLocationRaw,
} from "vue-router";
import { isReadingRoute } from "@/router/isReadingRoute";

/**
 * Module-level singleton ref tracking the user's most recent reading route
 * (any route whose path is neither exactly `/settings` nor starts with
 * `/settings/`). The settings sidebar back button reads this to navigate
 * directly out of the settings tree, bypassing intra-settings history.
 *
 * Stored shape is the portable `{ name, params, query, hash }` form when the
 * route is named, or `{ path, query, hash }` as a defensive fallback for
 * unnamed routes. Never a fullPath string — that does not survive route-record
 * renames.
 *
 * In-memory only; not persisted across page reloads.
 */
const lastReadingRoute = ref<RouteLocationRaw | null>(null);

export interface UseLastReadingRouteReturn {
  lastReadingRoute: Ref<RouteLocationRaw | null>;
  recordReadingRoute(to: RouteLocationNormalizedLoaded): void;
  clear(): void;
}

/**
 * Composable accessor for the last-reading-route singleton. The returned ref
 * is shared across all callers, so mutations are observed everywhere.
 */
export function useLastReadingRoute(): UseLastReadingRouteReturn {
  return {
    lastReadingRoute,
    /**
     * Record `to` as the most recent reading route, unless `to` is a settings
     * or tools route (in which case this is a no-op so the existing capture
     * is preserved across intra-settings / intra-tools tab navigation).
     */
    recordReadingRoute(to: RouteLocationNormalizedLoaded): void {
      if (!isReadingRoute(to.path)) return;
      if (typeof to.name === "string" && to.name.length > 0) {
        lastReadingRoute.value = {
          name: to.name,
          params: { ...to.params },
          query: { ...to.query },
          hash: to.hash,
        };
      } else {
        lastReadingRoute.value = {
          path: to.path,
          query: { ...to.query },
          hash: to.hash,
        };
      }
    },
    /**
     * Reset the singleton ref to `null`. Intended for test isolation; not
     * called by production code.
     */
    clear(): void {
      lastReadingRoute.value = null;
    },
  };
}
