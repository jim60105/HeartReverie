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
 * @module chat-shared
 *
 * High-level inbound entrypoints for chat and continue-last-chapter
 * requests. Each function:
 *   1. Runs the inline preflight helpers below (API key, story dir,
 *      llm config, template override, generation lock).
 *   2. Mints a per-request `correlationId` at this inbound boundary so
 *      `prompt-assembly` (via `buildPromptFromStory…`) and
 *      `pre-llm-fetch` (inside `streamLlmAndPersist`) observe the same
 *      UUID.
 *   3. Builds the prompt + writeMode and delegates to
 *      `streamLlmAndPersist` (re-exported here for other importers).
 */

import { ContinuePromptError, resolveTargetChapterNumber } from "./story.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";
import {
  ChatAbortError,
  ChatError,
  type ChatErrorCode,
  type ChatOptions,
  type ChatResult,
  type ContinueOptions,
  type ContinueResult,
  type StreamLlmArgs,
  type StreamLlmResult,
  type WriteMode,
} from "./chat-types.ts";
import { normaliseAppendContent } from "./chat-chapter-io.ts";
import { streamLlmAndPersist } from "./chat-stream-and-persist.ts";
import { errorMessage } from "./errors.ts";
import { readTemplate } from "./prompt-file.ts";
import type { LlmConfig } from "../types.ts";
import { resolveStoryLlmConfig, StoryConfigValidationError } from "./story-config.ts";
import { clearGenerationActive, tryMarkGenerationActive } from "./generation-registry.ts";

export {
  ChatAbortError,
  ChatError,
  type ChatErrorCode,
  type ChatOptions,
  type ChatResult,
  type ContinueOptions,
  type ContinueResult,
  type StreamLlmArgs,
  type StreamLlmResult,
  type WriteMode,
};

// Re-exported so existing callers/tests that imported these from this
// module continue to work after the chapter-IO and stream-and-persist
// extractions. Their implementations live in sibling modules.
export { normaliseAppendContent, streamLlmAndPersist };

const log = createLogger("llm");

// ---------------------------------------------------------------------------
// Inline preflight helpers
//
// Not pure — these helpers log, hit the filesystem, mutate the in-memory
// generation registry, and read environment variables. They each surface
// failures by throwing `ChatError` so callers don't need to repeat the
// try/catch boilerplate.
// ---------------------------------------------------------------------------

function requireApiKey(reqLog: Logger): void {
  if (!Deno.env.get("LLM_API_KEY")) {
    reqLog.error("LLM_API_KEY not configured");
    throw new ChatError("api-key", "LLM_API_KEY is not configured", 500);
  }
}

