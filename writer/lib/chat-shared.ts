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
 *   1. Runs the shared preflight (API key, story dir, llm config,
 *      template override, generation lock) via `chat-preflight.ts`.
 *   2. Mints a per-request `correlationId` at this inbound boundary so
 *      `prompt-assembly` (via `buildPromptFromStory…`) and
 *      `pre-llm-fetch` (inside `streamLlmAndPersist`) observe the same
 *      UUID.
 *   3. Builds the prompt + writeMode and delegates to
 *      `streamLlmAndPersist` (re-exported here for other importers).
 */

import {
  ContinuePromptError,
  resolveTargetChapterNumber,
} from "./story.ts";
import { createLogger } from "./logger.ts";
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
import {
  ensureSafeStoryDir,
  requireApiKey,
  resolveLlmConfigOrThrow,
  resolveTemplateOverride,
  runUnderGenerationLock,
} from "./chat-preflight.ts";

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
  const llmConfig = await resolveLlmConfigOrThrow(storyDir, config.llmDefaults, reqLog, series, name);
  const templateOverride = await resolveTemplateOverride(template, config, log);

  const {
    messages: templateMessages,
    ventoError,
    chapterFiles,
    chapters,
  } = await buildPromptFromStory(series, name, storyDir, message, templateOverride, undefined, correlationId);

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
  const llmConfig = await resolveLlmConfigOrThrow(storyDir, config.llmDefaults, reqLog, series, name);
  const templateOverride = await resolveTemplateOverride(template, config, log);

  let promptResult;
  try {
    promptResult = await buildContinuePromptFromStory(series, name, storyDir, templateOverride, correlationId);
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
