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

import { resolve, relative, SEPARATOR } from "@std/path";
import { problemJson } from "../lib/errors.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

export function registerPluginRoutes(app: Hono, deps: Pick<AppDeps, "pluginManager">): void {
  const { pluginManager } = deps;

  app.get("/api/plugins", (c) => {
    const plugins = pluginManager.getPlugins().map((p) => ({
      name: p.name,
      version: p.version,
      description: p.description,
      type: p.type,
      tags: p.tags || [],
      hasFrontendModule: !!p.frontendModule,
      displayStripTags: p.displayStripTags || [],
    }));
    return c.json(plugins);
  });

  app.get("/api/plugins/parameters", (c) => {
    return c.json(pluginManager.getParameters());
  });

  // Serve plugin frontend modules
  for (const plugin of pluginManager.getPlugins()) {
    if (plugin.frontendModule) {
      const pluginDir = pluginManager.getPluginDir(plugin.name);
      if (!pluginDir) continue;
      const modulePath = resolve(pluginDir, plugin.frontendModule);
      // Containment check: frontendModule must stay inside plugin directory
      if (!modulePath.startsWith(pluginDir + SEPARATOR)) {
        console.warn(
          `⚠️  Plugin '${plugin.name}' frontendModule escapes plugin directory — skipping`
        );
        continue;
      }
      // Use normalized relative path for route (strip ./ prefix from manifest values)
      const routePath = relative(pluginDir, modulePath);
      app.get(`/plugins/${plugin.name}/${routePath}`, async (c) => {
        try {
          const content = await Deno.readTextFile(modulePath);
          return new Response(content, {
            headers: { "Content-Type": "application/javascript" },
          });
        } catch {
          return c.json(problemJson("Not Found", 404, "Not found"), 404);
        }
      });
    }
  }
}
