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
import type { AppDeps, LlmDefaultsResponse, LlmConfig } from "../types.ts";
import { STORY_LLM_CONFIG_KEYS } from "../lib/story-config.ts";

/**
 * Register `GET /api/llm-defaults` — returns the resolved server-side default
 * for every per-story-overridable LLM key. The payload is a flat camelCase
 * object that mirrors the whitelist schema of `StoryLlmConfigOverrides`. It
 * intentionally excludes `LLM_API_URL`, `LLM_API_KEY`, and `LLM_REASONING_OMIT`.
 *
 * The response is `Cache-Control: no-store` so an env change after a process
 * restart is reflected the next time the settings page is loaded.
 *
 * Authentication: this route is registered AFTER the global `/api/*` auth
 * middleware in `createApp`, so callers must present a valid `X-Passphrase`.
 */
export function registerLlmDefaultsRoutes(
  app: Hono,
  deps: Pick<AppDeps, "config">,
): void {
  app.get("/api/llm-defaults", (c) => {
    const src = deps.config.llmDefaults;
    // Build a fresh plain object containing exactly the whitelisted keys.
    // This guarantees no extra fields ever leak through, even if `LlmConfig`
    // is extended later with non-overridable values.
    const out: Record<string, unknown> = {};
    for (const key of STORY_LLM_CONFIG_KEYS) {
      out[key] = src[key satisfies keyof LlmConfig];
    }
    c.header("Cache-Control", "no-store");
    return c.json(out as unknown as LlmDefaultsResponse);
  });
}
