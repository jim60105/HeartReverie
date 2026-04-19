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
import {
  buildContentDisposition,
  renderJson,
  renderMarkdown,
  renderPlainText,
  type ExportChapter,
} from "../lib/export.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const log = createLogger("file");

type ExportFormat = "md" | "json" | "txt";

const CONTENT_TYPES: Readonly<Record<ExportFormat, string>> = {
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/**
 * Register `GET /api/stories/:series/:name/export` on the app.
 *
 * Query params:
 *   - `format`: `md` (default) | `json` | `txt`. Anything else → 400.
 *
 * Response:
 *   - `200` with the requested body; `Content-Type` and `Content-Disposition`
 *     headers set to drive a browser download.
 *   - `404` when the story directory does not exist.
 *   - `400` on invalid path traversal or unsupported format.
 *   - `500` on other read failures.
 */
export function registerExportRoutes(
  app: Hono,
  deps: Pick<AppDeps, "safePath" | "pluginManager">,
): void {
  const { safePath, pluginManager } = deps;

  app.get(
    "/api/stories/:series/:name/export",
    validateParams,
    async (c) => {
      const series = c.req.param("series")!;
      const name = c.req.param("name")!;

      const formatRaw = c.req.query("format") ?? "md";
      if (formatRaw !== "md" && formatRaw !== "json" && formatRaw !== "txt") {
        return c.json(
          problemJson("Bad Request", 400, `Unsupported format: ${formatRaw}`),
          400,
        );
      }
      const format: ExportFormat = formatRaw;

      const dirPath = safePath(series, name);
      if (!dirPath) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      let chapterFiles: string[];
      try {
        const entries: string[] = [];
        for await (const entry of Deno.readDir(dirPath)) {
          if (entry.isFile) entries.push(entry.name);
        }
        chapterFiles = entries
          .filter((f) => /^\d+\.md$/.test(f))
          .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
      } catch (err: unknown) {
        if (err instanceof Deno.errors.NotFound) {
          return c.json(problemJson("Not Found", 404, "Story not found"), 404);
        }
        log.warn("Failed to read story for export", {
          series,
          story: name,
          error: err instanceof Error ? err.message : String(err),
        });
        return c.json(
          problemJson("Internal Server Error", 500, "Failed to read story"),
          500,
        );
      }

      const stripRegex = pluginManager.getCombinedStripTagPatterns();
      const chapters: ExportChapter[] = [];
      try {
        for (const file of chapterFiles) {
          const raw = await Deno.readTextFile(join(dirPath, file));
          const stripped = stripRegex ? raw.replaceAll(stripRegex, "") : raw;
          const trimmed = stripped.trim();
          if (trimmed.length === 0) continue;
          chapters.push({ number: parseInt(file, 10), content: trimmed });
        }
      } catch (err: unknown) {
        log.warn("Failed to read chapter during export", {
          series,
          story: name,
          error: err instanceof Error ? err.message : String(err),
        });
        return c.json(
          problemJson("Internal Server Error", 500, "Failed to read chapter"),
          500,
        );
      }

      let body: string;
      switch (format) {
        case "json":
          body = renderJson(series, name, chapters);
          break;
        case "txt":
          body = renderPlainText(series, name, chapters);
          break;
        case "md":
        default:
          body = renderMarkdown(series, name, chapters);
          break;
      }

      const headers: Record<string, string> = {
        "Content-Type": CONTENT_TYPES[format],
        "Content-Disposition": buildContentDisposition(series, name, format),
      };

      log.info("Story exported", {
        op: "export",
        series,
        story: name,
        format,
        chapterCount: chapters.length,
        bytes: body.length,
      });

      return c.body(body, 200, headers);
    },
  );
}
