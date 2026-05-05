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
import { problemJson } from "../lib/errors.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const FILENAME_RE = /^[\w\-\.]+$/;

const CONTENT_TYPES: Record<string, string> = {
  avif: "image/avif",
  webp: "image/webp",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
};

export function registerImageRoutes(app: Hono, deps: Pick<AppDeps, "safePath">): void {
  const { safePath } = deps;

  app.get("/api/stories/:series/:story/images/:filename", (c) => {
    const { series, story, filename } = c.req.param();

    if (!FILENAME_RE.test(filename) || filename.includes("..")) {
      return c.json(problemJson("Bad Request", 400, "Invalid filename"), 400);
    }

    const storyDir = safePath(series, story);
    if (!storyDir) return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);

    const imagePath = join(storyDir, "_images", filename);
    const ext = filename.split(".").pop()?.toLowerCase() || "";
    const contentType = CONTENT_TYPES[ext] || "application/octet-stream";

    try {
      const file = Deno.readFileSync(imagePath);
      return new Response(file, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "public, immutable",
        },
      });
    } catch {
      return c.json(problemJson("Not Found", 404, "Image not found"), 404);
    }
  });

  app.get("/api/stories/:series/:story/image-metadata", async (c) => {
    const { series, story } = c.req.param();
    const chapter = c.req.query("chapter");

    const storyDir = safePath(series, story);
    if (!storyDir) return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);

    const metadataPath = join(storyDir, "_images", "_metadata.json");

    try {
      const content = await Deno.readTextFile(metadataPath);
      const data = JSON.parse(content);
      let images = data.images || [];

      if (chapter) {
        const chapterNum = parseInt(chapter, 10);
        if (!isNaN(chapterNum)) {
          images = images.filter((img: { chapter?: number }) => img.chapter === chapterNum);
        }
      }

      return c.json({ images });
    } catch {
      return c.json({ images: [] });
    }
  });
}
