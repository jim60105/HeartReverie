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
import { errorMessage, problemJson } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { atomicWriteChapter, listChapterFiles, readStateDiff } from "../lib/story.ts";
import { deleteLastChapter } from "../lib/story-chapter-io.ts";
import {
  clearGenerationActive,
  isGenerationActive,
  tryMarkGenerationActive,
} from "../lib/generation-registry.ts";
import { pruneUsage } from "../lib/usage.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps, StateDiffPayload } from "../types.ts";

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
        await Deno.stat(dirPath);
        const chapterFiles = await listChapterFiles(dirPath);

        if (!includeContent) {
          return c.json(chapterFiles.map((f) => parseInt(f, 10)));
        }

        // Batch mode: read all chapter contents in one response
        const results: { number: number; content: string; stateDiff?: StateDiffPayload }[] = [];
        for (const file of chapterFiles) {
          const content = await Deno.readTextFile(join(dirPath, file));
          const stateDiff = await readStateDiff(dirPath, parseInt(file, 10), log);
          results.push({ number: parseInt(file, 10), content, stateDiff });
        }
        return c.json(results);
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        const message = errorMessage(err);
        log.error(`[GET /api/stories/:series/:name/chapters] ${message}`);
        return c.json(problemJson("Internal Server Error", 500, "Failed to list chapters"), 500);
      }
    },
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
        `${padded}.md`,
      );
      if (!filePath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      try {
        const content = await Deno.readTextFile(filePath);
        const dirPath = safePath(
          c.req.param("series")!,
          c.req.param("name")!,
        );
        const stateDiff = dirPath ? await readStateDiff(dirPath, num, log) : undefined;
        return c.json({ number: num, content, stateDiff });
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Chapter not found"), 404);
        }
        const message = errorMessage(err);
        log.error(`[GET /api/stories/:series/:name/chapters/:number] ${message}`);
        return c.json(problemJson("Internal Server Error", 500, "Failed to read chapter"), 500);
      }
    },
  );

  // DELETE /api/stories/:series/:name/chapters/last — delete last chapter
  app.delete(
    "/api/stories/:series/:name/chapters/last",
    validateParams,
    async (c) => {
      const series = c.req.param("series")!;
      const name = c.req.param("name")!;

      // Validate the path before applying the business guard so an invalid or
      // traversal-shaped identifier always resolves to 400, never 409.
      const dirPath = safePath(series, name);
      if (!dirPath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      // Atomically acquire the generation lock so the delete cannot interleave
      // with a chat generation (or a concurrent edit/rewind) on the same story.
      // The early `isGenerationActive` check was folded into this acquire;
      // released in `finally`.
      if (!tryMarkGenerationActive(series, name)) {
        return c.json(
          problemJson("Conflict", 409, "Generation in progress for this story"),
          409,
        );
      }
      try {
        await Deno.stat(dirPath);
        const result = await deleteLastChapter(dirPath);
        if (!result.ok) {
          return c.json(problemJson("Not Found", 404, "No chapters to delete"), 404);
        }
        return c.json({ deleted: result.deleted });
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        const message = errorMessage(err);
        log.error(`[DELETE /api/stories/:series/:name/chapters/last] ${message}`);
        return c.json(problemJson("Internal Server Error", 500, "Failed to delete chapter"), 500);
      } finally {
        clearGenerationActive(series, name);
      }
    },
  );

  // PUT /api/stories/:series/:name/chapters/:number — edit chapter in place
  app.put(
    "/api/stories/:series/:name/chapters/:number",
    validateParams,
    async (c) => {
      const series = c.req.param("series")!;
      const name = c.req.param("name")!;
      const numRaw = c.req.param("number")!;
      const num = parseInt(numRaw, 10);
      if (!/^\d+$/.test(numRaw) || isNaN(num) || num < 1) {
        return c.json(problemJson("Bad Request", 400, "Invalid chapter number"), 400);
      }

      if (isGenerationActive(series, name)) {
        return c.json(
          problemJson("Conflict", 409, "Generation in progress for this story"),
          409,
        );
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(problemJson("Bad Request", 400, "Malformed JSON body"), 400);
      }
      if (typeof body !== "object" || body === null) {
        return c.json(problemJson("Bad Request", 400, "Request body must be an object"), 400);
      }
      const content = (body as Record<string, unknown>).content;
      if (typeof content !== "string") {
        return c.json(problemJson("Bad Request", 400, "Field 'content' must be a string"), 400);
      }

      const dirPath = safePath(series, name);
      if (!dirPath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      const padded = String(num).padStart(3, "0");
      const chapterFile = `${padded}.md`;
      const filePath = join(dirPath, chapterFile);

      // Atomically acquire the generation lock immediately before the mutation
      // so a chat generation (or a concurrent edit) cannot interleave between
      // the early `isGenerationActive` fast-fail above and the write below.
      // The early check stays as a cheap pre-body optimization; this is the
      // real guard. Released in `finally` so every early return frees the lock.
      if (!tryMarkGenerationActive(series, name)) {
        return c.json(
          problemJson("Conflict", 409, "Generation in progress for this story"),
          409,
        );
      }
      try {
        try {
          await Deno.stat(filePath);
        } catch (err: unknown) {
          if (err instanceof Deno.errors.NotFound) {
            return c.json(problemJson("Not Found", 404, "Chapter not found"), 404);
          }
          const message = errorMessage(err);
          log.error(`[PUT /api/stories/:series/:name/chapters/:number] ${message}`);
          return c.json(problemJson("Internal Server Error", 500, "Failed to stat chapter"), 500);
        }

        try {
          await atomicWriteChapter(dirPath, chapterFile, content);
          log.info("Chapter edited", {
            op: "write",
            path: filePath,
            chapter: num,
            bytes: content.length,
          });

          // Cache invalidation: delete state/diff from edited chapter onward
          const stateFiles: Promise<unknown>[] = [];
          for await (const entry of Deno.readDir(dirPath)) {
            if (!entry.isFile) continue;
            const stateMatch = entry.name.match(/^(\d+)-state(?:-diff)?\.yaml$/);
            if (stateMatch && parseInt(stateMatch[1]!, 10) >= num) {
              stateFiles.push(Deno.remove(join(dirPath, entry.name)).catch(() => {}));
            }
          }
          stateFiles.push(Deno.remove(join(dirPath, "current-status.yaml")).catch(() => {}));
          await Promise.allSettled(stateFiles);

          return c.json({ number: num, content });
        } catch (err: unknown) {
          const errMsg = errorMessage(err);
          log.warn("Failed to edit chapter", { op: "write", path: filePath, error: errMsg });
          return c.json(problemJson("Internal Server Error", 500, "Failed to write chapter"), 500);
        }
      } finally {
        clearGenerationActive(series, name);
      }
    },
  );

  // DELETE /api/stories/:series/:name/chapters/after/:number — rewind story
  // Deletes every chapter with number strictly greater than `:number`.
  // `:number` of 0 clears all chapters.
  app.delete(
    "/api/stories/:series/:name/chapters/after/:number",
    validateParams,
    async (c) => {
      const series = c.req.param("series")!;
      const name = c.req.param("name")!;
      const numRaw = c.req.param("number")!;
      const num = parseInt(numRaw, 10);
      if (!/^\d+$/.test(numRaw) || isNaN(num) || num < 0) {
        return c.json(problemJson("Bad Request", 400, "Invalid chapter number"), 400);
      }

      if (isGenerationActive(series, name)) {
        return c.json(
          problemJson("Conflict", 409, "Generation in progress for this story"),
          409,
        );
      }

      const dirPath = safePath(series, name);
      if (!dirPath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      // Atomically acquire the generation lock so a chat generation (or a
      // concurrent edit/rewind) cannot interleave with these deletions. The
      // early `isGenerationActive` check above is a cheap fast-fail; this is
      // the real guard. Released in `finally` after `pruneUsage`.
      if (!tryMarkGenerationActive(series, name)) {
        return c.json(
          problemJson("Conflict", 409, "Generation in progress for this story"),
          409,
        );
      }
      try {
        try {
          await Deno.stat(dirPath);
        } catch (err: unknown) {
          if (err instanceof Deno.errors.NotFound) {
            return c.json(problemJson("Not Found", 404, "Story not found"), 404);
          }
          const message = errorMessage(err);
          log.error(`[DELETE /api/stories/:series/:name/chapters/after/:number] ${message}`);
          return c.json(problemJson("Internal Server Error", 500, "Failed to access story"), 500);
        }

        const chapterFiles = await listChapterFiles(dirPath);
        const toDelete = chapterFiles
          .map((f) => parseInt(f, 10))
          .filter((n) => n > num)
          .sort((a, b) => b - a);

        const deleted: number[] = [];
        for (const n of toDelete) {
          const padded = String(n).padStart(3, "0");
          const path = join(dirPath, `${padded}.md`);
          try {
            await Deno.remove(path);
            deleted.push(n);
            log.info("Chapter deleted", { op: "delete", path, chapter: n });
          } catch (err: unknown) {
            if (err instanceof Deno.errors.NotFound) continue;
            const errMsg = errorMessage(err);
            log.warn("Failed to delete chapter", { op: "delete", path, error: errMsg });
            return c.json(
              problemJson("Internal Server Error", 500, "Failed to delete chapters"),
              500,
            );
          }
        }

        // Clean up state/diff files for rewound chapters
        const stateCleanup: Promise<unknown>[] = [];
        for await (const entry of Deno.readDir(dirPath)) {
          if (!entry.isFile) continue;
          const stateMatch = entry.name.match(/^(\d+)-state(?:-diff)?\.yaml$/);
          if (stateMatch && parseInt(stateMatch[1]!, 10) > num) {
            stateCleanup.push(Deno.remove(join(dirPath, entry.name)).catch(() => {}));
          }
        }
        stateCleanup.push(Deno.remove(join(dirPath, "current-status.yaml")).catch(() => {}));
        await Promise.allSettled(stateCleanup);

        // Keep usage records aligned with remaining chapters.
        await pruneUsage(dirPath, num);

        deleted.sort((a, b) => a - b);
        return c.json({ deleted });
      } finally {
        clearGenerationActive(series, name);
      }
    },
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
        } catch (err: unknown) {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
          await Deno.writeTextFile(filePath, "", { mode: 0o664 });
          log.info("Story initialized", { op: "write", path: filePath, bytes: 0 });
          return c.json({ message: "Story initialized" }, 201);
        }
      } catch (err: unknown) {
        const message = errorMessage(err);
        log.error(`[POST /api/stories/:series/:name/init] ${message}`);
        return c.json(problemJson("Internal Server Error", 500, "Failed to initialize story"), 500);
      }
    },
  );
}
