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

import { Hono } from "@hono/hono";
import { secureHeaders } from "@hono/hono/secure-headers";
import { bodyLimit } from "@hono/hono/body-limit";
import { serveStatic } from "@hono/hono/deno";
import { relative } from "@std/path";
import { problemJson } from "./lib/errors.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerStoriesRoutes } from "./routes/stories.ts";
import { registerChapterRoutes } from "./routes/chapters.ts";
import { registerChatRoutes } from "./routes/chat.ts";
import { registerPluginRoutes } from "./routes/plugins.ts";
import { registerPromptRoutes } from "./routes/prompt.ts";
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

  // Auth middleware for API routes
  app.use("/api/*", async (c, next) => {
    return deps.verifyPassphrase(c, next);
  });

  // Routes
  registerAuthRoutes(app);
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

  // Serve reader frontend
  const readerRelative = relative(Deno.cwd(), deps.config.READER_DIR);
  app.use(
    "/*",
    serveStatic({ root: readerRelative })
  );

  return app;
}
