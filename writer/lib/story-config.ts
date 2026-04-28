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

import { dirname, join } from "@std/path";
import type { LlmConfig, StoryLlmConfigOverrides } from "../types.ts";
import { REASONING_EFFORTS } from "../types.ts";

/** Filename of the per-story LLM override file, relative to the story dir. */
export const STORY_CONFIG_FILENAME = "_config.json";

/** Thrown when input cannot be coerced into `Partial<LlmConfig>`. */
export class StoryConfigValidationError extends Error {
  override readonly name = "StoryConfigValidationError";
}

/** Thrown when the story directory does not exist on disk. */
export class StoryConfigNotFoundError extends Error {
  override readonly name = "StoryConfigNotFoundError";
}

/** Numeric fields permitted in a story override (all of `LlmConfig` except `model`). */
const NUMERIC_FIELDS: readonly (keyof LlmConfig)[] = [
  "temperature",
  "frequencyPenalty",
  "presencePenalty",
  "topK",
  "topP",
  "repetitionPenalty",
  "minP",
  "topA",
];

/**
 * Whitelist-only parser: strips unknown keys, drops `null`/`undefined`
 * values (treated as "use default"), validates types. Throws on wrong types
 * or a non-object input.
 */
export function validateStoryLlmConfig(input: unknown): StoryLlmConfigOverrides {
  if (input === null || input === undefined) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw new StoryConfigValidationError("Config must be a JSON object");
  }
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  if (Object.prototype.hasOwnProperty.call(src, "model")) {
    const v = src.model;
    if (v !== null && v !== undefined) {
      if (typeof v !== "string" || v.length === 0) {
        throw new StoryConfigValidationError("Field 'model' must be a non-empty string");
      }
      out.model = v;
    }
  }

  for (const key of NUMERIC_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(src, key)) continue;
    const v = src[key];
    if (v === null || v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new StoryConfigValidationError(`Field '${key}' must be a finite number`);
    }
    out[key] = v;
  }

  if (Object.prototype.hasOwnProperty.call(src, "reasoningEnabled")) {
    const v = src.reasoningEnabled;
    if (v !== null && v !== undefined) {
      if (typeof v !== "boolean") {
        throw new StoryConfigValidationError(
          "Field 'reasoningEnabled' must be a boolean",
        );
      }
      out.reasoningEnabled = v;
    }
  }

  if (Object.prototype.hasOwnProperty.call(src, "reasoningEffort")) {
    const v = src.reasoningEffort;
    if (v !== null && v !== undefined) {
      if (
        typeof v !== "string" ||
        !(REASONING_EFFORTS as readonly string[]).includes(v)
      ) {
        throw new StoryConfigValidationError(
          "Field 'reasoningEffort' must be one of: none, minimal, low, medium, high, xhigh",
        );
      }
      out.reasoningEffort = v;
    }
  }

  return out as StoryLlmConfigOverrides;
}

/**
 * Read and validate the per-story `_config.json`. Returns `{}` when the file
 * is absent. Re-throws on invalid JSON or validation errors.
 */
export async function readStoryLlmConfig(
  storyDir: string,
): Promise<StoryLlmConfigOverrides> {
  const filePath = join(storyDir, STORY_CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await Deno.readTextFile(filePath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return {};
    throw err;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    throw new StoryConfigValidationError(
      `Invalid JSON in ${STORY_CONFIG_FILENAME}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return validateStoryLlmConfig(parsed);
}

/**
 * Validate `input`, drop empty/nullish values, and persist to
 * `<storyDir>/_config.json` atomically (tmp file + rename) with mode `0o664`.
 * The story directory MUST exist; throws `StoryConfigNotFoundError` otherwise.
 * Writing an empty object clears all overrides.
 */
export async function writeStoryLlmConfig(
  storyDir: string,
  input: unknown,
): Promise<StoryLlmConfigOverrides> {
  const overrides = validateStoryLlmConfig(input);

  try {
    const stat = await Deno.stat(storyDir);
    if (!stat.isDirectory) {
      throw new StoryConfigNotFoundError(`Story path is not a directory: ${storyDir}`);
    }
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      throw new StoryConfigNotFoundError(`Story directory not found: ${storyDir}`);
    }
    throw err;
  }

  const filePath = join(storyDir, STORY_CONFIG_FILENAME);
  const tmpPath = join(dirname(filePath), `.${STORY_CONFIG_FILENAME}.${crypto.randomUUID()}.tmp`);
  const body = `${JSON.stringify(overrides, null, 2)}\n`;
  await Deno.writeTextFile(tmpPath, body, { mode: 0o664 });
  try {
    await Deno.rename(tmpPath, filePath);
  } catch (err) {
    try {
      await Deno.remove(tmpPath);
    } catch { /* ignore */ }
    throw err;
  }
  // rename preserves tmp permissions; ensure final mode explicitly
  try {
    await Deno.chmod(filePath, 0o664);
  } catch { /* not supported on all platforms */ }
  return overrides;
}

/**
 * Merge env defaults with the story's persisted overrides.
 * `Object.assign({}, defaults, overrides)` — only explicitly present fields
 * from `_config.json` override the defaults.
 */
export async function resolveStoryLlmConfig(
  storyDir: string,
  defaults: LlmConfig,
): Promise<LlmConfig> {
  const overrides = await readStoryLlmConfig(storyDir);
  return Object.assign({}, defaults, overrides);
}
