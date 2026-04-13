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

import { dirname, join, resolve } from "@std/path";
import { isValidParam } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import {
  collectPassagesFromScope,
  filterByTag,
  parseFrontmatter,
} from "../lib/lore.ts";
import type { LorePassage, LoreScope } from "../lib/lore.ts";
import type { Context, Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

export function registerLoreRoutes(app: Hono, deps: Pick<AppDeps, "safePath" | "config">): void {
  const { safePath, config } = deps;
  const loreRoot = resolve(config.PLAYGROUND_DIR, "lore");

  /** Validate a wildcard passage path: must end with .md, contain no traversal, max 1 subdir. */
  function isValidPassagePath(path: string): boolean {
    if (!path || !path.endsWith(".md")) return false;
    if (/\.\.|\x00/.test(path)) return false;
    const segments = path.split("/").filter((seg) => seg.length > 0);
    if (segments.length === 0 || segments.length > 2) return false;
    return segments.every((seg) => seg.length > 0);
  }

  /** Build safePath segments for a given scope. */
  function scopeSegments(scope: LoreScope, series?: string, story?: string): string[] {
    switch (scope) {
      case "global":
        return ["lore", "global"];
      case "series":
        return ["lore", "series", series!];
      case "story":
        return ["lore", "story", series!, story!];
    }
  }

  /** Validate and sanitize tag strings for safe YAML serialization. */
  function isValidTag(tag: unknown): tag is string {
    return typeof tag === "string" && tag.length > 0 && tag.length <= 100
      && !/[\[\],\n\r]/.test(tag);
  }

  /** Validate the PUT request body for passage creation/update. */
  function validatePassageBody(body: Record<string, unknown>): {
    valid: true;
    frontmatter: { tags: string[]; priority: number; enabled: boolean };
    content: string;
  } | { valid: false; error: string } {
    const { frontmatter, content } = body;
    if (typeof content !== "string") {
      return { valid: false, error: "Missing or invalid content" };
    }
    if (!frontmatter || typeof frontmatter !== "object" || Array.isArray(frontmatter)) {
      return { valid: false, error: "Missing or invalid frontmatter" };
    }
    const fm = frontmatter as Record<string, unknown>;
    const tags = fm.tags ?? [];
    if (!Array.isArray(tags) || !tags.every(isValidTag)) {
      return { valid: false, error: "Invalid tags: must be an array of non-empty strings without special characters" };
    }
    const priority = fm.priority ?? 0;
    if (typeof priority !== "number" || !Number.isFinite(priority)) {
      return { valid: false, error: "Invalid priority: must be a finite number" };
    }
    const enabled = fm.enabled ?? true;
    if (typeof enabled !== "boolean") {
      return { valid: false, error: "Invalid enabled: must be a boolean" };
    }
    return { valid: true, frontmatter: { tags: tags as string[], priority, enabled }, content };
  }

  /** Serialize frontmatter and content back to Markdown with YAML frontmatter. */
  function serializePassage(
    fm: { tags: string[]; priority: number; enabled: boolean },
    content: string,
  ): string {
    const lines: string[] = ["---"];
    lines.push(`tags: [${fm.tags.join(", ")}]`);
    lines.push(`priority: ${fm.priority}`);
    lines.push(`enabled: ${fm.enabled}`);
    lines.push("---");
    lines.push("");
    lines.push(content);
    return lines.join("\n");
  }

  /** Map a passage to its API metadata shape (no body content). */
  function passageToMeta(p: LorePassage) {
    return {
      filename: p.filename,
      relativePath: p.relativePath,
      directory: p.directory,
      tags: p.effectiveTags,
      priority: p.frontmatter.priority,
      enabled: p.frontmatter.enabled,
      scope: p.scope,
    };
  }

  // ── GET /api/lore/tags — list all unique effective tags ──

  app.get("/api/lore/tags", async (c) => {
    try {
      const allPassages: LorePassage[] = [];

      // Global scope
      allPassages.push(
        ...await collectPassagesFromScope(join(loreRoot, "global"), "global", loreRoot),
      );

      // All series scopes
      try {
        for await (const entry of Deno.readDir(join(loreRoot, "series"))) {
          if (entry.isDirectory && !entry.name.startsWith(".")) {
            allPassages.push(
              ...await collectPassagesFromScope(
                join(loreRoot, "series", entry.name),
                "series",
                loreRoot,
              ),
            );
          }
        }
      } catch { /* series dir may not exist */ }

      // All story scopes
      try {
        for await (const seriesEntry of Deno.readDir(join(loreRoot, "story"))) {
          if (seriesEntry.isDirectory && !seriesEntry.name.startsWith(".")) {
            try {
              for await (
                const storyEntry of Deno.readDir(join(loreRoot, "story", seriesEntry.name))
              ) {
                if (storyEntry.isDirectory && !storyEntry.name.startsWith(".")) {
                  allPassages.push(
                    ...await collectPassagesFromScope(
                      join(loreRoot, "story", seriesEntry.name, storyEntry.name),
                      "story",
                      loreRoot,
                    ),
                  );
                }
              }
            } catch { /* inner dir may not exist */ }
          }
        }
      } catch { /* story dir may not exist */ }

      const tags = new Set<string>();
      for (const p of allPassages) {
        for (const t of p.effectiveTags) {
          tags.add(t);
        }
      }

      return c.json([...tags].sort());
    } catch {
      return c.json(problemJson("Internal Server Error", 500, "Failed to list tags"), 500);
    }
  });

  // ── List passages in a scope ──

  async function handleListPassages(
    c: Context,
    scope: LoreScope,
    series?: string,
    story?: string,
  ): Promise<Response> {
    const scopeDir = safePath(...scopeSegments(scope, series, story));
    if (!scopeDir) {
      return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
    }

    try {
      let passages = await collectPassagesFromScope(scopeDir, scope, loreRoot);

      const tag = c.req.query("tag");
      if (tag) {
        passages = filterByTag(passages, tag);
      }

      return c.json(passages.map(passageToMeta));
    } catch {
      return c.json(problemJson("Internal Server Error", 500, "Failed to list passages"), 500);
    }
  }

  app.get("/api/lore/global", (c) => handleListPassages(c, "global"));

  app.get("/api/lore/series/:series", (c) => {
    const series = c.req.param("series")!;
    if (!isValidParam(series)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: series"), 400);
    }
    return handleListPassages(c, "series", series);
  });

  app.get("/api/lore/story/:series/:story", (c) => {
    const series = c.req.param("series")!;
    const story = c.req.param("story")!;
    if (!isValidParam(series)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: series"), 400);
    }
    if (!isValidParam(story)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: story"), 400);
    }
    return handleListPassages(c, "story", series, story);
  });

  // ── Read a single passage ──

  async function handleReadPassage(
    c: Context,
    scope: LoreScope,
    series?: string,
    story?: string,
  ): Promise<Response> {
    const passagePath = c.req.param("path");
    if (!passagePath || !isValidPassagePath(passagePath)) {
      return c.json(problemJson("Bad Request", 400, "Invalid passage path"), 400);
    }

    const filePath = safePath(...scopeSegments(scope, series, story), ...passagePath.split("/"));
    if (!filePath) {
      return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
    }

    try {
      const raw = await Deno.readTextFile(filePath);
      const { frontmatter, content } = parseFrontmatter(raw);
      return c.json({ frontmatter, content });
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        return c.json(problemJson("Not Found", 404, "Passage not found"), 404);
      }
      return c.json(problemJson("Internal Server Error", 500, "Failed to read passage"), 500);
    }
  }

  app.get("/api/lore/global/:path{.+}", (c) => handleReadPassage(c, "global"));

  app.get("/api/lore/series/:series/:path{.+}", (c) => {
    const series = c.req.param("series")!;
    if (!isValidParam(series)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: series"), 400);
    }
    return handleReadPassage(c, "series", series);
  });

  app.get("/api/lore/story/:series/:story/:path{.+}", (c) => {
    const series = c.req.param("series")!;
    const story = c.req.param("story")!;
    if (!isValidParam(series)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: series"), 400);
    }
    if (!isValidParam(story)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: story"), 400);
    }
    return handleReadPassage(c, "story", series, story);
  });

  // ── Write (create/update) a passage ──

  async function handleWritePassage(
    c: Context,
    scope: LoreScope,
    series?: string,
    story?: string,
  ): Promise<Response> {
    const passagePath = c.req.param("path");
    if (!passagePath || !isValidPassagePath(passagePath)) {
      return c.json(problemJson("Bad Request", 400, "Invalid passage path"), 400);
    }

    const filePath = safePath(...scopeSegments(scope, series, story), ...passagePath.split("/"));
    if (!filePath) {
      return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
    }

    let body: Record<string, unknown>;
    try {
      body = await c.req.json() as Record<string, unknown>;
    } catch {
      return c.json(problemJson("Bad Request", 400, "Invalid JSON body"), 400);
    }

    const validation = validatePassageBody(body);
    if (!validation.valid) {
      return c.json(problemJson("Bad Request", 400, validation.error), 400);
    }

    const fileContent = serializePassage(validation.frontmatter, validation.content);

    try {
      await Deno.mkdir(dirname(filePath), { recursive: true });
      const isNew = await Deno.stat(filePath).then(() => false).catch(() => true);
      await Deno.writeTextFile(filePath, fileContent);
      return c.json(
        { message: isNew ? "Passage created" : "Passage updated" },
        isNew ? 201 : 200,
      );
    } catch {
      return c.json(problemJson("Internal Server Error", 500, "Failed to write passage"), 500);
    }
  }

  app.put("/api/lore/global/:path{.+}", (c) => handleWritePassage(c, "global"));

  app.put("/api/lore/series/:series/:path{.+}", (c) => {
    const series = c.req.param("series")!;
    if (!isValidParam(series)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: series"), 400);
    }
    return handleWritePassage(c, "series", series);
  });

  app.put("/api/lore/story/:series/:story/:path{.+}", (c) => {
    const series = c.req.param("series")!;
    const story = c.req.param("story")!;
    if (!isValidParam(series)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: series"), 400);
    }
    if (!isValidParam(story)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: story"), 400);
    }
    return handleWritePassage(c, "story", series, story);
  });

  // ── Delete a passage ──

  async function handleDeletePassage(
    c: Context,
    scope: LoreScope,
    series?: string,
    story?: string,
  ): Promise<Response> {
    const passagePath = c.req.param("path");
    if (!passagePath || !isValidPassagePath(passagePath)) {
      return c.json(problemJson("Bad Request", 400, "Invalid passage path"), 400);
    }

    const filePath = safePath(...scopeSegments(scope, series, story), ...passagePath.split("/"));
    if (!filePath) {
      return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
    }

    try {
      await Deno.remove(filePath);
      return c.body(null, 204);
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        return c.json(problemJson("Not Found", 404, "Passage not found"), 404);
      }
      return c.json(problemJson("Internal Server Error", 500, "Failed to delete passage"), 500);
    }
  }

  app.delete("/api/lore/global/:path{.+}", (c) => handleDeletePassage(c, "global"));

  app.delete("/api/lore/series/:series/:path{.+}", (c) => {
    const series = c.req.param("series")!;
    if (!isValidParam(series)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: series"), 400);
    }
    return handleDeletePassage(c, "series", series);
  });

  app.delete("/api/lore/story/:series/:story/:path{.+}", (c) => {
    const series = c.req.param("series")!;
    const story = c.req.param("story")!;
    if (!isValidParam(series)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: series"), 400);
    }
    if (!isValidParam(story)) {
      return c.json(problemJson("Bad Request", 400, "Invalid parameter: story"), 400);
    }
    return handleDeletePassage(c, "story", series, story);
  });
}
