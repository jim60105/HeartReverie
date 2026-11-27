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
import type { LlmApiMode, LlmConfig, ReasoningEffort } from "../types.ts";
import { LLM_API_MODES, REASONING_EFFORTS } from "../types.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";

const log = createLogger("system");

const ROOT_DIR: string = resolve(import.meta.dirname!, "../..");
const PLAYGROUND_DIR: string = Deno.env.get("PLAYGROUND_DIR") || join(ROOT_DIR, "playground");
const READER_DIR: string = Deno.env.get("READER_DIR") || join(ROOT_DIR, "reader-dist");
const PLUGINS_DIR: string = join(ROOT_DIR, "plugins");
const PORT: number = parseInt(Deno.env.get("PORT") || "8080", 10);
/** OpenAI-SDK-style base URL used when `LLM_API_BASE_URL` is unset or empty. */
const DEFAULT_LLM_API_BASE_URL = "https://openrouter.ai/api/v1";
const LLM_API_BASE_URL: string = (Deno.env.get("LLM_API_BASE_URL") ?? "").trim() ||
  DEFAULT_LLM_API_BASE_URL;
const LLM_CONFIG_ERRORS: readonly string[] = collectLlmEndpointErrors(
  Deno.env.get("LLM_API_URL"),
  LLM_API_BASE_URL,
);
const LLM_MODEL: string = Deno.env.get("LLM_MODEL") || "deepseek/deepseek-v4-pro";

/** Parse a numeric env var with a fallback default. */
function numEnv(key: string, fallback: number): number {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Parse a positive-integer-or-null env var. Empty/unset/whitespace → `null`
 * silently. Accepts only `^[1-9]\d*$` (no leading zeros, no whitespace, no
 * scientific notation, no decimals) AND must be a `Number.isSafeInteger`.
 * Anything else (e.g., `"4096abc"`, `"1e3"`, `"01024"`, `"0"`, `"-5"`,
 * `"1.5"`) falls back to `null` and emits a `warn`-level log naming the
 * variable and the unrecognized value. Used for fields where "not set" is
 * a meaningful state (i.e. "no application-level limit; let the upstream
 * provider decide").
 */
function posIntOrNullEnv(key: string): number | null {
  const raw = Deno.env.get(key);
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^[1-9]\d*$/.test(trimmed)) {
    log.warn("Unrecognized positive-integer env value; falling back to null (no limit)", {
      variable: key,
      value: raw,
    });
    return null;
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) {
    log.warn(
      "Positive-integer env value exceeds safe integer range; falling back to null (no limit)",
      {
        variable: key,
        value: raw,
      },
    );
    return null;
  }
  return parsed;
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

/**
 * Parse an {@link LlmApiMode} env var validated against {@link LLM_API_MODES}
 * (exact, case-sensitive, trimmed). An unset or empty value returns `fallback`
 * silently; any other unrecognized value falls back with a warn log naming the
 * variable and value.
 */
function apiModeEnv(key: string, fallback: LlmApiMode): LlmApiMode {
  const raw = Deno.env.get(key);
  if (raw === undefined) return fallback;
  const trimmed = raw.trim();
  if (trimmed === "") return fallback;
  if ((LLM_API_MODES as readonly string[]).includes(trimmed)) {
    return trimmed as LlmApiMode;
  }
  log.warn("Unrecognized LLM_API_MODE value; falling back to default", {
    variable: key,
    value: raw,
  });
  return fallback;
}

/**
 * Validate an OpenAI-SDK-style LLM base URL. Returns an error message, or
 * `null` when `value` is a valid base URL.
 *
 * Rejected shapes: anything `new URL()` cannot parse, non-http(s) protocols,
 * query strings and fragments, and values whose path already names one of the
 * transport endpoints (`/responses`, `/chat/completions`). Echoes are redacted
 * to `protocol//host/pathname`, so credentials embedded in a rejected URL are
 * never logged.
 */
export function validateLlmApiBaseUrl(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "LLM_API_BASE_URL must be an absolute http(s) URL";
  }
  const redacted = `${url.protocol}//${url.host}${url.pathname}`;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return `LLM_API_BASE_URL must be an absolute http(s) URL (got "${redacted}")`;
  }
  if (value.includes("?") || value.includes("#")) {
    return `LLM_API_BASE_URL must not contain a query string or fragment (got "${redacted}")`;
  }
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/chat/completions") || path.endsWith("/responses")) {
    return `LLM_API_BASE_URL must be a base URL without /chat/completions or /responses ` +
      `(got "${redacted}"); for example https://openrouter.ai/api/v1`;
  }
  return null;
}

