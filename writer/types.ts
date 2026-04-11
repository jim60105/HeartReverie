// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import type { Context, Next } from "@hono/hono";
import type { PluginManager } from "./lib/plugin-manager.ts";
import type { HookDispatcher } from "./lib/hooks.ts";

/** Application configuration resolved from environment variables and defaults. */
export interface AppConfig {
  readonly ROOT_DIR: string;
  readonly PLAYGROUND_DIR: string;
  readonly READER_DIR: string;
  readonly PLUGINS_DIR: string;
  readonly PORT: number;
  readonly CERT_FILE: string | undefined;
  readonly KEY_FILE: string | undefined;
  readonly OPENROUTER_API_URL: string;
  readonly OPENROUTER_MODEL: string;
}

/** Function that resolves path segments under the playground directory, returning null on traversal. */
export type SafePathFn = (...segments: string[]) => string | null;

/** Hono middleware handler signature. */
export type MiddlewareHandler = (c: Context, next: Next) => Promise<Response | void>;

/** Function signature for buildPromptFromStory. */
export type BuildPromptFn = (
  series: string,
  name: string,
  storyDir: string,
  message: string,
  template?: string
) => Promise<BuildPromptResult>;

/** Top-level dependency bag passed to createApp and route registrars. */
export interface AppDeps {
  readonly config: AppConfig;
  readonly safePath: SafePathFn;
  readonly pluginManager: PluginManager;
  readonly hookDispatcher: HookDispatcher;
  readonly buildPromptFromStory: BuildPromptFn;
  readonly verifyPassphrase: MiddlewareHandler;
}

/** Plugin manifest schema parsed from plugin.json. */
export interface PluginManifest {
  readonly name: string;
  readonly version?: string;
  readonly description?: string;
  readonly type?: string;
  readonly tags?: readonly string[];
  readonly backendModule?: string;
  readonly frontendModule?: string;
  readonly stripTags?: readonly string[];
  readonly promptFragments?: readonly PromptFragment[];
  readonly parameters?: readonly PluginParameter[];
}

/** A prompt fragment declaration in a plugin manifest. */
export interface PromptFragment {
  readonly file: string;
  readonly variable?: string;
  readonly priority?: number;
}

/** A parameter declaration in a plugin manifest. */
export interface PluginParameter {
  readonly name: string;
  readonly type?: string;
  readonly description?: string;
}

/** Interface for dynamically imported plugin backend modules. */
export interface PluginModule {
  register?: (hookDispatcher: HookDispatcher) => void | Promise<void>;
  default?: (hookDispatcher: HookDispatcher) => void | Promise<void>;
}

/** Valid hook lifecycle stages. */
export type HookStage = "prompt-assembly" | "response-stream" | "post-response" | "strip-tags";

/** Hook handler function signature. */
export type HookHandler = (context: Record<string, unknown>) => Promise<void>;

/** Return type of createStoryEngine(). */
export interface StoryEngine {
  stripPromptTags: (content: string) => string;
  loadStatus: (series: string, name: string) => Promise<string>;
  buildPromptFromStory: BuildPromptFn;
}

/** Return type of createTemplateEngine(). */
export interface TemplateEngine {
  renderSystemPrompt: (
    series: string,
    options?: RenderOptions
  ) => Promise<RenderResult>;
  validateTemplate: (templateStr: string) => string[];
  ventoEnv: import("ventojs/core/environment").Environment;
}

/** Options for renderSystemPrompt. */
export interface RenderOptions {
  previousContext?: string[];
  userInput?: string;
  status?: string;
  isFirstRound?: boolean;
  templateOverride?: string;
}

/** Discriminated union for renderSystemPrompt return. */
export type RenderResult =
  | { content: string; error: null }
  | { content: null; error: VentoError };

/** Result of buildPromptFromStory. */
export interface BuildPromptResult {
  prompt: string | null;
  previousContext: string[];
  statusContent: string;
  isFirstRound: boolean;
  ventoError: VentoError | null;
  chapterFiles: string[];
  chapters: ChapterEntry[];
}

/** A chapter entry with number and content. */
export interface ChapterEntry {
  number: number;
  content: string;
}

/** Vento template error details. */
export interface VentoError {
  type?: string;
  stage?: string;
  message: string;
  source?: string;
  line?: number | null;
  suggestion?: string | null;
  title?: string;
  detail?: string;
  expressions?: string[];
}

/** RFC 9457 Problem Details response shape. */
export interface ProblemDetail {
  type: string;
  title: string;
  status: number;
  detail: string;
  [key: string]: unknown;
}

/** OpenRouter SSE stream chunk shape. */
export interface OpenRouterStreamChunk {
  choices?: ReadonlyArray<{
    delta?: {
      content?: string;
    };
  }>;
}
