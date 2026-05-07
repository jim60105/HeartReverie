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

import { isReservedDirectoryName, validateParams } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const log = createLogger("file");

export function registerStoriesRoutes(app: Hono, deps: Pick<AppDeps, "safePath" | "config">): void {
  const { safePath, config } = deps;

  // GET /api/stories — list series
  app.get("/api/stories", async (c) => {
    try {
      const entries = [];
      for await (const entry of Deno.readDir(config.PLAYGROUND_DIR)) {
        entries.push(entry);
      }
      const dirs = entries
        .filter(
          (e) =>
            e.isDirectory &&
            !e.name.startsWith(".") &&
            !isReservedDirectoryName(e.name)
        )
        .map((e) => e.name);
      return c.json(dirs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[GET /api/stories] ${message}`);
      return c.json(problemJson("Internal Server Error", 500, "Failed to list stories"), 500);
    }
  });

  // GET /api/stories/:series — list stories in a series
  app.get("/api/stories/:series", validateParams, async (c) => {
    const dirPath = safePath(c.req.param("series")!);
    if (!dirPath) {
      return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
    }

    try {
      const entries = [];
      for await (const entry of Deno.readDir(dirPath)) {
        entries.push(entry);
      }
      const dirs = entries
        .filter((e) => e.isDirectory && !e.name.startsWith(".") && !isReservedDirectoryName(e.name))
        .map((e) => e.name);
      return c.json(dirs);
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        return c.json(problemJson("Not Found", 404, "Series not found"), 404);
      }
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[GET /api/stories/:series] ${message}`);
      return c.json(problemJson("Internal Server Error", 500, "Failed to list series"), 500);
    }
  });
}