/**
 * Collect startup errors for the LLM endpoint env vars. The removed legacy
 * `LLM_API_URL` error comes first, then at most one base-URL error.
 */
export function collectLlmEndpointErrors(
  legacyUrl: string | undefined,
  baseUrl: string,
): readonly string[] {
  const errors: string[] = [];
  if (legacyUrl?.trim()) {
    errors.push(
      "LLM_API_URL is no longer supported; set LLM_API_BASE_URL to the API base URL instead " +
        "(for example LLM_API_BASE_URL=https://openrouter.ai/api/v1, without /chat/completions " +
        "or /responses)",
    );
  }
  const baseError = validateLlmApiBaseUrl(baseUrl);
  if (baseError !== null) errors.push(baseError);
  return errors;
}

/**
 * Log every collected LLM endpoint error via `log.error`.
 * Returns true when there was at least one error.
 */
export function reportLlmConfigErrors(errors: readonly string[], log: Logger): boolean {
  for (const error of errors) log.error(error);
  return errors.length > 0;
}

const LLM_API_MODE: LlmApiMode = apiModeEnv("LLM_API_MODE", "auto");

const LLM_TEMPERATURE: number = numEnv("LLM_TEMPERATURE", 0.1);
const LLM_FREQUENCY_PENALTY: number = numEnv("LLM_FREQUENCY_PENALTY", 0.13);
const LLM_PRESENCE_PENALTY: number = numEnv("LLM_PRESENCE_PENALTY", 0.52);
const LLM_TOP_K: number = numEnv("LLM_TOP_K", 10);
const LLM_TOP_P: number = numEnv("LLM_TOP_P", 0);
const LLM_REPETITION_PENALTY: number = numEnv("LLM_REPETITION_PENALTY", 1.2);
const LLM_MIN_P: number = numEnv("LLM_MIN_P", 0);
const LLM_TOP_A: number = numEnv("LLM_TOP_A", 1);
const LLM_REASONING_ENABLED: boolean = boolEnv("LLM_REASONING_ENABLED", true);
const LLM_REASONING_EFFORT: ReasoningEffort = effortEnv("LLM_REASONING_EFFORT", "xhigh");
const LLM_REASONING_OMIT: boolean = boolEnv("LLM_REASONING_OMIT", false);
const LLM_MAX_COMPLETION_TOKENS: number | null = posIntOrNullEnv("LLM_MAX_COMPLETION_TOKENS");
const THEME_DIR: string = (() => {
  const raw = Deno.env.get("THEME_DIR");
  if (!raw) return "./themes/";
  return raw;
})();
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
  maxCompletionTokens: LLM_MAX_COMPLETION_TOKENS,
};

const PROMPT_FILE: string = (() => {
  const raw = Deno.env.get("PROMPT_FILE");
  if (!raw) return join(PLAYGROUND_DIR, "_prompts", "system.md");
  // Resolve relative paths against ROOT_DIR
  return raw.startsWith("/") ? raw : resolve(ROOT_DIR, raw);
})();

export {
  DEFAULT_LLM_API_BASE_URL,
  LLM_API_BASE_URL,
  LLM_API_MODE,
  LLM_CONFIG_ERRORS,
  LLM_FREQUENCY_PENALTY,
  LLM_LOG_FILE,
  LLM_MAX_COMPLETION_TOKENS,
  LLM_MIN_P,
  LLM_MODEL,
  LLM_PRESENCE_PENALTY,
  LLM_REASONING_EFFORT,
  LLM_REASONING_ENABLED,
  LLM_REASONING_OMIT,
  LLM_REPETITION_PENALTY,
  LLM_TEMPERATURE,
  LLM_TOP_A,
  LLM_TOP_K,
  LLM_TOP_P,
  llmDefaults,
  LOG_FILE,
  LOG_LEVEL,
  PLAYGROUND_DIR,
  PLUGINS_DIR,
  PORT,
  PROMPT_FILE,
  READER_DIR,
  ROOT_DIR,
  THEME_DIR,
};
