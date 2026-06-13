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
import { errorMessage, problemJson } from "../lib/errors.ts";
import { executeChat, executeContinue } from "../lib/chat-shared.ts";
import { translateChatError } from "../lib/chat-error-translate.ts";
import { createLogger } from "../lib/logger.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";
import type { ContentfulStatusCode } from "@hono/hono/utils/http-status";

const log = createLogger("http");

export function registerChatRoutes(
  app: Hono,
  deps: Pick<
    AppDeps,
    | "safePath"
    | "hookDispatcher"
    | "buildPromptFromStory"
    | "buildContinuePromptFromStory"
    | "config"
  >,
): void {
  const { safePath, hookDispatcher, buildPromptFromStory, buildContinuePromptFromStory, config } =
    deps;

  app.post(
    "/api/stories/:series/:name/chat",
    validateParams,
    async (c) => {
      // Validate message body
      let body: Record<string, unknown>;
      try {
        body = await c.req.json();
      } catch (err: unknown) {
        log.warn(`[POST /api/chat] Malformed request body: ${errorMessage(err)}`);
        return c.json(problemJson("Bad Request", 400, "Invalid JSON in request body"), 400);
      }
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
        const t = translateChatError(err, "Failed to process chat request");
        if (t.kind === "aborted") {
          // Client disconnected — return 499 (client closed request)
          return c.json(
            problemJson("Client Closed Request", 499, "Generation aborted by client"),
            499 as ContentfulStatusCode,
          );
        }
        if (t.kind === "unexpected") {
          log.error("Unexpected chat error", { ...t.logFields, path: c.req.path });
        } else {
          log.error("Chat request failed", { path: c.req.path, ...t.logFields });
        }
        if (t.kind === "vento") {
          return c.json(t.body, 422);
        }
        return c.json(t.problem, t.status as ContentfulStatusCode);
      }
    },
  );

  app.post(
    "/api/stories/:series/:name/chat/continue",
    validateParams,
    async (c) => {
      // Body is ignored per spec — continue always uses the resolved
      // server-side template / system.md. Drain it harmlessly to avoid
      // hanging clients that send a payload anyway.
      await c.req.json().catch(() => ({}));

      const series = c.req.param("series")!;
      const name = c.req.param("name")!;

      try {
        const result = await executeContinue({
          series,
          name,
          config,
          safePath,
          hookDispatcher,
          buildContinuePromptFromStory,
          signal: c.req.raw.signal,
        });

        // IMPORTANT: `result.content` is the FULL chapter content
        // (re-read from disk after the stream finished), not just the
        // newly streamed bytes. The HTTP response carries the complete
        // chapter so the client can replace its local copy in one shot.
        return c.json(result);
      } catch (err: unknown) {
        const t = translateChatError(err, "Failed to process continue request");
        if (t.kind === "aborted") {
          return c.json(
            problemJson("Client Closed Request", 499, "Generation aborted by client"),
            499 as ContentfulStatusCode,
          );
        }
        if (t.kind === "unexpected") {
          log.error("Unexpected continue error", { ...t.logFields, path: c.req.path });
        } else {
          log.error("Continue request failed", { path: c.req.path, ...t.logFields });
        }
        if (t.kind === "vento") {
          return c.json(t.body, 422);
        }
        return c.json(t.problem, t.status as ContentfulStatusCode);
      }
    },
  );
}
