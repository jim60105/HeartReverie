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
import { join, resolve } from "@std/path";
import { pluginActionProblems, problemJson } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { isValidParam } from "../lib/middleware.ts";
import { isValidPluginName } from "../lib/plugin-manager.ts";
import { listChapterFiles } from "../lib/story.ts";
import {
  tryMarkGenerationActive,
  clearGenerationActive,
} from "../lib/generation-registry.ts";
import {
  ChatAbortError,
  ChatError,
  streamLlmAndPersist,
  type WriteMode,
} from "../lib/chat-shared.ts";
import { resolveStoryLlmConfig, StoryConfigValidationError } from "../lib/story-config.ts";
import type {
  AppDeps,
  PluginRunPromptResponse,
  ProblemDetail,
} from "../types.ts";

const log = createLogger("plugin");

/**
 * Reserved Vento variable names that plugin-action callers MUST NOT override
 * via `extraVariables`. The check is case-sensitive and applied AFTER the
 * scalar-type validation. `lore_*` is a wildcard prefix and is handled
 * separately below.
 */
const RESERVED_VARIABLE_NAMES: readonly string[] = [
  "previousContext",
  "previous_context",
  "user_input",
  "userInput",
  "status_data",
  "isFirstRound",
  "series_name",
  "story_name",
  "plugin_fragments",
  "draft",
];

const APPEND_TAG_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,30}$/;

/** Outcome of `runPluginAction` — discriminated by `ok`. */
export type PluginActionOutcome =
  | {
    readonly ok: true;
    readonly response: PluginRunPromptResponse;
  }
  | {
    readonly ok: false;
    readonly aborted: true;
  }
  | {
    readonly ok: false;
    readonly aborted: false;
    readonly problem: ProblemDetail;
    readonly status: number;
  };

/** Parameters accepted by both the HTTP route and the WebSocket handler. */
export interface PluginActionRequestArgs {
  readonly pluginName: string;
  readonly series: unknown;
  readonly story: unknown;
  readonly promptPath: unknown;
  readonly mode: unknown;
  readonly appendTag?: unknown;
  readonly replace?: unknown;
  readonly extraVariables?: unknown;
  readonly signal?: AbortSignal;
  readonly onDelta?: (chunk: string) => void;
}

/**
 * Validate `extraVariables` payload. Rejects non-objects, arrays, and any
 * value whose entries are not string/number/boolean. Returns the validated
 * record on success or a problem detail on failure.
 */
function validateExtraVariables(raw: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; problem: ProblemDetail } {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: pluginActionProblems.invalidExtraVariables() };
  }
  const obj = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return {
        ok: false,
        problem: pluginActionProblems.invalidExtraVariables(
          `extraVariables['${key}'] must be string, number, or boolean (got ${typeof value})`,
        ),
      };
    }
  }
  for (const key of Object.keys(obj)) {
    if (RESERVED_VARIABLE_NAMES.includes(key) || /^lore_/.test(key)) {
      return {
        ok: false,
        problem: pluginActionProblems.extraVariablesCollision(
          `extraVariables key '${key}' collides with a reserved system variable`,
        ),
      };
    }
  }
  return { ok: true, value: obj };
}

/**
 * Resolve and canonicalise the prompt file path, ensuring it is contained
 * within `pluginDir`, has a `.md` extension, and points to a regular file.
 * Returns the absolute resolved path on success, or a problem detail.
 */
async function resolvePromptPath(
  pluginDir: string,
  rawPath: string,
): Promise<{ ok: true; path: string } | { ok: false; problem: ProblemDetail }> {
  if (rawPath.length === 0 || rawPath.includes("\x00")) {
    return { ok: false, problem: pluginActionProblems.invalidPromptPath() };
  }
  if (!rawPath.endsWith(".md")) {
    return { ok: false, problem: pluginActionProblems.nonMdPrompt() };
  }
  const candidate = resolve(pluginDir, rawPath);
  let realCandidate: string;
  let realPluginDir: string;
  try {
    realPluginDir = await Deno.realPath(pluginDir);
  } catch {
    return { ok: false, problem: pluginActionProblems.unknownPlugin("Plugin directory missing on disk") };
  }
  try {
    realCandidate = await Deno.realPath(candidate);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: false, problem: pluginActionProblems.promptFileNotFound() };
    }
    return { ok: false, problem: pluginActionProblems.invalidPromptPath() };
  }
  // Containment check: realCandidate must be inside realPluginDir.
  const sep = realPluginDir.endsWith("/") ? "" : "/";
  if (
    realCandidate !== realPluginDir &&
    !realCandidate.startsWith(realPluginDir + sep)
  ) {
    return { ok: false, problem: pluginActionProblems.invalidPromptPath("Prompt path escapes plugin directory") };
  }
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(realCandidate);
  } catch {
    return { ok: false, problem: pluginActionProblems.promptFileNotFound() };
  }
  if (!stat.isFile) {
    return { ok: false, problem: pluginActionProblems.promptFileNotFound("Prompt path is not a regular file") };
  }
  return { ok: true, path: realCandidate };
}

