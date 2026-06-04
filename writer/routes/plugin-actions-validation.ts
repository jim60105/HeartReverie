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

import { resolve } from "@std/path";
import { pluginActionProblems, problemJson } from "../lib/errors.ts";
import { isValidParam } from "../lib/middleware.ts";
import type { ProblemDetail } from "../types.ts";
import {
  APPEND_TAG_RE,
  RESERVED_VARIABLE_NAMES,
  type ValidationFailure,
} from "./plugin-actions-shared.ts";

/**
 * Validate `extraVariables` payload. Rejects non-objects, arrays, and any
 * value whose entries are not string/number/boolean. Returns the validated
 * record on success or a problem detail on failure.
 */
export function validateExtraVariables(
  raw: unknown,
): { ok: true; value: Record<string, unknown> } | {
  ok: false;
  problem: ProblemDetail;
} {
  if (raw === undefined || raw === null) return { ok: true, value: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: pluginActionProblems.invalidExtraVariables() };
  }
  const obj = raw as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (
      typeof value !== "string" && typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
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
export async function resolvePromptPath(
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
    return {
      ok: false,
      problem: pluginActionProblems.unknownPlugin(
        "Plugin directory missing on disk",
      ),
    };
  }
  try {
    realCandidate = await Deno.realPath(candidate);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return { ok: false, problem: pluginActionProblems.promptFileNotFound() };
    }
    return { ok: false, problem: pluginActionProblems.invalidPromptPath() };
  }
  const sep = realPluginDir.endsWith("/") ? "" : "/";
  if (
    realCandidate !== realPluginDir &&
    !realCandidate.startsWith(realPluginDir + sep)
  ) {
    return {
      ok: false,
      problem: pluginActionProblems.invalidPromptPath(
        "Prompt path escapes plugin directory",
      ),
    };
  }
  let stat: Deno.FileInfo;
  try {
    stat = await Deno.stat(realCandidate);
  } catch {
    return { ok: false, problem: pluginActionProblems.promptFileNotFound() };
  }
  if (!stat.isFile) {
    return {
      ok: false,
      problem: pluginActionProblems.promptFileNotFound(
        "Prompt path is not a regular file",
      ),
    };
  }
  return { ok: true, path: realCandidate };
}

/**
 * Validate `series`/`story` parameters and assert that the resolved story
 * directory exists on disk. Narrows the unknown inputs to validated strings
 * so callers can use them in downstream calls without further casts.
 */
export async function validateAndResolveStoryDir(
  series: unknown,
  story: unknown,
  safePath: (series: string, story: string) => string | null,
): Promise<
  | {
    ok: true;
    series: string;
    story: string;
    storyDir: string;
  }
  | ValidationFailure
> {
  if (
    typeof series !== "string" || typeof story !== "string" ||
    !isValidParam(series) || !isValidParam(story)
  ) {
    return {
      ok: false,
      problem: problemJson("Bad Request", 400, "Invalid series or story name"),
      status: 400,
    };
  }
  const storyDir = safePath(series, story);
  if (!storyDir) {
    return {
      ok: false,
      problem: problemJson("Bad Request", 400, "Invalid path"),
      status: 400,
    };
  }
  try {
    const stat = await Deno.stat(storyDir);
    if (!stat.isDirectory) {
      return {
        ok: false,
        problem: problemJson("Not Found", 404, "Story directory not found"),
        status: 404,
      };
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return {
        ok: false,
        problem: problemJson("Not Found", 404, "Story directory not found"),
        status: 404,
      };
    }
    throw err;
  }
  return { ok: true, series, story, storyDir };
}

/**
 * Validate the (`mode`, `appendTag`, `replace`) combination, returning the
 * validated `appendTag` (only meaningful for append mode). For non-append
 * modes the returned `appendTag` is `null`, matching prior behavior — note
 * that `appendTag` is intentionally ignored in `discard` mode to preserve
 * existing semantics.
 *
 * In append mode `appendTag` is OPTIONAL: a totally-omitted (`undefined`)
 * `appendTag` resolves to `null` (a tagless append — the model output is
 * persisted verbatim with no wrapper element). A string matching
 * `APPEND_TAG_RE` resolves to that tag. Any other value — including an
 * explicit `null`, a non-string value, or a string failing the regex
 * (such as `""`) — is rejected with `plugin-action:invalid-append-tag`.
 * Only total omission opts into tagless append; this is symmetric with
 * `replace` mode, which rejects any non-`undefined` `appendTag`.
 */
export function validateModeCombo(
  mode: unknown,
  appendTag: unknown,
  replace: unknown,
):
  | {
    ok: true;
    mode: "append-to-existing-chapter" | "replace-last-chapter" | "discard";
    appendTag: string | null;
  }
  | ValidationFailure {
  if (
    mode !== "append-to-existing-chapter" && mode !== "discard" &&
    mode !== "replace-last-chapter"
  ) {
    return {
      ok: false,
      problem: problemJson(
        "Bad Request",
        400,
        "mode must be 'append-to-existing-chapter', 'replace-last-chapter', or 'discard'",
      ),
      status: 400,
    };
  }
  if (mode === "replace-last-chapter" && replace === false) {
    return {
      ok: false,
      problem: pluginActionProblems.invalidReplaceCombo(),
      status: 400,
    };
  }
  if (mode === "replace-last-chapter" && appendTag !== undefined) {
    return {
      ok: false,
      problem: pluginActionProblems.invalidReplaceCombo(
        "replace mode cannot be combined with appendTag",
      ),
      status: 400,
    };
  }
  if (mode === "append-to-existing-chapter" && replace === true) {
    return {
      ok: false,
      problem: pluginActionProblems.invalidReplaceCombo(
        "append and replace are mutually exclusive",
      ),
      status: 400,
    };
  }
  if (mode === "append-to-existing-chapter") {
    // Tagless append: ONLY a totally-omitted (`undefined`) `appendTag` opts
    // into the no-wrapper append path. An explicit `null`, a non-string
    // value, or a string failing `APPEND_TAG_RE` (including the empty
    // string) is still rejected. This keeps the contract symmetric with
    // `replace` mode, which rejects any non-`undefined` `appendTag`.
    if (appendTag === undefined) {
      return { ok: true, mode, appendTag: null };
    }
    if (typeof appendTag !== "string" || !APPEND_TAG_RE.test(appendTag)) {
      return {
        ok: false,
        problem: pluginActionProblems.invalidAppendTag(),
        status: 400,
      };
    }
    return { ok: true, mode, appendTag };
  }
  return { ok: true, mode, appendTag: null };
}
