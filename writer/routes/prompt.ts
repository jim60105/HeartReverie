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

export function registerPromptRoutes(app: Hono, deps: Pick<AppDeps, "safePath" | "pluginManager" | "buildPromptFromStory" | "config">): void {
  const { safePath, pluginManager, buildPromptFromStory, config } = deps;

  app.get("/api/template", async (c) => {
    try {
      const templatePath = join(config.ROOT_DIR, "system.md");
      const content = await Deno.readTextFile(templatePath);
      return c.json({ content });
    } catch {
      return c.json(problemJson("Internal Server Error", 500, "Failed to read template"), 500);
    }
  });

  app.post(
    "/api/stories/:series/:name/preview-prompt",
    validateParams,
    async (c) => {
      const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
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
        const {
          prompt,
          previousContext,
          statusContent,
          isFirstRound,
          ventoError,
        } = await buildPromptFromStory(
          series,
          name,
          storyDir,
          message,
          typeof template === "string" ? template : undefined
        );

        if (ventoError) {
          return c.json({ type: "vento-error", ...ventoError }, 422);
        }

        const pluginVars = await pluginManager.getPromptVariables();
        return c.json({
          prompt,
          fragments: Object.keys(pluginVars.variables),
          variables: {
            scenario: "(loaded)",
            previous_context: `${previousContext.length} chapters`,
            user_input: message,
            status_data: statusContent ? "(loaded)" : "(empty)",
            isFirstRound,
          },
          errors: [],
        });
      } catch (err: unknown) {
        console.error("Preview prompt error:", err instanceof Error ? err.message : String(err));
        return c.json(problemJson("Internal Server Error", 500, "Failed to preview prompt"), 500);
      }
    }
  );
}
