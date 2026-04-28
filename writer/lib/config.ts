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

import { join, resolve } from "@std/path";
import type { LlmConfig, ReasoningEffort } from "../types.ts";
import { REASONING_EFFORTS } from "../types.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("system");

const ROOT_DIR: string = resolve(import.meta.dirname!, "../..");
const PLAYGROUND_DIR: string =
  Deno.env.get("PLAYGROUND_DIR") || join(ROOT_DIR, "playground");
const READER_DIR: string = Deno.env.get("READER_DIR") || join(ROOT_DIR, "reader-dist");
const PLUGINS_DIR: string = join(ROOT_DIR, "plugins");
const PORT: number = parseInt(Deno.env.get("PORT") || "8443", 10);
const CERT_FILE: string | undefined = Deno.env.get("CERT_FILE");
const KEY_FILE: string | undefined = Deno.env.get("KEY_FILE");
const LLM_API_URL: string =
  Deno.env.get("LLM_API_URL") || "https://openrouter.ai/api/v1/chat/completions";
const LLM_MODEL: string =
  Deno.env.get("LLM_MODEL") || "deepseek/deepseek-v3.2";

/** Parse a numeric env var with a fallback default. */
function numEnv(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const TRUE_TOKENS = new Set(["true", "1", "yes", "on"]);
const FALSE_TOKENS = new Set(["false", "0", "no", "off"]);

/**
 * Parse a boolean env var.
 *
 * Rules: `"true" | "1" | "yes" | "on"` (case-insensitive, trimmed) → `true`;
 * `"false" | "0" | "no" | "off"` → `false`; empty/unset → `fallback`; any
 * other non-empty string → `fallback` AND emits a `warn`-level log naming
 * the variable and the unrecognized value.
 */
function boolEnv(key: string, fallback: boolean): boolean {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "") return fallback;
  if (TRUE_TOKENS.has(normalized)) return true;
  if (FALSE_TOKENS.has(normalized)) return false;
  log.warn("Unrecognized boolean env value; falling back to default", {
    variable: key,
    value: raw,
    fallback,
  });
  return fallback;
}

/**
 * Parse a `ReasoningEffort` env var validated against {@link REASONING_EFFORTS}
 * (case-sensitive). Invalid values fall back to `fallback` and emit a warn log.
 */
function effortEnv(key: string, fallback: ReasoningEffort): ReasoningEffort {
  const raw = Deno.env.get(key);
  if (raw === undefined || raw === "") return fallback;
  if ((REASONING_EFFORTS as readonly string[]).includes(raw)) {
    return raw as ReasoningEffort;
  }
  log.warn("Unrecognized reasoning effort env value; falling back to default", {
    variable: key,
    value: raw,
    fallback,
  });
  return fallback;
}

const LLM_TEMPERATURE: number = numEnv("LLM_TEMPERATURE", 0.1);
const LLM_FREQUENCY_PENALTY: number = numEnv("LLM_FREQUENCY_PENALTY", 0.13);
const LLM_PRESENCE_PENALTY: number = numEnv("LLM_PRESENCE_PENALTY", 0.52);
const LLM_TOP_K: number = numEnv("LLM_TOP_K", 10);
const LLM_TOP_P: number = numEnv("LLM_TOP_P", 0);
const LLM_REPETITION_PENALTY: number = numEnv("LLM_REPETITION_PENALTY", 1.2);
const LLM_MIN_P: number = numEnv("LLM_MIN_P", 0);
const LLM_TOP_A: number = numEnv("LLM_TOP_A", 1);
const LLM_REASONING_ENABLED: boolean = boolEnv("LLM_REASONING_ENABLED", true);
const LLM_REASONING_EFFORT: ReasoningEffort = effortEnv("LLM_REASONING_EFFORT", "high");
const LLM_REASONING_OMIT: boolean = boolEnv("LLM_REASONING_OMIT", false);
const BACKGROUND_IMAGE: string =
  Deno.env.get("BACKGROUND_IMAGE") || "/assets/heart.webp";
const LOG_LEVEL: string = Deno.env.get("LOG_LEVEL") || "info";
const LOG_FILE: string | undefined = Deno.env.get("LOG_FILE");
const LLM_LOG_FILE: string | undefined = Deno.env.get("LLM_LOG_FILE");
/**
 * Defaults for per-story LLM overrides, assembled from the flat `LLM_*` env
 * vars above. Per-story `_config.json` values are merged on top of this via
 * `Object.assign({}, llmDefaults, storyOverrides)` in `resolveStoryLlmConfig`.
 */
const llmDefaults: LlmConfig = {
  model: LLM_MODEL,
  temperature: LLM_TEMPERATURE,
  frequencyPenalty: LLM_FREQUENCY_PENALTY,
  presencePenalty: LLM_PRESENCE_PENALTY,
  topK: LLM_TOP_K,
  topP: LLM_TOP_P,
  repetitionPenalty: LLM_REPETITION_PENALTY,
  minP: LLM_MIN_P,
  topA: LLM_TOP_A,
  reasoningEnabled: LLM_REASONING_ENABLED,
  reasoningEffort: LLM_REASONING_EFFORT,
};

const PROMPT_FILE: string = (() => {
  const raw = Deno.env.get("PROMPT_FILE");
  if (!raw) return join(PLAYGROUND_DIR, "_prompts", "system.md");
  // Resolve relative paths against ROOT_DIR
  return raw.startsWith("/") ? raw : resolve(ROOT_DIR, raw);
})();

export {
  ROOT_DIR,
  PLAYGROUND_DIR,
  READER_DIR,
  PLUGINS_DIR,
  PORT,
  CERT_FILE,
  KEY_FILE,
  LLM_API_URL,
  LLM_MODEL,
  LLM_TEMPERATURE,
  LLM_FREQUENCY_PENALTY,
  LLM_PRESENCE_PENALTY,
  LLM_TOP_K,
  LLM_TOP_P,
  LLM_REPETITION_PENALTY,
  LLM_MIN_P,
  LLM_TOP_A,
  LLM_REASONING_ENABLED,
  LLM_REASONING_EFFORT,
  LLM_REASONING_OMIT,
  llmDefaults,
  BACKGROUND_IMAGE,
  PROMPT_FILE,
  LOG_LEVEL,
  LOG_FILE,
  LLM_LOG_FILE,
};
