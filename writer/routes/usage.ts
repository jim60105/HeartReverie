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

import { validateParams } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import { readUsage, computeTotals } from "../lib/usage.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

/**
 * Register `GET /api/stories/:series/:name/usage` — returns the persisted
 * token usage records for a story plus computed totals.
 */
export function registerUsageRoutes(
  app: Hono,
  deps: Pick<AppDeps, "safePath">,
): void {
  const { safePath } = deps;

  app.get(
    "/api/stories/:series/:name/usage",
    validateParams,
    async (c) => {
      const storyDir = safePath(c.req.param("series")!, c.req.param("name")!);
      if (!storyDir) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }
      const records = await readUsage(storyDir);
      const totals = computeTotals(records);
      return c.json({ records, totals });
    },
  );
}
