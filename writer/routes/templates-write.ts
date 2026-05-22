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

import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";
import { errorMessage, problemJson } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { validateTemplate } from "../lib/template.ts";
import {
  atomicWriteWithBackup,
  PathSafetyError,
} from "../lib/path-safety.ts";
import {
  parentDir,
  parseTemplatePath,
  resolveTemplatePath,
} from "./templates-path.ts";
import { withWriteMutex } from "./templates-write-mutex.ts";

const log = createLogger("template");

export function registerTemplateWriteRoutes(app: Hono, deps: AppDeps): void {
  // ── PUT /api/templates ────────────────────────────────────────
  app.put("/api/templates", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(problemJson("Bad Request", 400, "Invalid JSON"), 400);
    }
    const templatePath = body.templatePath;
    const source = body.source;
    if (typeof source !== "string") {
      return c.json(problemJson("Bad Request", 400, "source must be a string"), 400);
    }
    // 403 BEFORE any validation when targeting plugin: paths
    if (typeof templatePath === "string" && templatePath.startsWith("plugin:")) {
      return c.json(
        problemJson("Forbidden", 403, "Plugin fragments are read-only; edit them in the plugin source repository"),
        403,
      );
    }
    const parsed = parseTemplatePath(templatePath);
    if (!parsed.ok) return c.json(problemJson("Bad Request", parsed.err.status, parsed.err.detail), parsed.err.status as 400);

    if (source.length > 500_000) {
      return c.json(problemJson("Bad Request", 400, "Template exceeds maximum length"), 400);
    }
    const sstiErrors = validateTemplate(source);
    if (sstiErrors.length > 0) {
      return c.json({
        type: "https://heartreverie.invalid/template-validation",
        title: "Template Validation Error",
        status: 422,
        detail: "Template contains unsafe expressions that cannot be executed",
        expressions: sstiErrors,
      }, 422);
    }

    const resolved = resolveTemplatePath(parsed.value, deps);
    if (!resolved.ok) {
      return c.json(problemJson("Bad Request", resolved.err.status, resolved.err.detail), resolved.err.status as 400);
    }

    try {
      // Ensure parent directory exists before realpath checks
      await Deno.mkdir(parentDir(resolved.value.absolute), { recursive: true, mode: 0o775 });
      // Ensure allowedBase exists too
      await Deno.mkdir(resolved.value.allowedBase, { recursive: true, mode: 0o775 });

      const result = await withWriteMutex(resolved.value.absolute, async () => {
        return await atomicWriteWithBackup(
          resolved.value.absolute,
          source,
          resolved.value.allowedBase,
        );
      });
      log.info("Template saved", {
        templatePath,
        path: result.path,
        backupPath: result.backupPath,
        bytes: new TextEncoder().encode(source).length,
      });
      return c.json({
        ok: true,
        path: result.path,
        backupPath: result.backupPath,
      });
    } catch (err: unknown) {
      if (err instanceof PathSafetyError) {
        if (err.code === "symlink-rejected") {
          log.warn("Template write rejected — symlink target", { templatePath, error: err.message });
          return c.json(problemJson("Bad Request", 400, err.message), 400);
        }
        log.warn("Template write rejected — path safety", { templatePath, error: err.message });
        return c.json(problemJson("Bad Request", 400, err.message), 400);
      }
      log.error("PUT /api/templates failed", {
        templatePath,
        error: errorMessage(err),
      });
      return c.json(problemJson("Internal Server Error", 500, "Failed to save template"), 500);
    }
  });
}
