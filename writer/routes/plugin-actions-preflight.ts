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
 * Pre-flight validation for `runPluginActionWithDeps`. Encapsulates the
 * full chain of checks that must succeed BEFORE the per-story generation
 * lock is acquired:
 *
 *  1. Plugin gate — name shape, presence, `enabled !== false`, has dir
 *  2. Input validation — series/story/storyDir, promptPath, mode combo,
 *     extraVariables
 *  3. Prompt file read — translates `NotFound` to a 400 problem, other
 *     I/O failures to a 500 problem
 *  4. LLM config resolution — `StoryConfigValidationError` → 422, other
 *     failures → 500
 *  5. API key presence — missing `LLM_API_KEY` → 500
 *
 * Failure outcomes are returned as a closed `PluginActionOutcome` so the
 * caller can forward them directly. Success carries the {@link
 * PreflightContext} bundle the execute phase needs.
 *
 * Validation ORDER is load-bearing for HTTP semantics — callers that hit
 * multiple invalid conditions get the earliest-failing problem detail.
 * Keep the sequence below in sync with the original inlined order.
 */

import {
  errorMessage,
  pluginActionProblems,
  problemJson,
} from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { isValidPluginName } from "../lib/plugin-manager.ts";
import {
  resolveStoryLlmConfig,
  StoryConfigValidationError,
} from "../lib/story-config.ts";
import type { AppDeps, LlmConfig } from "../types.ts";
import type {
  PluginActionOutcome,
  PluginActionRequestArgs,
} from "./plugin-actions-shared.ts";
import {
  resolvePromptPath,
  validateAndResolveStoryDir,
  validateExtraVariables,
  validateModeCombo,
} from "./plugin-actions-validation.ts";

const log = createLogger("plugin");

/** Resolved values the execute phase consumes from preflight. */
export interface PreflightContext {
  readonly validSeries: string;
  readonly validStory: string;
  readonly storyDir: string;
  readonly resolvedPromptPath: string;
  readonly validatedMode:
    | "append-to-existing-chapter"
    | "replace-last-chapter"
    | "discard";
  readonly validatedAppendTag: string | null;
  readonly extras: Record<string, unknown>;
  readonly promptContent: string;
  readonly llmConfig: LlmConfig;
}

export type PreflightResult =
  | { readonly ok: true; readonly ctx: PreflightContext }
  | { readonly ok: false; readonly outcome: PluginActionOutcome };

/** Subset of `AppDeps` required by {@link runPreflight}. */
export type PreflightDeps = Pick<
  AppDeps,
  "config" | "safePath" | "pluginManager"
>;

/**
 * Execute the full preflight chain. Returns a discriminated result; on
 * `ok: false` the outcome is shaped for direct return to the caller.
 *
 * No side effects beyond:
 *  - settings-read attempt (best-effort; failures are warn-logged via
 *    `console.warn` and treated as non-fatal — matches original)
 *  - prompt file read
 *  - story config read (via `resolveStoryLlmConfig`)
 */
export async function runPreflight(
  args: PluginActionRequestArgs,
  deps: PreflightDeps,
): Promise<PreflightResult> {
  const { pluginName, series, story, promptPath, mode, appendTag, replace } =
    args;
  const { config, safePath, pluginManager } = deps;

  if (!isValidPluginName(pluginName)) {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: pluginActionProblems.invalidPluginName(),
        status: 400,
      },
    };
  }
  if (!pluginManager.hasPlugin(pluginName)) {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: pluginActionProblems.unknownPlugin(),
        status: 404,
      },
    };
  }
  // Refuse to run actions when the plugin is disabled in settings.
  // Frontend filters action buttons but a stale tab or direct API call could
  // still reach this endpoint.
  try {
    const resolved = await pluginManager.getPluginSettings(pluginName);
    if (resolved && (resolved as { enabled?: unknown }).enabled === false) {
      return {
        ok: false,
        outcome: {
          ok: false,
          aborted: false,
          problem: pluginActionProblems.pluginDisabled(),
          status: 409,
        },
      };
    }
  } catch (err: unknown) {
    // Settings read failure is non-fatal: log and continue (defence-in-depth
    // shouldn't block the action when settings happen to be unreadable).
    const message = errorMessage(err);
    console.warn(
      `[plugin-actions] Failed to read settings for ${pluginName}: ${message}`,
    );
  }
  const pluginDir = pluginManager.getPluginDir(pluginName);
  if (!pluginDir) {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: pluginActionProblems.unknownPlugin(),
        status: 404,
      },
    };
  }

  const storyResolution = await validateAndResolveStoryDir(
    series,
    story,
    safePath,
  );
  if (!storyResolution.ok) {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: storyResolution.problem,
        status: storyResolution.status,
      },
    };
  }
  const {
    series: validSeries,
    story: validStory,
    storyDir,
  } = storyResolution;

  if (typeof promptPath !== "string") {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: pluginActionProblems.invalidPromptPath(),
        status: 400,
      },
    };
  }
  const promptResolution = await resolvePromptPath(pluginDir, promptPath);
  if (!promptResolution.ok) {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: promptResolution.problem,
        status: promptResolution.problem.status,
      },
    };
  }
  const resolvedPromptPath = promptResolution.path;

  const modeResolution = validateModeCombo(mode, appendTag, replace);
  if (!modeResolution.ok) {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: modeResolution.problem,
        status: modeResolution.status,
      },
    };
  }
  const { mode: validatedMode, appendTag: validatedAppendTag } = modeResolution;

  const extraResult = validateExtraVariables(args.extraVariables);
  if (!extraResult.ok) {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: extraResult.problem,
        status: extraResult.problem.status,
      },
    };
  }

  let promptContent: string;
  try {
    promptContent = await Deno.readTextFile(resolvedPromptPath);
  } catch (err: unknown) {
    if (err instanceof Deno.errors.NotFound) {
      return {
        ok: false,
        outcome: {
          ok: false,
          aborted: false,
          problem: pluginActionProblems.promptFileNotFound(),
          status: 400,
        },
      };
    }
    log.warn(`[plugin-actions] Prompt file read error: ${errorMessage(err)}`);
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: problemJson(
          "Internal Server Error",
          500,
          "Prompt file read failed",
        ),
        status: 500,
      },
    };
  }

  let llmConfig: LlmConfig;
  try {
    llmConfig = await resolveStoryLlmConfig(storyDir, config.llmDefaults);
  } catch (err) {
    if (err instanceof StoryConfigValidationError) {
      return {
        ok: false,
        outcome: {
          ok: false,
          aborted: false,
          problem: problemJson(
            "Unprocessable Entity",
            422,
            `Invalid _config.json: ${err.message}`,
          ),
          status: 422,
        },
      };
    }
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: problemJson(
          "Internal Server Error",
          500,
          "Failed to read story configuration",
        ),
        status: 500,
      },
    };
  }

  if (!Deno.env.get("LLM_API_KEY")) {
    return {
      ok: false,
      outcome: {
        ok: false,
        aborted: false,
        problem: problemJson(
          "Internal Server Error",
          500,
          "LLM_API_KEY is not configured",
        ),
        status: 500,
      },
    };
  }

  return {
    ok: true,
    ctx: {
      validSeries,
      validStory,
      storyDir,
      resolvedPromptPath,
      validatedMode,
      validatedAppendTag,
      extras: extraResult.value,
      promptContent,
      llmConfig,
    },
  };
}
