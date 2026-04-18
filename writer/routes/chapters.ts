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

import { join } from "@std/path";
import { validateParams } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const log = createLogger("file");

export function registerChapterRoutes(app: Hono, deps: Pick<AppDeps, "safePath">): void {
  const { safePath } = deps;

  // GET /api/stories/:series/:name/chapters — list chapters
  // Query params: ?include=content — returns [{number, content}] instead of [number]
  app.get(
    "/api/stories/:series/:name/chapters",
    validateParams,
    async (c) => {
      const dirPath = safePath(c.req.param("series")!, c.req.param("name")!);
      if (!dirPath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      const includeContent = c.req.query("include") === "content";

      try {
        const entries = [];
        for await (const entry of Deno.readDir(dirPath)) {
          entries.push(entry.name);
        }
        const chapterFiles = entries
          .filter((f) => /^\d+\.md$/.test(f))
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

        if (!includeContent) {
          return c.json(chapterFiles.map((f) => parseInt(f, 10)));
        }

        // Batch mode: read all chapter contents in one response
        const results: { number: number; content: string }[] = [];
        for (const file of chapterFiles) {
          const content = await Deno.readTextFile(join(dirPath, file));
          results.push({ number: parseInt(file, 10), content });
        }
        return c.json(results);
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        return c.json(problemJson("Internal Server Error", 500, "Failed to list chapters"), 500);
      }
    }
  );

  // GET /api/stories/:series/:name/chapters/:number — read chapter
  app.get(
    "/api/stories/:series/:name/chapters/:number",
    validateParams,
    async (c) => {
      const num = parseInt(c.req.param("number")!, 10);
      if (isNaN(num) || num < 0) {
        return c.json(problemJson("Bad Request", 400, "Invalid chapter number"), 400);
      }

      const padded = String(num).padStart(3, "0");
      const filePath = safePath(
        c.req.param("series")!,
        c.req.param("name")!,
        `${padded}.md`
      );
      if (!filePath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      try {
        const content = await Deno.readTextFile(filePath);
        return c.json({ number: num, content });
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Chapter not found"), 404);
        }
        return c.json(problemJson("Internal Server Error", 500, "Failed to read chapter"), 500);
      }
    }
  );

  // DELETE /api/stories/:series/:name/chapters/last — delete last chapter
  app.delete(
    "/api/stories/:series/:name/chapters/last",
    validateParams,
    async (c) => {
      const dirPath = safePath(c.req.param("series")!, c.req.param("name")!);
      if (!dirPath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      try {
        const entries = [];
        for await (const entry of Deno.readDir(dirPath)) {
          entries.push(entry.name);
        }
        const chapterFiles = entries
          .filter((f) => /^\d+\.md$/.test(f))
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

        if (chapterFiles.length === 0) {
          return c.json(problemJson("Not Found", 404, "No chapters to delete"), 404);
        }

        const lastFile = chapterFiles[chapterFiles.length - 1]!;
        const lastNum = parseInt(lastFile, 10);
        const deletePath = join(dirPath, lastFile);
        await Deno.remove(deletePath);
        log.info("Chapter deleted", { op: "delete", path: deletePath, chapter: lastNum });
        return c.json({ deleted: lastNum });
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        return c.json(problemJson("Internal Server Error", 500, "Failed to delete chapter"), 500);
      }
    }
  );

  // POST /api/stories/:series/:name/init — initialize story
  app.post(
    "/api/stories/:series/:name/init",
    validateParams,
    async (c) => {
      const dirPath = safePath(c.req.param("series")!, c.req.param("name")!);
      if (!dirPath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      const filePath = join(dirPath, "001.md");

      try {
        await Deno.mkdir(dirPath, { recursive: true, mode: 0o775 });
        try {
          await Deno.stat(filePath);
          return c.json({ message: "Story already exists" }, 200);
        } catch {
          await Deno.writeTextFile(filePath, "", { mode: 0o664 });
          log.info("Story initialized", { op: "write", path: filePath, bytes: 0 });
          return c.json({ message: "Story initialized" }, 201);
        }
      } catch {
        return c.json(problemJson("Internal Server Error", 500, "Failed to initialize story"), 500);
      }
    }
  );
}
