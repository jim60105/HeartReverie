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

/**
 * @module chat-preflight
 *
 * Shared preflight helpers used by both `executeChat` and
 * `executeContinue` to keep their pre-stream setup DRY: API-key check,
 * story-dir resolution, story `_config.json` resolution with structured
 * error translation, optional template override resolution, and the
 * per-story generation-lock wrapping.
 *
 * Not pure — these helpers log, hit the filesystem, mutate the in-memory
 * generation registry, and read environment variables. They each surface
 * failures by throwing `ChatError` so callers don't need to repeat the
 * try/catch boilerplate.
 */

import { errorMessage } from "./errors.ts";
import { readTemplate } from "../routes/prompt.ts";
import type { LlmConfig } from "../types.ts";
import type { Logger } from "./logger.ts";
import {
  resolveStoryLlmConfig,
  StoryConfigValidationError,
} from "./story-config.ts";
import {
  clearGenerationActive,
  tryMarkGenerationActive,
} from "./generation-registry.ts";
import { ChatError } from "./chat-types.ts";
import type { ChatOptions } from "./chat-types.ts";

export function requireApiKey(reqLog: Logger): void {
  if (!Deno.env.get("LLM_API_KEY")) {
    reqLog.error("LLM_API_KEY not configured");
    throw new ChatError("api-key", "LLM_API_KEY is not configured", 500);
  }
}

export function ensureSafeStoryDir(
  safePath: ChatOptions["safePath"],
  series: string,
  name: string,
): string {
  const storyDir = safePath(series, name);
  if (!storyDir) {
    throw new ChatError("bad-path", "Invalid path", 400);
  }
  return storyDir;
}

export async function resolveLlmConfigOrThrow(
  storyDir: string,
  llmDefaults: ChatOptions["config"]["llmDefaults"],
  reqLog: Logger,
  series: string,
  name: string,
): Promise<LlmConfig> {
  try {
    return await resolveStoryLlmConfig(storyDir, llmDefaults);
  } catch (err) {
    if (err instanceof StoryConfigValidationError) {
      reqLog.error("Invalid story _config.json", { series, story: name, error: err.message });
      throw new ChatError("story-config", `Invalid _config.json: ${err.message}`, 422);
    }
    const msg = errorMessage(err);
    reqLog.error("Failed to read story _config.json", { series, story: name, error: msg });
    throw new ChatError("story-config", "Failed to read story configuration", 500);
  }
}

export async function resolveTemplateOverride(
  template: string | undefined,
  config: ChatOptions["config"],
  log: Logger,
): Promise<string | undefined> {
  if (typeof template === "string") return template;
  try {
    const tpl = await readTemplate(config);
    if (tpl.source === "custom") return tpl.content;
  } catch (err: unknown) {
    if (!(err instanceof Deno.errors.NotFound)) {
      log.error(`[chat] Failed to read system prompt: ${errorMessage(err)}`);
    }
    // NotFound is expected — proceed with default
  }
  return undefined;
}

/**
 * Acquire the per-story generation lock, run `fn`, and ALWAYS release on
 * success or failure. Throws `ChatError("concurrent", ...)` when another
 * generation is already in progress for `(series, name)`.
 */
export async function runUnderGenerationLock<T>(
  series: string,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tryMarkGenerationActive(series, name)) {
    throw new ChatError("concurrent", "Another generation is already in progress for this story", 409);
  }
  try {
    return await fn();
  } finally {
    clearGenerationActive(series, name);
  }
}
