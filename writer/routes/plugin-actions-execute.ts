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
 * The "under-lock" portion of `runPluginActionWithDeps`. Runs after
 * preflight has succeeded and the per-story generation lock has been
 * acquired:
 *
 *  - Replace-mode draft injection: load the highest-numbered chapter
 *    under the lock, scrub prompt envelopes via the plugin manager's
 *    strip-tag patterns, and seed `renderVariables.draft`.
 *  - Build the LLM messages via the shared prompt-assembly pipeline,
 *    passing the plugin's prompt content as `templateOverride`.
 *  - Translate Vento errors (`multi-message:no-user-message` → 422,
 *    other → 422 "Template rendering error") into outcomes.
 *  - Compute the `WriteMode` discriminator and call
 *    `streamLlmAndPersist`.
 *  - Shape the success response with the documented
 *    `chapterUpdated`/`chapterReplaced` flags (only `append` sets
 *    `chapterUpdated`; only `replace` sets `chapterReplaced`).
 *
 * The caller's catch block translates `ChatError`/`ChatAbortError` for
 * downstream HTTP semantics; this module deliberately lets those
 * exceptions propagate.
 */

import { join } from "@std/path";
import { problemJson } from "../lib/errors.ts";
import { listChapterFiles } from "../lib/story.ts";
import { streamLlmAndPersist, type WriteMode } from "../lib/chat-shared.ts";
import type { AppDeps, PluginRunPromptResponse } from "../types.ts";
import { pluginActionProblems } from "../lib/errors.ts";
import type {
  PluginActionOutcome,
  PluginActionRequestArgs,
} from "./plugin-actions-shared.ts";
import type { PreflightContext } from "./plugin-actions-preflight.ts";

/** Subset of `AppDeps` consumed by {@link runUnderLock}. */
export type ExecuteDeps = Pick<
  AppDeps,
  "config" | "hookDispatcher" | "pluginManager" | "buildPromptFromStory"
>;

/**
 * Execute the LLM streaming flow for an already-validated, lock-held
 * plugin action. Returns the discriminated outcome; throws
 * `ChatError`/`ChatAbortError` from `streamLlmAndPersist` for the caller
 * to translate.
 */
export async function runUnderLock(
  args: PluginActionRequestArgs,
  deps: ExecuteDeps,
  ctx: PreflightContext,
): Promise<PluginActionOutcome> {
  const { pluginName, signal, onDelta } = args;
  const { config, hookDispatcher, pluginManager, buildPromptFromStory } = deps;
  const {
    validSeries,
    validStory,
    storyDir,
    validatedMode,
    validatedAppendTag,
    extras,
    promptContent,
    llmConfig,
  } = ctx;

  // Replace mode: load highest-numbered chapter under the lock, run through
  // the plugin-manager's strip-tag patterns to scrub `<user_message>` and
  // similar prompt envelopes, and inject as the reserved `draft` Vento
  // variable. Done HERE (after lock, before prompt render) so the on-disk
  // bytes the LLM sees are guaranteed to match the bytes we'll later
  // overwrite atomically.
  const renderVariables: Record<string, unknown> = { ...extras };
  if (validatedMode === "replace-last-chapter") {
    const chapterFiles = await listChapterFiles(storyDir);
    if (chapterFiles.length === 0) {
      return {
        ok: false,
        aborted: false,
        problem: pluginActionProblems.noChapter(),
        status: 400,
      };
    }
    const lastFile = chapterFiles[chapterFiles.length - 1]!;
    const lastChapterPath = join(storyDir, lastFile);
    const rawDraft = await Deno.readTextFile(lastChapterPath);
    const stripRegex = pluginManager.getStripTagPatterns();
    const cleanDraft = stripRegex
      ? rawDraft.replace(stripRegex, "").trim()
      : rawDraft.trim();
    renderVariables.draft = cleanDraft;
  }

  // Build messages via the shared prompt-assembly pipeline. Pass the plugin
  // prompt content as `templateOverride` and the validated extras as
  // `extraVariables`. Plugin actions render with empty user input — the
  // prompt template is itself the user's intent.
  const correlationId = crypto.randomUUID();
  const buildResult = await buildPromptFromStory(
    validSeries,
    validStory,
    storyDir,
    "",
    promptContent,
    renderVariables,
    correlationId,
  );
  if (buildResult.ventoError) {
    const vErr = buildResult.ventoError;
    if (vErr.type === "multi-message:no-user-message") {
      return {
        ok: false,
        aborted: false,
        problem: {
          type: "multi-message:no-user-message",
          title: vErr.title ?? "Missing User Message",
          status: 422,
          detail: vErr.message,
          ventoError: vErr,
        },
        status: 422,
      };
    }
    return {
      ok: false,
      aborted: false,
      problem: problemJson(
        "Unprocessable Entity",
        422,
        "Template rendering error",
        { ventoError: vErr },
      ),
      status: 422,
    };
  }
  if (buildResult.messages.length === 0) {
    return {
      ok: false,
      aborted: false,
      problem: problemJson(
        "Internal Server Error",
        500,
        "Failed to generate prompt",
      ),
      status: 500,
    };
  }

  let writeMode: WriteMode;
  if (validatedMode === "append-to-existing-chapter") {
    writeMode = {
      kind: "append-to-existing-chapter",
      appendTag: validatedAppendTag!,
      pluginName,
    };
  } else if (validatedMode === "replace-last-chapter") {
    writeMode = { kind: "replace-last-chapter", pluginName };
  } else {
    writeMode = { kind: "discard" };
  }

  const result = await streamLlmAndPersist({
    messages: buildResult.messages,
    llmConfig,
    series: validSeries,
    name: validStory,
    storyDir,
    rootDir: config.ROOT_DIR,
    signal,
    writeMode,
    onDelta,
    hookDispatcher,
    config,
    correlationId,
  });

  const response: PluginRunPromptResponse = {
    content: writeMode.kind === "append-to-existing-chapter" ||
        writeMode.kind === "replace-last-chapter"
      ? (result.chapterContentAfter ?? result.content)
      : result.content,
    usage: result.usage,
    chapterUpdated: writeMode.kind === "append-to-existing-chapter",
    chapterReplaced: writeMode.kind === "replace-last-chapter",
    appendedTag: validatedAppendTag,
  };
  return { ok: true, response };
}
