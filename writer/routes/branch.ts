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
import { isValidParam, validateParams } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { copyChapterFile, listChapterFiles } from "../lib/story.ts";
import { copyUsage } from "../lib/usage.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const log = createLogger("file");

/**
 * Recursively copy a directory, preserving default file/dir modes. Used for
 * duplicating the story-scoped `_lore/` directory during branch creation.
 *
 * Symlinks are silently skipped to prevent traversal outside the story tree.
 */
async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await Deno.mkdir(dst, { recursive: true, mode: 0o775 });
  for await (const entry of Deno.readDir(src)) {
    if (entry.isSymlink) continue;
    const srcPath = join(src, entry.name);
    const dstPath = join(dst, entry.name);
    if (entry.isDirectory) {
      await copyDirRecursive(srcPath, dstPath);
    } else if (entry.isFile) {
      const content = await Deno.readTextFile(srcPath);
      await Deno.writeTextFile(dstPath, content, { mode: 0o664 });
    }
  }
}

/**
 * Register the story branching route.
 *
 * `POST /api/stories/:series/:name/branch` creates a new story within the
 * same series by copying chapters `001.md`…`NNN.md` from the source story,
 * where `NNN` equals `fromChapter`. Story-scoped `_lore/` passages and the
 * relevant usage records up to `fromChapter` are also copied.
 */
export function registerBranchRoutes(
  app: Hono,
  deps: Pick<AppDeps, "safePath">,
): void {
  const { safePath } = deps;

  app.post(
    "/api/stories/:series/:name/branch",
    validateParams,
    async (c) => {
      const series = c.req.param("series")!;
      const name = c.req.param("name")!;

      const srcDir = safePath(series, name);
      if (!srcDir) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      try {
        const stat = await Deno.stat(srcDir);
        if (!stat.isDirectory) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        const message = err instanceof Error ? err.message : String(err);
        log.error(`[POST /api/stories/:series/:name/branch] ${message}`);
        return c.json(problemJson("Internal Server Error", 500, "Failed to access source story"), 500);
      }

      let body: unknown;
      try {
        body = await c.req.json();
      } catch (err: unknown) {
        log.warn(`[POST /api/branch] Malformed request body: ${err instanceof Error ? err.message : String(err)}`);
        return c.json(problemJson("Bad Request", 400, "Malformed JSON body"), 400);
      }
      if (typeof body !== "object" || body === null) {
        return c.json(problemJson("Bad Request", 400, "Request body must be an object"), 400);
      }

      const fromChapterRaw = (body as Record<string, unknown>).fromChapter;
      const newNameRaw = (body as Record<string, unknown>).newName;

      if (typeof fromChapterRaw !== "number" || !Number.isInteger(fromChapterRaw) || fromChapterRaw < 1) {
        return c.json(problemJson("Bad Request", 400, "Field 'fromChapter' must be a positive integer"), 400);
      }
      const fromChapter = fromChapterRaw;

      const chapterFiles = await listChapterFiles(srcDir);
      const maxChapter = chapterFiles.length > 0
        ? Math.max(...chapterFiles.map((f) => parseInt(f, 10)))
        : 0;
      if (fromChapter > maxChapter) {
        return c.json(
          problemJson("Bad Request", 400, `Field 'fromChapter' exceeds highest existing chapter (${maxChapter})`),
          400,
        );
      }

      let newName: string;
      if (newNameRaw === undefined) {
        newName = `${name}-branch-${Date.now()}`;
      } else if (typeof newNameRaw !== "string") {
        return c.json(problemJson("Bad Request", 400, "Field 'newName' must be a string"), 400);
      } else if (newNameRaw.length === 0 || !isValidParam(newNameRaw) || newNameRaw.startsWith(".")) {
        return c.json(problemJson("Bad Request", 400, "Field 'newName' is invalid"), 400);
      } else {
        newName = newNameRaw;
      }

      const destDir = safePath(series, newName);
      if (!destDir) {
        return c.json(problemJson("Bad Request", 400, "Invalid destination path"), 400);
      }

      try {
        await Deno.mkdir(destDir, { recursive: false, mode: 0o775 });
      } catch (err: unknown) {
        if (err instanceof Deno.errors.AlreadyExists) {
          return c.json(problemJson("Conflict", 409, "Destination story already exists"), 409);
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn("Failed to create branch destination", { op: "mkdir", path: destDir, error: errMsg });
        return c.json(problemJson("Internal Server Error", 500, "Failed to create destination story"), 500);
      }

      const copiedChapters: number[] = [];
      try {
        // Copy chapters 001.md..fromChapter (only those that exist).
        const existingNums = new Set(chapterFiles.map((f) => parseInt(f, 10)));
        for (let n = 1; n <= fromChapter; n++) {
          if (!existingNums.has(n)) continue;
          const padded = String(n).padStart(3, "0");
          const fileName = `${padded}.md`;
          await copyChapterFile(srcDir, destDir, fileName);
          copiedChapters.push(n);
        }

        // Copy state/diff files for chapters ≤ fromChapter (best-effort; may not exist).
        for (let n = 1; n <= fromChapter; n++) {
          const pad = String(n).padStart(3, "0");
          for (const suffix of ["-state.yaml", "-state-diff.yaml"]) {
            const fileName = `${pad}${suffix}`;
            try {
              await Deno.copyFile(join(srcDir, fileName), join(destDir, fileName));
            } catch {
              // State/diff files may not exist for all chapters — that's fine
            }
          }
        }
        // Intentionally do NOT copy current-status.yaml (D9)

        // Copy story-scoped _lore/ when present.
        const loreSrc = join(srcDir, "_lore");
        try {
          const loreStat = await Deno.stat(loreSrc);
          if (loreStat.isDirectory) {
            await copyDirRecursive(loreSrc, join(destDir, "_lore"));
          }
        } catch (err: unknown) {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        }

        // Copy usage records filtered to `chapter <= fromChapter`.
        await copyUsage(srcDir, destDir, fromChapter);

        log.info("Story branched", {
          op: "branch",
          series,
          source: name,
          dest: newName,
          fromChapter,
          copiedChapters: copiedChapters.length,
        });

        return c.json(
          {
            series,
            name: newName,
            copiedChapters,
          },
          201,
        );
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        log.warn("Branch copy failed; cleaning up destination", { op: "branch", dest: destDir, error: errMsg });
        try {
          await Deno.remove(destDir, { recursive: true });
        } catch {
          // Best-effort cleanup
        }
        return c.json(problemJson("Internal Server Error", 500, "Failed to branch story"), 500);
      }
    },
  );
}
