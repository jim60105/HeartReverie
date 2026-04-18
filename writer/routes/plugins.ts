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
import { resolveLoreVariables } from "../lib/lore.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const log = createLogger("plugin");

export function registerPluginRoutes(app: Hono, deps: Pick<AppDeps, "pluginManager" | "config">): void {
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
      frontendStyles: pluginManager.getPluginStyles(p.name).map(
        (cssPath) => `/plugins/${p.name}/${cssPath}`,
      ),
    }));
    return c.json(plugins);
  });

  app.get("/api/plugins/parameters", async (c) => {
    const baseParams = pluginManager.getParameters();
    const series = c.req.query("series");
    const story = c.req.query("story");

    // No story context → return base params only (no lore)
    if (!series) {
      return c.json(baseParams);
    }

    // Resolve lore variables for the given scope
    const { variables: loreVars } = await resolveLoreVariables(
      deps.config.PLAYGROUND_DIR,
      series,
      story || undefined,
    );

    // Convert lore variables to ParameterInfo entries
    const loreParams = Object.keys(loreVars)
      .filter((key) => key.startsWith("lore_"))
      .map((key) => ({
        name: key,
        type: Array.isArray(loreVars[key]) ? "array" : "string",
        description: key === "lore_all"
          ? "All enabled lore passages concatenated"
          : key === "lore_tags"
            ? "Array of all lore tag names"
            : `Lore passages tagged '${key.replace(/^lore_/, "")}'`,
        source: "lore",
      }));

    return c.json([...baseParams, ...loreParams]);
  });

  // Serve shared plugin utility modules from plugins/_shared/
  const sharedDir = resolve(pluginManager.getBuiltinDir(), "_shared");
  app.get("/plugins/_shared/:path{.+}", async (c) => {
    const reqPath = c.req.param("path");
    if (!reqPath.endsWith(".js")) {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }
    // Reject dotfiles (path segments starting with '.')
    if (reqPath.split("/").some((seg) => seg.startsWith("."))) {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }
    const filePath = resolve(sharedDir, reqPath);
    if (!filePath.startsWith(sharedDir + SEPARATOR)) {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }
    try {
      // Canonicalize to defeat symlink escapes
      const realShared = await Deno.realPath(sharedDir);
      const realFile = await Deno.realPath(filePath);
      if (!realFile.startsWith(realShared + SEPARATOR)) {
        return c.json(problemJson("Not Found", 404, "Not found"), 404);
      }
      const content = await Deno.readTextFile(realFile);
      return new Response(content, {
        headers: { "Content-Type": "application/javascript" },
      });
    } catch {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }
  });

  // Serve plugin frontend modules
  for (const plugin of pluginManager.getPlugins()) {
    if (plugin.frontendModule) {
      const pluginDir = pluginManager.getPluginDir(plugin.name);
      if (!pluginDir) continue;
      const modulePath = resolve(pluginDir, plugin.frontendModule);
      // Containment check: frontendModule must stay inside plugin directory
      if (!modulePath.startsWith(pluginDir + SEPARATOR)) {
        log.warn("Plugin frontendModule escapes plugin directory — skipping", { plugin: plugin.name, path: modulePath });
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

  // Serve plugin CSS files declared in manifest.frontendStyles
  for (const plugin of pluginManager.getPlugins()) {
    const styles = pluginManager.getPluginStyles(plugin.name);
    if (styles.length === 0) continue;
    const pluginDir = pluginManager.getPluginDir(plugin.name);
    if (!pluginDir) continue;

    for (const cssPath of styles) {
      const cssFilePath = resolve(pluginDir, cssPath);
      // Containment check against raw resolved path
      if (!cssFilePath.startsWith(pluginDir + SEPARATOR)) {
        log.warn("Plugin CSS escapes plugin directory — skipping", { plugin: plugin.name, cssPath, resolved: cssFilePath });
        continue;
      }
      app.get(`/plugins/${plugin.name}/${cssPath}`, async (c) => {
        try {
          // Symlink-safe canonicalization (consistent with _shared route)
          const realPluginDir = await Deno.realPath(pluginDir);
          const realFile = await Deno.realPath(cssFilePath);
          if (!realFile.startsWith(realPluginDir + SEPARATOR)) {
            return c.json(problemJson("Not Found", 404, "Not found"), 404);
          }
          const content = await Deno.readTextFile(realFile);
          return new Response(content, {
            headers: { "Content-Type": "text/css; charset=utf-8" },
          });
        } catch {
          return c.json(problemJson("Not Found", 404, "Not found"), 404);
        }
      });
    }
  }
}
