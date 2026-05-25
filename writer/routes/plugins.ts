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

import { resolve, SEPARATOR } from "@std/path";
import { problemJson, errorMessage } from "../lib/errors.ts";
import { resolveLoreVariables } from "../lib/lore.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";

const log = createLogger("plugin");

export function registerPluginRoutes(
  app: Hono,
  deps: Pick<AppDeps, "pluginManager" | "config">,
): void {
  const { pluginManager } = deps;

  app.get("/api/plugins", async (c) => {
    const plugins = await Promise.all(
      pluginManager.getPlugins().map(async (p) => {
        let settings: Record<string, unknown> = {};
        if (p.settingsSchema) {
          settings = await pluginManager.getPluginSettings(p.name);
        }
        return {
          name: p.name,
          displayName: p.displayName,
          version: p.version,
          description: p.description,
          type: p.type,
          tags: p.tags || [],
          hasSettings: !!p.settingsSchema,
          settings,
          hasFrontendModule: !!p.frontendModule,
          displayStripTags: p.displayStripTags || [],
          frontendStyles: pluginManager.getPluginStyles(p.name).map(
            (cssPath) => `/plugins/${p.name}/${cssPath}`,
          ),
          actionButtons: pluginManager.getPluginActionButtons(p.name),
          hooks: Array.isArray(p.hooks) ? p.hooks : [],
        };
      }),
    );
    return c.json(plugins);
  });

  app.get("/api/plugins/action-buttons", async (c) => {
    const buttons = [];
    for (const plugin of pluginManager.getPlugins()) {
      const pluginButtons = pluginManager.getPluginActionButtons(plugin.name);
      if (pluginButtons.length === 0) continue;
      const settings = await pluginManager.getPluginSettings(plugin.name);
      if (settings.enabled === false) continue;
      for (const button of pluginButtons) {
        buttons.push({ ...button, pluginName: plugin.name });
      }
    }
    return c.json(buttons);
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
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        return c.json(problemJson("Not Found", 404, "Not found"), 404);
      }
      const message = errorMessage(err);
      log.warn(`[GET /plugins/_shared] File serving error: ${message}`);
      return c.json(
        problemJson("Internal Server Error", 500, "Internal server error"),
        500,
      );
    }
  });

  // Serve plugin JS modules: the declared frontendModule *and* any sibling
  // `.js` files explicitly declared in manifest.frontendImports. The route
  // enforces a manifest-driven allowlist on top of the path-containment /
  // dotfile / canonical-path checks: any `.js` file under a plugin
  // directory that is *not* declared returns 404, even if it exists on
  // disk. This is a defense-in-depth gate so that if a write endpoint ever
  // regresses and drops attacker-controlled bytes into a plugin directory,
  // those bytes still cannot be served as executable code.
  app.get("/plugins/:plugin/:path{.+\\.js}", async (c) => {
    const pluginName = c.req.param("plugin");
    const reqPath = c.req.param("path");

    // _shared has its own handler registered above; don't shadow it.
    if (pluginName === "_shared") {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }
    // Reject dotfile segments (e.g. ".env", "..", ".git").
    if (reqPath.split("/").some((seg) => seg.startsWith("."))) {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }
    const pluginDir = pluginManager.getPluginDir(pluginName);
    if (!pluginDir) {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }

    // Manifest-driven allowlist: only serve declared frontend assets.
    // Reject literal backslashes outright so the normalization below cannot
    // hide a POSIX filename containing `\` behind an allowlisted slash-form
    // entry. The validator already rejects `\` in manifest entries.
    if (reqPath.includes("\\")) {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }
    // Normalize reqPath to match the form returned by
    // getPluginAllowedJsFiles (forward-slash, no leading "./").
    let normReq = reqPath;
    while (normReq.startsWith("./")) normReq = normReq.slice(2);
    const allowed = pluginManager.getPluginAllowedJsFiles(pluginName);
    if (!allowed.has(normReq)) {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }

    const filePath = resolve(pluginDir, normReq);
    // Raw-path containment check (cheap, runs before any FS call).
    if (!filePath.startsWith(pluginDir + SEPARATOR)) {
      return c.json(problemJson("Not Found", 404, "Not found"), 404);
    }
    try {
      // Symlink-safe canonicalization.
      const realPluginDir = await Deno.realPath(pluginDir);
      const realFile = await Deno.realPath(filePath);
      if (!realFile.startsWith(realPluginDir + SEPARATOR)) {
        return c.json(problemJson("Not Found", 404, "Not found"), 404);
      }
      const content = await Deno.readTextFile(realFile);
      return new Response(content, {
        headers: { "Content-Type": "application/javascript" },
      });
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        return c.json(problemJson("Not Found", 404, "Not found"), 404);
      }
      const message = errorMessage(err);
      log.warn(
        `[GET /plugins/:plugin/:path] File serving error: ${message}`,
      );
      return c.json(
        problemJson("Internal Server Error", 500, "Internal server error"),
        500,
      );
    }
  });

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
        log.warn("Plugin CSS escapes plugin directory — skipping", {
          plugin: plugin.name,
          cssPath,
          resolved: cssFilePath,
        });
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
        } catch (err: unknown) {
          if (err instanceof Deno.errors.NotFound) {
            return c.json(problemJson("Not Found", 404, "Not found"), 404);
          }
          const message = errorMessage(err);
          log.warn(`[GET /plugins/:plugin/css] File serving error: ${message}`);
          return c.json(
            problemJson("Internal Server Error", 500, "Internal server error"),
            500,
          );
        }
      });
    }
  }
}
