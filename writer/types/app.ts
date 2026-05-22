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

import type { Context, Next } from "@hono/hono";
import type { PluginManager } from "../lib/plugin-manager.ts";
import type { HookDispatcher } from "../lib/hooks.ts";
import type { ReasoningEffort } from "./llm.ts";
import type {
  BuildContinuePromptFn,
  BuildPromptFn,
  TemplateEngine,
} from "./story.ts";

/** Application configuration resolved from environment variables and defaults. */
export interface AppConfig {
  readonly ROOT_DIR: string;
  readonly PLAYGROUND_DIR: string;
  readonly READER_DIR: string;
  readonly PLUGINS_DIR: string;
  readonly PORT: number;
  readonly LLM_API_URL: string;
  readonly LLM_MODEL: string;
  readonly LLM_TEMPERATURE: number;
  readonly LLM_FREQUENCY_PENALTY: number;
  readonly LLM_PRESENCE_PENALTY: number;
  readonly LLM_TOP_K: number;
  readonly LLM_TOP_P: number;
  readonly LLM_REPETITION_PENALTY: number;
  readonly LLM_MIN_P: number;
  readonly LLM_TOP_A: number;
  readonly LLM_REASONING_ENABLED: boolean;
  readonly LLM_REASONING_EFFORT: ReasoningEffort;
  readonly LLM_REASONING_OMIT: boolean;
  readonly LLM_MAX_COMPLETION_TOKENS: number | null;
  readonly THEME_DIR: string;
  readonly PROMPT_FILE: string;
  /** Defaults for per-story LLM overrides, assembled from the flat `LLM_*` env vars. */
  readonly llmDefaults: import("./llm.ts").LlmConfig;
}

/** Function that resolves path segments under the playground directory, returning null on traversal. */
export type SafePathFn = (...segments: string[]) => string | null;

/** Hono middleware handler signature. */
export type MiddlewareHandler = (
  c: Context,
  next: Next,
) => Promise<Response | void>;

/** Top-level dependency bag passed to createApp and route registrars. */
export interface AppDeps {
  readonly config: AppConfig;
  readonly safePath: SafePathFn;
  readonly pluginManager: PluginManager;
  readonly hookDispatcher: HookDispatcher;
  readonly buildPromptFromStory: BuildPromptFn;
  readonly buildContinuePromptFromStory: BuildContinuePromptFn;
  readonly verifyPassphrase: MiddlewareHandler;
  /**
   * Vento template engine handle (created by `createTemplateEngine`). Exposed
   * on `AppDeps` so the templates route can call `ventoEnv.compile()` /
   * `runString()` directly without re-instantiating the engine. Always
   * populated by `server.ts`; tests that mock `AppDeps` can leave it `null`
   * when they don't exercise the templates route.
   */
  readonly templateEngine: TemplateEngine | null;
}

/** RFC 9457 Problem Details response shape. */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  [key: string]: unknown;
}
