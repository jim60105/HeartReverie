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

import { Hono } from "@hono/hono";
import { secureHeaders } from "@hono/hono/secure-headers";
import { bodyLimit } from "@hono/hono/body-limit";
import { serveStatic } from "@hono/hono/deno";
import { join, relative } from "@std/path";
import { problemJson } from "./lib/errors.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerStoriesRoutes } from "./routes/stories.ts";
import { registerChapterRoutes } from "./routes/chapters.ts";
import { registerChatRoutes } from "./routes/chat.ts";
import { registerPluginRoutes } from "./routes/plugins.ts";
import { registerPromptRoutes } from "./routes/prompt.ts";
import { registerConfigRoutes } from "./routes/config.ts";
import type { Context, Next } from "@hono/hono";
import type { AppDeps } from "./types.ts";

interface RateLimiterOptions {
  readonly windowMs: number;
  readonly limit: number;
}

interface RateLimitData {
  count: number;
  resetTime: number;
}

function rateLimiter({ windowMs, limit }: RateLimiterOptions): (c: Context, next: Next) => Promise<Response | void> {
  const hits: Map<string, RateLimitData> = new Map();

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, data] of hits) {
      if (now > data.resetTime) hits.delete(key);
    }
  }, windowMs);
  // Allow the process to exit even if the interval is still active
  if (typeof cleanupInterval === "number") {
    // Deno doesn't have unref on interval IDs directly, but this is fine
  }

  return async (c: Context, next: Next) => {
    const key = c.env?.remoteAddr?.hostname || "unknown";
    const now = Date.now();
    let data = hits.get(key);

    if (!data || now > data.resetTime) {
      data = { count: 0, resetTime: now + windowMs };
      hits.set(key, data);
    }

    data.count++;

    if (data.count > limit) {
      return c.json(problemJson("Too Many Requests", 429, "Rate limit exceeded"), 429);
    }

    await next();
  };
}

export { rateLimiter };

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  // Security headers (replaces helmet)
  app.use("*", secureHeaders({
    // @ts-expect-error Hono types don't model `false` to disable CSP
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
  }));

  // Body size limit (replaces Express express.json({ limit: "1mb" }))
  app.use("/api/*", bodyLimit({ maxSize: 1024 * 1024 }));

  // Rate limiting
  app.use("/api/*", rateLimiter({ windowMs: 60_000, limit: 60 }));
  app.use("/api/auth/verify", rateLimiter({ windowMs: 60_000, limit: 10 }));
  app.use("/api/stories/:series/:name/chat", rateLimiter({ windowMs: 60_000, limit: 10 }));
  app.use("/api/stories/:series/:name/preview-prompt", rateLimiter({ windowMs: 60_000, limit: 10 }));

  // Auth middleware for API routes (skip public endpoints)
  app.use("/api/*", async (c, next) => {
    if (new URL(c.req.url).pathname === "/api/config") return next();
    return deps.verifyPassphrase(c, next);
  });

  // Routes
  registerAuthRoutes(app);
  registerConfigRoutes(app, deps);
  registerStoriesRoutes(app, deps);
  registerChapterRoutes(app, deps);
  registerChatRoutes(app, deps);
  registerPluginRoutes(app, deps);
  registerPromptRoutes(app, deps);

  // Block dotfile access (e.g., /.env, /.gitignore)
  app.use("/*", async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (path.split("/").some((seg) => seg.startsWith("."))) {
      return c.json(problemJson("Forbidden", 403, "Access denied"), 403);
    }
    await next();
  });

  // Serve project assets (e.g., background images)
  const assetsRelative = relative(Deno.cwd(), join(deps.config.ROOT_DIR, "assets"));
  app.use(
    "/assets/*",
    serveStatic({ root: assetsRelative, rewriteRequestPath: (p) => p.replace(/^\/assets/, "") })
  );

  // Compatibility route: serve legacy /js/utils.js for third-party plugins
  app.get("/js/utils.js", (c) => {
    const js = `export function escapeHtml(str){return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#x27;");}`;
    return c.body(js, 200, { "Content-Type": "application/javascript; charset=utf-8" });
  });

  // Serve reader frontend
  const readerRelative = relative(Deno.cwd(), deps.config.READER_DIR);
  app.use(
    "/*",
    serveStatic({ root: readerRelative })
  );

  // SPA fallback: serve index.html for unmatched GET requests (HTML5 history mode)
  app.get("*", async (c) => {
    const path = new URL(c.req.url).pathname;
    // Don't fallback for API, plugin, asset, or JS routes
    if (
      path.startsWith("/api/") ||
      path.startsWith("/plugins/") ||
      path.startsWith("/assets/") ||
      path.startsWith("/js/")
    ) {
      return c.json(problemJson("Not Found", 404, "Resource not found"), 404);
    }
    const indexPath = join(deps.config.READER_DIR, "index.html");
    try {
      const content = await Deno.readTextFile(indexPath);
      return c.html(content);
    } catch {
      return c.json(problemJson("Not Found", 404, "index.html not found"), 404);
    }
  });

  return app;
}
