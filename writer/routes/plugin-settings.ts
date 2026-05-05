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
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

export function registerPluginSettingsRoutes(app: Hono, deps: Pick<AppDeps, "pluginManager">): void {
  const { pluginManager } = deps;

  app.get("/api/plugins/:name/settings", async (c) => {
    const name = c.req.param("name");
    if (!pluginManager.hasSettingsSchema(name)) {
      return c.json(problemJson("Not Found", 404, "Plugin has no settings"), 404);
    }
    const settings = await pluginManager.getPluginSettings(name);
    return c.json(settings);
  });

  app.get("/api/plugins/:name/settings-schema", (c) => {
    const name = c.req.param("name");
    const schema = pluginManager.getPluginSettingsSchema(name);
    if (!schema) {
      return c.json(problemJson("Not Found", 404, "Plugin has no settings schema"), 404);
    }
    return c.json(schema);
  });

  app.put("/api/plugins/:name/settings", async (c) => {
    const name = c.req.param("name");
    if (!pluginManager.hasSettingsSchema(name)) {
      return c.json(problemJson("Not Found", 404, "Plugin has no settings"), 404);
    }
    const body = await c.req.json();
    try {
      await pluginManager.savePluginSettings(name, body);
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof Error && err.message.includes("validation")) {
        return c.json(problemJson("Bad Request", 400, err.message), 400);
      }
      throw err;
    }
  });
}
