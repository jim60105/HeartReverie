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

import { problemJson } from "../lib/errors.ts";
import type { Context, Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";
import { createLogger } from "../lib/logger.ts";
import { getHardcodedPathRoots } from "../lib/path-allowlist.ts";

const log = createLogger("plugin");

const SUPPORTED_FORMATS = ["path", "color", "url", "email", "uuid"];

function isReaderOnly(): boolean {
  return Deno.env.get("HEARTREVERIE_READER_ONLY") === "1";
}

/**
 * Per-request guard: settings routes are writer-mode-only. In reader-only
 * deployments, every settings endpoint SHALL respond `404` regardless of
 * authentication state.
 */
function readerOnlyGuard(c: Context): Response | null {
  if (isReaderOnly()) {
    return c.json(
      problemJson("Not Found", 404, "Plugin settings unavailable in reader mode"),
      404,
    );
  }
  return null;
}

export function registerPluginSettingsRoutes(
  app: Hono,
  deps: Pick<AppDeps, "pluginManager">,
): void {
  const { pluginManager } = deps;

  app.get("/api/plugins/:name/settings", async (c) => {
    const guard = readerOnlyGuard(c);
    if (guard) return guard;

    const name = c.req.param("name");
    if (!pluginManager.hasSettingsSchema(name)) {
      return c.json(
        problemJson("Not Found", 404, "Plugin has no settings"),
        404,
      );
    }
    const { settings, legacyWarnings } = await pluginManager
      .getPluginSettingsForResponse(name);
    const body: Record<string, unknown> = { ...settings };
    if (legacyWarnings.length > 0) {
      body["x-legacy-warnings"] = legacyWarnings;
    }
    return c.json(body);
  });

  app.get("/api/plugins/:name/settings-schema", (c) => {
    const guard = readerOnlyGuard(c);
    if (guard) return guard;

    const name = c.req.param("name");
    const schema = pluginManager.getPluginSettingsSchema(name);
    if (!schema) {
      return c.json(
        problemJson("Not Found", 404, "Plugin has no settings schema"),
        404,
      );
    }
    return c.json(schema);
  });

  app.put("/api/plugins/:name/settings", async (c) => {
    const guard = readerOnlyGuard(c);
    if (guard) return guard;

    const name = c.req.param("name");
    if (!pluginManager.hasSettingsSchema(name)) {
      return c.json(
        problemJson("Not Found", 404, "Plugin has no settings"),
        404,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        errors: [{
          path: "",
          keyword: "type",
          messageKey: "type",
          params: { expected: "object" },
        }],
        warnings: [],
      }, 400);
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({
        errors: [{
          path: "",
          keyword: "type",
          messageKey: "type",
          params: { expected: "object" },
        }],
        warnings: [],
      }, 400);
    }

    const result = await pluginManager.validateAndPreparePluginSettings(
      name,
      body as Record<string, unknown>,
    );

    if (result.schemaVersionMismatch) {
      return c.json({ errors: result.errors, warnings: [] }, 409);
    }

    if (result.errors.length > 0) {
      return c.json({
        errors: result.errors,
        warnings: result.warnings,
      }, 400);
    }

    await pluginManager.commitPluginSettings(name, result.finalSettings);
    log.info("Plugin settings updated", {
      plugin: name,
      changedPaths: result.changedPaths,
      warningCount: result.warnings.length,
      durationMs: Math.round(result.durationMs * 1000) / 1000,
    });
    return c.json({ errors: [], warnings: result.warnings });
  });

  app.post("/api/plugins/:name/settings/validate", async (c) => {
    const guard = readerOnlyGuard(c);
    if (guard) return guard;

    const name = c.req.param("name");
    if (!pluginManager.hasSettingsSchema(name)) {
      return c.json(
        problemJson("Not Found", 404, "Plugin has no settings"),
        404,
      );
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({
        errors: [{
          path: "",
          keyword: "type",
          messageKey: "type",
          params: { expected: "object" },
        }],
        warnings: [],
      });
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return c.json({
        errors: [{
          path: "",
          keyword: "type",
          messageKey: "type",
          params: { expected: "object" },
        }],
        warnings: [],
      });
    }

    const result = await pluginManager.validateAndPreparePluginSettings(
      name,
      body as Record<string, unknown>,
    );
    // POST /validate ALWAYS returns 200 (even on schema version mismatch).
    return c.json({
      errors: result.errors,
      warnings: result.warnings,
    });
  });

  app.get("/api/plugins/:name/settings/schema-meta", (c) => {
    const guard = readerOnlyGuard(c);
    if (guard) return guard;

    const name = c.req.param("name");
    if (!pluginManager.hasSettingsSchema(name)) {
      return c.json(
        problemJson("Not Found", 404, "Plugin has no settings"),
        404,
      );
    }
    const version = pluginManager.getSchemaVersion(name);
    return c.json({
      schemaVersion: version === -1 ? null : version,
      pathRoots: getHardcodedPathRoots(name),
      formats: [...SUPPORTED_FORMATS],
    });
  });
}
