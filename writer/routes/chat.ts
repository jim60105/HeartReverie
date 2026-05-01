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

import { validateParams } from "../lib/middleware.ts";
import { problemJson } from "../lib/errors.ts";
import { executeChat, ChatError, ChatAbortError } from "../lib/chat-shared.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";
import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";

const log = createLogger("http");

/** HTTP title mapping for ChatError codes. */
const ERROR_TITLES: Record<string, string> = {
  "api-key": "Internal Server Error",
  "bad-path": "Bad Request",
  "vento": "Unprocessable Entity",
  "no-prompt": "Internal Server Error",
  "llm-api": "AI Service Error",
  "llm-stream": "Bad Gateway",
  "no-body": "Bad Gateway",
  "no-content": "Bad Gateway",
  "story-config": "Unprocessable Entity",
  "no-chapter": "Bad Request",
  "concurrent": "Conflict",
};

export function registerChatRoutes(app: Hono, deps: Pick<AppDeps, "safePath" | "hookDispatcher" | "buildPromptFromStory" | "config">): void {
  const { safePath, hookDispatcher, buildPromptFromStory, config } = deps;

  app.post(
    "/api/stories/:series/:name/chat",
    validateParams,
    async (c) => {
      // Validate message body
      const body: Record<string, unknown> = await c.req.json().catch(() => ({}));
      const message: unknown = body.message;
      const template: unknown = body.template;
      if (typeof message !== "string" || message.trim().length === 0) {
        return c.json(problemJson("Bad Request", 400, "Message must be a non-empty string"), 400);
      }

      if (message.length > 100_000) {
        return c.json(problemJson("Bad Request", 400, "Message exceeds maximum length"), 400);
      }

      const series = c.req.param("series")!;
      const name = c.req.param("name")!;

      try {
        const result = await executeChat({
          series,
          name,
          message,
          template: typeof template === "string" ? template : undefined,
          config,
          safePath,
          hookDispatcher,
          buildPromptFromStory,
          signal: c.req.raw.signal,
        });

        return c.json(result);
      } catch (err: unknown) {
        if (err instanceof ChatAbortError) {
          // Client disconnected — return 499 (client closed request)
          return c.json(problemJson("Client Closed Request", 499, "Generation aborted by client"), 499 as ContentfulStatusCode);
        }
        if (err instanceof ChatError) {
          if (err.code === "vento" && err.ventoError) {
            return c.json({ type: "vento-error", ...err.ventoError }, 422);
          }
          const status = err.httpStatus as ContentfulStatusCode;
          const title = ERROR_TITLES[err.code] ?? "Internal Server Error";
          return c.json(problemJson(title, err.httpStatus, err.message), status);
        }
        log.error("Unexpected chat error", { error: err instanceof Error ? err.message : String(err), path: c.req.path });
        return c.json(problemJson("Internal Server Error", 500, "Failed to process chat request"), 500);
      }
    }
  );
}
