// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { join } from "@std/path";
import { validateParams } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

export function registerChapterRoutes(app: Hono, deps: Pick<AppDeps, "safePath">): void {
  const { safePath } = deps;

  // GET /api/stories/:series/:name/chapters — list chapters
  app.get(
    "/api/stories/:series/:name/chapters",
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
        const chapters = entries
          .filter((f) => /^\d+\.md$/.test(f))
          .map((f) => parseInt(f, 10))
          .sort((a, b) => a - b);
        return c.json(chapters);
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

  // GET /api/stories/:series/:name/status — read status YAML
  app.get(
    "/api/stories/:series/:name/status",
    validateParams,
    async (c) => {
      const currentPath = safePath(
        c.req.param("series")!,
        c.req.param("name")!,
        "current-status.yml"
      );
      const initPath = safePath(c.req.param("series")!, "init-status.yml");

      if (!currentPath || !initPath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      try {
        const content = await Deno.readTextFile(currentPath);
        return new Response(content, {
          status: 200,
          headers: { "Content-Type": "text/yaml" },
        });
      } catch {
        try {
          const content = await Deno.readTextFile(initPath);
          return new Response(content, {
            status: 200,
            headers: { "Content-Type": "text/yaml" },
          });
        } catch {
          return c.json(problemJson("Not Found", 404, "Status file not found"), 404);
        }
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
        await Deno.remove(join(dirPath, lastFile));
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
        await Deno.mkdir(dirPath, { recursive: true });
        try {
          await Deno.stat(filePath);
          return c.json({ message: "Story already exists" }, 200);
        } catch {
          await Deno.writeTextFile(filePath, "");
          return c.json({ message: "Story initialized" }, 201);
        }
      } catch {
        return c.json(problemJson("Internal Server Error", 500, "Failed to initialize story"), 500);
      }
    }
  );
}