function ensureSafeStoryDir(
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

async function resolveLlmConfigOrThrow(
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

async function resolveTemplateOverride(
  template: string | undefined,
  config: ChatOptions["config"],
  reqLog: Logger,
): Promise<string | undefined> {
  if (typeof template === "string") return template;
  try {
    const tpl = await readTemplate(config);
    if (tpl.source === "custom") return tpl.content;
  } catch (err: unknown) {
    if (!(err instanceof Deno.errors.NotFound)) {
      reqLog.error(`[chat] Failed to read system prompt: ${errorMessage(err)}`);
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
async function runUnderGenerationLock<T>(
  series: string,
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tryMarkGenerationActive(series, name)) {
    throw new ChatError(
      "concurrent",
      "Another generation is already in progress for this story",
      409,
    );
  }
  try {
    return await fn();
  } finally {
    clearGenerationActive(series, name);
  }
}

/**
 * Execute a chat request: resolve template, build prompt, call LLM with
 * streaming, write to file incrementally, and run lifecycle hooks. Thin
 * wrapper around `streamLlmAndPersist({ writeMode: { kind: "write-new-chapter" } })`
 * that handles the chat-specific prep work (auth, story config, prompt build,
 * generation-lock acquisition).
 */
export async function executeChat(options: ChatOptions): Promise<ChatResult> {
  const {
    series,
    name,
    message,
    template,
    config,
    safePath,
    hookDispatcher,
    buildPromptFromStory,
    onDelta,
    signal,
  } = options;
  const reqLog = log;

  reqLog.info("Chat execution started", { series, story: name, messageLength: message.length });

  // Mint the per-request correlationId at the inbound boundary so both
  // `prompt-assembly` (via buildPromptFromStory) and `pre-llm-fetch`
  // (inside streamLlmAndPersist) observe the same UUID.
  const correlationId = crypto.randomUUID();

  requireApiKey(reqLog);
  const storyDir = ensureSafeStoryDir(safePath, series, name);
  const llmConfig = await resolveLlmConfigOrThrow(
    storyDir,
    config.llmDefaults,
    reqLog,
    series,
    name,
  );
  const templateOverride = await resolveTemplateOverride(template, config, log);

  const {
    messages: templateMessages,
    ventoError,
    chapterFiles,
    chapters,
  } = await buildPromptFromStory(
    series,
    name,
    storyDir,
    message,
    templateOverride,
    undefined,
    correlationId,
  );

  if (ventoError) {
    throw new ChatError("vento", "Template rendering error", 422, ventoError);
  }

  if (templateMessages.length === 0) {
    throw new ChatError("no-prompt", "Failed to generate prompt", 500);
  }

  const targetChapterNumber = resolveTargetChapterNumber(chapterFiles, chapters);

  return await runUnderGenerationLock(series, name, async () => {
    const result = await streamLlmAndPersist({
      messages: templateMessages,
      llmConfig,
      series,
      name,
      storyDir,
      rootDir: config.ROOT_DIR,
      signal,
      writeMode: { kind: "write-new-chapter", userMessage: message, targetChapterNumber },
      onDelta,
      hookDispatcher,
      config,
      correlationId,
    });
    return {
      chapter: result.chapterNumber ?? 0,
      content: result.chapterContentAfter ?? result.content,
      usage: result.usage,
    };
  });
}

/**
 * Execute a continue-last-chapter request: re-read latest chapter, parse
 * `<user_message>` + assistant prefill, build prompt with the trailing
 * assistant turn (when prefill non-empty), then stream LLM output and
 * append to the existing chapter file. Translates `ContinuePromptError`
 * (from `parseChapterForContinue` failures) into `ChatError`.
 */
export async function executeContinue(options: ContinueOptions): Promise<ContinueResult> {
  const {
    series,
    name,
    template,
    config,
    safePath,
    hookDispatcher,
    buildContinuePromptFromStory,
    onDelta,
    signal,
  } = options;
  const reqLog = log;

  reqLog.info("Continue execution started", { series, story: name });

  // Mint correlationId at the inbound boundary; threaded through
  // prompt-assembly and pre-llm-fetch.
  const correlationId = crypto.randomUUID();

  requireApiKey(reqLog);
  const storyDir = ensureSafeStoryDir(safePath, series, name);
  const llmConfig = await resolveLlmConfigOrThrow(
    storyDir,
    config.llmDefaults,
    reqLog,
    series,
    name,
  );
  const templateOverride = await resolveTemplateOverride(template, config, log);

  let promptResult;
  try {
    promptResult = await buildContinuePromptFromStory(
      series,
      name,
      storyDir,
      templateOverride,
      correlationId,
    );
  } catch (err) {
    if (err instanceof ContinuePromptError) {
      throw new ChatError(err.code, err.message, err.httpStatus);
    }
    throw err;
  }

  const { messages, ventoError, targetChapterNumber, existingContent } = promptResult;

  if (ventoError) {
    throw new ChatError("vento", "Template rendering error", 422, ventoError);
  }
  if (messages.length === 0) {
    throw new ChatError("no-prompt", "Failed to generate prompt", 500);
  }

  return await runUnderGenerationLock(series, name, async () => {
    const result = await streamLlmAndPersist({
      messages,
      llmConfig,
      series,
      name,
      storyDir,
      rootDir: config.ROOT_DIR,
      signal,
      writeMode: { kind: "continue-last-chapter", targetChapterNumber, existingContent },
      onDelta,
      hookDispatcher,
      config,
      correlationId,
    });
    return {
      chapter: result.chapterNumber ?? targetChapterNumber,
      content: result.chapterContentAfter ?? "",
      usage: result.usage,
    };
  });
}
