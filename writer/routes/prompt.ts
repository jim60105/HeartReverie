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

import { join, dirname } from "@std/path";
import { validateParams } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import { validateTemplate } from "../lib/template.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const log = createLogger("file");

/** Read the custom prompt file; fall back to system.md only when the custom file does not exist. */
export async function readTemplate(config: { PROMPT_FILE: string; ROOT_DIR: string }): Promise<{ content: string; source: "custom" | "default" }> {
  try {
    const content = await Deno.readTextFile(config.PROMPT_FILE);
    return { content, source: "custom" };
  } catch (err: unknown) {
    if (!(err instanceof Deno.errors.NotFound)) throw err;
    const content = await Deno.readTextFile(join(config.ROOT_DIR, "system.md"));
    return { content, source: "default" };
  }
}

export function registerPromptRoutes(app: Hono, deps: Pick<AppDeps, "safePath" | "pluginManager" | "buildPromptFromStory" | "config">): void {
  const { safePath, pluginManager, buildPromptFromStory, config } = deps;

  app.get("/api/template", async (c) => {
    try {
      const result = await readTemplate(config);
      return c.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[GET /api/template] ${message}`);
      return c.json(problemJson("Internal Server Error", 500, "Failed to read template"), 500);
    }
  });

  app.put("/api/template", async (c) => {
    try {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch (err: unknown) {
        log.warn(`[PUT /api/template] Malformed request body: ${err instanceof Error ? err.message : String(err)}`);
        return c.json(problemJson("Bad Request", 400, "Invalid JSON in request body"), 400);
      }
      const content: unknown = body.content;
      if (typeof content !== "string" || content.trim().length === 0) {
        return c.json(problemJson("Bad Request", 400, "Content required"), 400);
      }

      if (content.length > 500_000) {
        return c.json(problemJson("Bad Request", 400, "Template exceeds maximum length"), 400);
      }

      const errors = validateTemplate(content);
      if (errors.length > 0) {
        return c.json({
          type: "https://heartreverie.invalid/template-validation",
          title: "Template Validation Error",
          status: 422,
          detail: "Template contains unsafe expressions that cannot be executed",
          expressions: errors,
        }, 422);
      }

      await Deno.mkdir(dirname(config.PROMPT_FILE), { recursive: true, mode: 0o775 });
      await Deno.writeTextFile(config.PROMPT_FILE, content, { mode: 0o664 });
      log.info("Template file saved", { op: "write", path: config.PROMPT_FILE, bytes: new TextEncoder().encode(content).length });
      return c.json({ ok: true });
    } catch (err: unknown) {
      log.error("Failed to save template", { op: "write", path: config.PROMPT_FILE, error: err instanceof Error ? err.message : String(err) });
      return c.json(problemJson("Internal Server Error", 500, "Failed to save template"), 500);
    }
  });

  app.delete("/api/template", async (c) => {
    try {
      await Deno.remove(config.PROMPT_FILE);
      log.info("Template file deleted", { op: "delete", path: config.PROMPT_FILE });
    } catch (err: unknown) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.error("Failed to delete template", { op: "delete", path: config.PROMPT_FILE, error: err instanceof Error ? err.message : String(err) });
        return c.json(problemJson("Internal Server Error", 500, "Failed to delete template"), 500);
      }
    }
    return c.json({ ok: true });
  });

  app.post(
    "/api/stories/:series/:name/preview-prompt",
    validateParams,
    async (c) => {
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch (err: unknown) {
        log.warn(`[POST /api/preview-prompt] Malformed request body: ${err instanceof Error ? err.message : String(err)}`);
        return c.json(problemJson("Bad Request", 400, "Invalid JSON in request body"), 400);
      }
      const message: unknown = body.message;
      const template: unknown = body.template;
      if (typeof message !== "string" || message.trim().length === 0) {
        return c.json(problemJson("Bad Request", 400, "Message required"), 400);
      }

      const series = c.req.param("series")!;
      const name = c.req.param("name")!;
      const storyDir = safePath(series, name);
      if (!storyDir) {
        return c.json(problemJson("Bad Request", 400, "Invalid path"), 400);
      }

      try {
        // Resolve template: body override > custom file > system.md
        let templateOverride: string | undefined;
        if (typeof template === "string") {
          templateOverride = template;
        } else {
          try {
            const tpl = await readTemplate(config);
            if (tpl.source === "custom") {
              templateOverride = tpl.content;
            }
          } catch (err: unknown) {
            if (!(err instanceof Deno.errors.NotFound)) {
              log.error(`[prompt] Template read failed: ${err instanceof Error ? err.message : String(err)}`);
              return c.json(problemJson("Internal Server Error", 500, "Failed to read prompt template"), 500);
            }
            // NotFound → use default rendering
          }
        }

        const {
          messages,
          previousContext,
          isFirstRound,
          ventoError,
        } = await buildPromptFromStory(
          series,
          name,
          storyDir,
          message,
          templateOverride
        );

        if (ventoError) {
          return c.json({ type: "vento-error", ...ventoError }, 422);
        }

        const pluginVars = await pluginManager.getPromptVariables();
        return c.json({
          messages,
          fragments: Object.keys(pluginVars.variables),
          variables: {
            scenario: "(loaded)",
            previous_context: `${previousContext.length} chapters`,
            user_input: message,
            isFirstRound,
          },
          errors: [],
        });
      } catch (err: unknown) {
        log.error("Preview prompt error", { error: err instanceof Error ? err.message : String(err), path: c.req.path });
        return c.json(problemJson("Internal Server Error", 500, "Failed to preview prompt"), 500);
      }
    }
  );
}
