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
import { createLogger } from "../lib/logger.ts";
import {
  readStoryLlmConfig,
  writeStoryLlmConfig,
  StoryConfigNotFoundError,
  StoryConfigValidationError,
} from "../lib/story-config.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const log = createLogger("file");

export function registerStoryConfigRoutes(
  app: Hono,
  deps: Pick<AppDeps, "safePath">,
): void {
  const { safePath } = deps;

  // GET /api/:series/:name/config — read per-story LLM overrides
  app.get(
    "/api/:series/:name/config",
    validateParams,
    async (c) => {
      const storyDir = safePath(c.req.param("series")!, c.req.param("name")!);
      if (!storyDir) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }
      // Verify story directory exists (consistent with PUT behaviour)
      try {
        const stat = await Deno.stat(storyDir);
        if (!stat.isDirectory) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        return c.json(problemJson("Internal Server Error", 500, "Failed to stat story directory"), 500);
      }
      try {
        const overrides = await readStoryLlmConfig(storyDir);
        return c.json(overrides);
      } catch (err) {
        if (err instanceof StoryConfigValidationError) {
          return c.json(problemJson("Unprocessable Entity", 422, err.message), 422);
        }
        return c.json(problemJson("Internal Server Error", 500, "Failed to read story config"), 500);
      }
    },
  );

  // PUT /api/:series/:name/config — persist per-story LLM overrides
  app.put(
    "/api/:series/:name/config",
    validateParams,
    async (c) => {
      const series = c.req.param("series")!;
      const name = c.req.param("name")!;
      const storyDir = safePath(series, name);
      if (!storyDir) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      // Require the story directory to already exist — PUT must not implicitly create a story.
      try {
        const stat = await Deno.stat(storyDir);
        if (!stat.isDirectory) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
      } catch (err) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        return c.json(problemJson("Internal Server Error", 500, "Failed to stat story directory"), 500);
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(problemJson("Bad Request", 400, "Invalid JSON body"), 400);
      }

      try {
        const persisted = await writeStoryLlmConfig(storyDir, body);
        log.info("Story config written", { op: "write", series, story: name, fieldCount: Object.keys(persisted).length });
        return c.json(persisted);
      } catch (err) {
        if (err instanceof StoryConfigValidationError) {
          return c.json(problemJson("Bad Request", 400, err.message), 400);
        }
        if (err instanceof StoryConfigNotFoundError) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        return c.json(problemJson("Internal Server Error", 500, "Failed to write story config"), 500);
      }
    },
  );
}