/**
 * Internal core runner shared by both the HTTP route and the WebSocket
 * handler. Performs all validation, acquires the per-story generation lock,
 * calls `streamLlmAndPersist` with the right `WriteMode`, and returns a
 * discriminated outcome.
 */
export async function runPluginActionWithDeps(
  args: PluginActionRequestArgs,
  deps: Pick<AppDeps, "config" | "safePath" | "hookDispatcher" | "pluginManager" | "buildPromptFromStory">,
): Promise<PluginActionOutcome> {
  const { pluginName, series, story, promptPath, mode, appendTag, replace, extraVariables, signal, onDelta } = args;
  const { config, safePath, hookDispatcher, pluginManager, buildPromptFromStory } = deps;

  if (!isValidPluginName(pluginName)) {
    return { ok: false, aborted: false, problem: pluginActionProblems.invalidPluginName(), status: 400 };
  }
  if (!pluginManager.hasPlugin(pluginName)) {
    return { ok: false, aborted: false, problem: pluginActionProblems.unknownPlugin(), status: 404 };
  }
  const pluginDir = pluginManager.getPluginDir(pluginName);
  if (!pluginDir) {
    return { ok: false, aborted: false, problem: pluginActionProblems.unknownPlugin(), status: 404 };
  }

  if (typeof series !== "string" || typeof story !== "string" || !isValidParam(series) || !isValidParam(story)) {
    return {
      ok: false,
      aborted: false,
      problem: problemJson("Bad Request", 400, "Invalid series or story name"),
      status: 400,
    };
  }
  const storyDir = safePath(series, story);
  if (!storyDir) {
    return {
      ok: false,
      aborted: false,
      problem: problemJson("Bad Request", 400, "Invalid path"),
      status: 400,
    };
  }
  // Spec: require story directory to exist (HTTP 404 otherwise).
  try {
    const stat = await Deno.stat(storyDir);
    if (!stat.isDirectory) {
      return {
        ok: false,
        aborted: false,
        problem: problemJson("Not Found", 404, "Story directory not found"),
        status: 404,
      };
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return {
        ok: false,
        aborted: false,
        problem: problemJson("Not Found", 404, "Story directory not found"),
        status: 404,
      };
    }
    throw err;
  }

  if (typeof promptPath !== "string") {
    return { ok: false, aborted: false, problem: pluginActionProblems.invalidPromptPath(), status: 400 };
  }
  const promptResolution = await resolvePromptPath(pluginDir, promptPath);
  if (!promptResolution.ok) {
    return { ok: false, aborted: false, problem: promptResolution.problem, status: promptResolution.problem.status };
  }
  const resolvedPromptPath = promptResolution.path;

  if (mode !== "append-to-existing-chapter" && mode !== "discard" && mode !== "replace-last-chapter") {
    return {
      ok: false,
      aborted: false,
      problem: problemJson(
        "Bad Request",
        400,
        "mode must be 'append-to-existing-chapter', 'replace-last-chapter', or 'discard'",
      ),
      status: 400,
    };
  }
  // Tri-state mode/replace/append validation. The route translates
  // (append, replace) → mode, but a caller could (in theory) send raw modes
  // bypassing that translation. Reject contradictory combinations centrally.
  if (mode === "replace-last-chapter" && replace === false) {
    return { ok: false, aborted: false, problem: pluginActionProblems.invalidReplaceCombo(), status: 400 };
  }
  if (mode === "replace-last-chapter" && appendTag !== undefined) {
    return {
      ok: false,
      aborted: false,
      problem: pluginActionProblems.invalidReplaceCombo(
        "replace mode cannot be combined with appendTag",
      ),
      status: 400,
    };
  }
  if (mode === "append-to-existing-chapter" && replace === true) {
    return {
      ok: false,
      aborted: false,
      problem: pluginActionProblems.invalidReplaceCombo(
        "append and replace are mutually exclusive",
      ),
      status: 400,
    };
  }
  let validatedAppendTag: string | null = null;
  if (mode === "append-to-existing-chapter") {
    if (typeof appendTag !== "string" || !APPEND_TAG_RE.test(appendTag)) {
      return { ok: false, aborted: false, problem: pluginActionProblems.invalidAppendTag(), status: 400 };
    }
    validatedAppendTag = appendTag;
  }

  const extraResult = validateExtraVariables(extraVariables);
  if (!extraResult.ok) {
    return { ok: false, aborted: false, problem: extraResult.problem, status: extraResult.problem.status };
  }

  let promptContent: string;
  try {
    promptContent = await Deno.readTextFile(resolvedPromptPath);
  } catch (err: unknown) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: false, aborted: false, problem: pluginActionProblems.promptFileNotFound(), status: 400 };
    }
    log.warn(`[plugin-actions] Prompt file read error: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, aborted: false, problem: problemJson("Internal Server Error", 500, "Prompt file read failed"), status: 500 };
  }

  let llmConfig;
  try {
    llmConfig = await resolveStoryLlmConfig(storyDir, config.llmDefaults);
  } catch (err) {
    if (err instanceof StoryConfigValidationError) {
      return {
        ok: false,
        aborted: false,
        problem: problemJson("Unprocessable Entity", 422, `Invalid _config.json: ${err.message}`),
        status: 422,
      };
    }
    return {
      ok: false,
      aborted: false,
      problem: problemJson("Internal Server Error", 500, "Failed to read story configuration"),
      status: 500,
    };
  }

  if (!Deno.env.get("LLM_API_KEY")) {
    return {
      ok: false,
      aborted: false,
      problem: problemJson("Internal Server Error", 500, "LLM_API_KEY is not configured"),
      status: 500,
    };
  }

  // Acquire the per-story generation lock atomically BEFORE prompt render so
  // that replace mode can safely read the on-disk chapter under the lock and
  // inject it as the `draft` variable. For non-replace modes, the lock just
  // happens slightly earlier than before — semantically identical (the lock
  // is held for the entire LLM call regardless).
  if (!tryMarkGenerationActive(series, story)) {
    return { ok: false, aborted: false, problem: pluginActionProblems.concurrentGeneration(), status: 409 };
  }

  try {
    // Replace mode: load highest-numbered chapter under the lock, run through
    // the plugin-manager's strip-tag patterns to scrub `<user_message>` and
    // similar prompt envelopes, and inject as the reserved `draft` Vento
    // variable. Done HERE (after lock, before prompt render) so the on-disk
    // bytes the LLM sees are guaranteed to match the bytes we'll later
    // overwrite atomically.
    const renderVariables: Record<string, unknown> = { ...extraResult.value };
    if (mode === "replace-last-chapter") {
      const chapterFiles = await listChapterFiles(storyDir);
      if (chapterFiles.length === 0) {
        return { ok: false, aborted: false, problem: pluginActionProblems.noChapter(), status: 400 };
      }
      const lastFile = chapterFiles[chapterFiles.length - 1]!;
      const lastChapterPath = join(storyDir, lastFile);
      const rawDraft = await Deno.readTextFile(lastChapterPath);
      const stripRegex = pluginManager.getStripTagPatterns();
      const cleanDraft = stripRegex ? rawDraft.replace(stripRegex, "").trim() : rawDraft.trim();
      renderVariables.draft = cleanDraft;
    }

    // Build messages via the shared prompt-assembly pipeline. Pass the plugin
    // prompt content as `templateOverride` and the validated extras as
    // `extraVariables`. Plugin actions render with empty user input — the
    // prompt template is itself the user's intent.
    const buildResult = await buildPromptFromStory(
      series,
      story,
      storyDir,
      "",
      promptContent,
      renderVariables,
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
        problem: problemJson("Unprocessable Entity", 422, "Template rendering error", { ventoError: vErr }),
        status: 422,
      };
    }
    if (buildResult.messages.length === 0) {
      return {
        ok: false,
        aborted: false,
        problem: problemJson("Internal Server Error", 500, "Failed to generate prompt"),
        status: 500,
      };
    }

    let writeMode: WriteMode;
    if (mode === "append-to-existing-chapter") {
      writeMode = { kind: "append-to-existing-chapter", appendTag: validatedAppendTag!, pluginName };
    } else if (mode === "replace-last-chapter") {
      writeMode = { kind: "replace-last-chapter", pluginName };
    } else {
      writeMode = { kind: "discard" };
    }

    const result = await streamLlmAndPersist({
      messages: buildResult.messages,
      llmConfig,
      series,
      name: story,
      storyDir,
      rootDir: config.ROOT_DIR,
      signal,
      writeMode,
      onDelta,
      hookDispatcher,
      config,
    });

    const response: PluginRunPromptResponse = {
      content: writeMode.kind === "append-to-existing-chapter" || writeMode.kind === "replace-last-chapter"
        ? (result.chapterContentAfter ?? result.content)
        : result.content,
      usage: result.usage,
      chapterUpdated: writeMode.kind === "append-to-existing-chapter",
      chapterReplaced: writeMode.kind === "replace-last-chapter",
      appendedTag: validatedAppendTag,
    };
    return { ok: true, response };
  } catch (err) {
    if (err instanceof ChatAbortError) {
      return { ok: false, aborted: true };
    }
    if (err instanceof ChatError) {
      log.error("Plugin action chat error", {
        plugin: pluginName,
        code: err.code,
        httpStatus: err.httpStatus,
        detail: err.message,
        ventoError: err.ventoError,
      });
      // Map specific codes to plugin-action problems where the spec demands
      // a distinct error type.
      if (err.code === "no-chapter") {
        return { ok: false, aborted: false, problem: pluginActionProblems.noChapter(err.message), status: 400 };
      }
      return {
        ok: false,
        aborted: false,
        problem: problemJson("Bad Gateway", err.httpStatus, err.message),
        status: err.httpStatus,
      };
    }
    const detail = err instanceof Error ? err.message : String(err);
    log.error("Plugin action failed", { plugin: pluginName, error: detail });
    return {
      ok: false,
      aborted: false,
      problem: problemJson("Internal Server Error", 500, "Plugin action failed"),
      status: 500,
    };
  } finally {
    clearGenerationActive(series, story);
  }
}

/**
 * Register `POST /api/plugins/:pluginName/run-prompt` on the Hono app.
 */
export function registerPluginActionRoutes(
  app: Hono,
  deps: Pick<AppDeps, "config" | "safePath" | "hookDispatcher" | "pluginManager" | "buildPromptFromStory">,
): void {
  app.post("/api/plugins/:pluginName/run-prompt", async (c) => {
    const pluginName = c.req.param("pluginName") ?? "";
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch (err: unknown) {
      log.warn(`[POST /api/plugins/run-prompt] Malformed request body: ${err instanceof Error ? err.message : String(err)}`);
      return c.json(problemJson("Bad Request", 400, "Invalid JSON in request body"), 400);
    }
    const controller = new AbortController();
    // Tie the AbortController to the request's underlying connection.
    const reqSignal = c.req.raw.signal;
    if (reqSignal) {
      if (reqSignal.aborted) controller.abort();
      else reqSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }

    // Reject early when both `append` and `replace` are explicitly true so the
    // caller gets a clean RFC 9457 problem instead of an ambiguous mode
    // string. The body→mode translation below picks `append` if both are set,
    // but we want to refuse rather than silently prefer one.
    const wantAppend = body.append === true;
    const wantReplace = body.replace === true;
    if (wantAppend && wantReplace) {
      return c.json(pluginActionProblems.invalidReplaceCombo(), 400);
    }
    if (wantReplace && body.appendTag !== undefined) {
      return c.json(pluginActionProblems.invalidReplaceCombo("replace mode cannot be combined with appendTag"), 400);
    }
    const resolvedMode = wantAppend
      ? "append-to-existing-chapter"
      : wantReplace
      ? "replace-last-chapter"
      : "discard";

    const outcome = await runPluginActionWithDeps(
      {
        pluginName,
        series: body.series,
        story: body.name,
        promptPath: body.promptFile,
        mode: resolvedMode,
        appendTag: body.appendTag,
        replace: body.replace,
        extraVariables: body.extraVariables,
        signal: controller.signal,
      },
      deps,
    );

    if (outcome.ok) {
      return c.json(outcome.response, 200);
    }
    if (outcome.aborted) {
      return c.json(problemJson("Client Closed Request", 499, "Generation aborted by client"), 499 as 400);
    }
    return c.json(outcome.problem, outcome.status as 400);
  });
}
