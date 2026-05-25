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
import type { Logger } from "../lib/logger.ts";
import type { AppConfig } from "./app.ts";
import type { TokenUsageRecord } from "./llm.ts";
import type { HandlerEvent, HookHandler, HookStage } from "./hooks.ts";

/** Plugin manifest schema parsed from plugin.json. */
export interface PluginManifest {
  readonly name: string;
  /**
   * Short zh-TW human-readable label used by the reader UI for navigation
   * (sidebar tabs, drawer menus, settings page heading, save notifications).
   *
   * Distinct from `name` (the kebab-case slug — URL parameter, settings
   * storage key, and impersonation guard against the plugin directory name)
   * and from `description` (a paragraph-shaped blurb).
   *
   * REQUIRED: the manifest loader rejects plugins whose manifest omits this
   * field, supplies a non-string value, or supplies a value whose `.trim()`
   * is empty. Surfaced verbatim via `GET /api/plugins`.
   */
  readonly displayName: string;
  readonly version?: string;
  readonly description?: string;
  readonly type?: string;
  readonly tags?: readonly string[];
  readonly backendModule?: string;
  readonly frontendModule?: string;
  readonly promptStripTags?: readonly string[];
  readonly displayStripTags?: readonly string[];
  readonly promptFragments?: readonly PromptFragment[];
  readonly parameters?: readonly PluginParameter[];
  /**
   * Array of relative paths (from the plugin directory) to CSS files to inject
   * into the frontend via `<link rel="stylesheet">`. Each entry must end with
   * `.css`, must not be an absolute path, and must not contain `..` segments
   * (no path traversal). Paths are resolved and contained within the plugin's
   * directory at load time.
   */
  readonly frontendStyles?: readonly string[];
  /**
   * Array of relative paths (from the plugin directory) to additional `.js`
   * files that the declared `frontendModule` statically imports as siblings
   * (e.g. helper modules split out of a larger `frontend.js`). Each entry
   * MUST:
   * - end with `.js`,
   * - be relative (no leading `/`),
   * - contain no `..` segments,
   * - not contain `\`, `#`, `?`, `%`.
   *
   * Acts as an explicit allowlist for the
   * `GET /plugins/:plugin/:path{.+\\.js}` static-asset route: only the
   * declared `frontendModule` and these declared sibling files are served.
   * Files present on disk under the plugin directory but not declared here
   * are 404'd by the HTTP route — they are still importable by the backend
   * loader (`backendModule`) via `file://` because that path does not go
   * through the HTTP route. This is a defense-in-depth gate against a
   * future regression in any write endpoint dropping attacker-controlled
   * `.js` bytes into a plugin directory and them being served as code.
   */
  readonly frontendImports?: readonly string[];
  /**
   * Optional declarative action-button contributions surfaced in the reader's
   * `PluginActionBar`. Each entry must validate against
   * `ActionButtonDescriptor`; invalid entries are dropped individually with a
   * logged warning. Defaults to `[]` when absent.
   */
  readonly actionButtons?: readonly ActionButtonDescriptor[];
  /**
   * Optional JSON Schema (draft-07 compatible) describing plugin settings.
   * Must be an object schema (`type: "object"`) with a `properties` record.
   * Used by the settings I/O helpers to validate payloads and extract defaults.
   */
  readonly settingsSchema?: Record<string, unknown>;
  /**
   * Optional declarative hook subscriptions used by the engine to cross-check
   * which stages the plugin actually registers at load time. Each entry names
   * a stage (backend or frontend) plus optional metadata (`reads`, `writes`,
   * `priority`, `note`) consumed by the hook-inspector developer tool.
   *
   * Constraints (enforced by `PluginManager.#validateManifest`):
   * - `stage === "strip-tags"` is REJECTED. Use `promptStripTags` /
   *   `displayStripTags` instead.
   * - Duplicate `stage` values within the same array are REJECTED. The
   *   engine guarantees at most one handler per `(plugin, stage)` pair.
   * - Unknown stages (not in `KNOWN_BACKEND_STAGES ∪ KNOWN_FRONTEND_STAGES`)
   *   log a warn but do NOT block load; they are excluded from the strict
   *   declare-vs-register cross-check.
   *
   * When the field is absent, the plugin is treated as "undeclared" and the
   * strict cross-check is skipped (legacy behaviour). An empty array (`[]`)
   * is treated as "explicitly declares no hooks" and the cross-check still
   * runs (any register call from such a plugin is a load error).
   */
  readonly hooks?: readonly PluginHookDeclaration[];
}

/**
 * Declarative hook subscription entry in `PluginManifest.hooks`.
 *
 * @property stage     Hook stage name. Backend and frontend stages share the
 *                     same namespace; the engine validates each entry against
 *                     `KNOWN_BACKEND_STAGES ∪ KNOWN_FRONTEND_STAGES`.
 * @property priority  Optional render order (lower runs first). Engine
 *                     defaults to 100 when the plugin's `register()` call
 *                     omits the priority.
 * @property reads     Optional list of context fields the handler reads.
 *                     Used by the hook-inspector C2 stale-read heuristic.
 * @property writes    Optional list of context fields the handler writes.
 *                     Used by the hook-inspector C1 multi-write heuristic.
 * @property note      Optional free-form note (≤ 200 chars) surfaced in the
 *                     inspector UI.
 */
export interface PluginHookDeclaration {
  readonly stage: string;
  readonly priority?: number;
  readonly reads?: readonly string[];
  readonly writes?: readonly string[];
  readonly note?: string;
  readonly parallel?: boolean;
  readonly readOnly?: boolean;
  readonly concurrency?: number;
  readonly dependsOn?: readonly string[];
}

/**
 * Visibility predicate enum for `ActionButtonDescriptor`. Values:
 *
 * - `"last-chapter-backend"` (default): show only when the user is viewing
 *   the last chapter of a story.
 * - `"backend-only"`: show on every chapter (any chapter).
 *
 * The enum is kept at two values for forward-compat; additional visibility
 * predicates may be added as a non-breaking extension once their semantics
 * are pinned down.
 */
export type ActionButtonVisibility = "last-chapter-backend" | "backend-only";

/**
 * Plugin-declared action button surfaced in the reader UI. Resolved defaults
 * (`priority`, `visibleWhen`) are filled in by the manifest loader before
 * serialisation through `GET /api/plugins`.
 */
export interface ActionButtonDescriptor {
  /** Kebab-case identifier matching `^[a-z0-9-]+$`, unique within a plugin. */
  readonly id: string;
  /** Display label, 1..40 characters after trim. */
  readonly label: string;
  /** Optional emoji or short symbol prefix. */
  readonly icon?: string;
  /** Optional tooltip, ≤200 characters. */
  readonly tooltip?: string;
  /** Render order; lower first. Default 100. */
  readonly priority: number;
  /** Visibility predicate. Default `"last-chapter-backend"`. */
  readonly visibleWhen: ActionButtonVisibility;
}

/** Request body for `POST /api/plugins/:pluginName/run-prompt`. */
export interface PluginRunPromptRequest {
  readonly series: string;
  readonly name: string;
  readonly promptFile: string;
  readonly append?: boolean;
  readonly appendTag?: string;
  readonly replace?: boolean;
  readonly extraVariables?: Record<string, string | number | boolean>;
}

/** Response body for `POST /api/plugins/:pluginName/run-prompt`. */
export interface PluginRunPromptResponse {
  readonly content: string;
  readonly usage: TokenUsageRecord | null;
  readonly chapterUpdated: boolean;
  readonly chapterReplaced: boolean;
  readonly appendedTag: string | null;
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

/**
 * Context passed to plugin `getDynamicVariables()`.
 *
 * All fields are derived from data already materialized by
 * `buildPromptFromStory()` in `writer/lib/story.ts`. The object is a plain
 * serializable bag: no functions, file handles, streams, or `AppConfig`.
 */
export interface DynamicVariableContext {
  /** Series identifier for the current request. */
  readonly series: string;
  /** Story identifier for the current request. */
  readonly name: string;
  /** Absolute path to the story directory on disk. */
  readonly storyDir: string;
  /**
   * Raw user message that triggered this prompt build. May be a large
   * arbitrary string — plugin authors should scrub before persisting.
   * Empty string when the caller omitted a message (e.g., preview route).
   */
  readonly userInput: string;
  /**
   * 1-based number of the chapter that a subsequent write would target,
   * computed by `resolveTargetChapterNumber()`: reuse the trailing empty
   * chapter file if any, otherwise `max(existing) + 1`, otherwise `1`.
   */
  readonly chapterNumber: number;
  /**
   * Unstripped content of the chapter immediately preceding `chapterNumber`.
   * Empty string when no prior chapter exists. Can be large (tens of KB);
   * plugins that forward it into other variables should summarize first.
   */
  readonly previousContent: string;
  /** True when every existing chapter on disk is blank. */
  readonly isFirstRound: boolean;
  /** Total number of `NNN.md` chapter files on disk, including empty trailing files. */
  readonly chapterCount: number;
  /** Return this plugin's resolved settings (schema defaults merged with saved values). */
  readonly getSettings?: () => Promise<Record<string, unknown>>;
}

/** Options for the register() overload accepting an options object. */
export interface RegisterOptions {
  readonly priority?: number;
  readonly parallel?: boolean;
  readonly readOnly?: boolean;
  readonly dependsOn?: readonly string[];
}

/** Hook registration interface exposed to plugins (subset of HookDispatcher). */
export interface PluginHooks {
  register(stage: HookStage, handler: HookHandler, priorityOrOptions?: number | RegisterOptions): void;
  /**
   * Subscribe to per-handler `handler-start` events from the backend
   * `HookDispatcher`. Returns an unsubscribe closure that is idempotent.
   * Optional so plugin code can feature-detect with
   * `typeof ctx.hooks.onHandlerStart === "function"`.
   */
  onHandlerStart?(cb: (event: HandlerEvent & { kind: "handler-start" }) => void): () => void;
  /**
   * Subscribe to per-handler `handler-end` events from the backend
   * `HookDispatcher`. Returns an unsubscribe closure that is idempotent.
   */
  onHandlerEnd?(cb: (event: HandlerEvent & { kind: "handler-end" }) => void): () => void;
}

/** Context passed to plugin register() function. */
export interface PluginRegisterContext {
  readonly hooks: PluginHooks;
  readonly logger: Logger;
  readonly getSettings?: () => Promise<Record<string, unknown>>;
}

/** Interface for dynamically imported plugin backend modules. */
export interface PluginModule {
  register?: (context: PluginRegisterContext) => void | Promise<void>;
  default?: (context: PluginRegisterContext) => void | Promise<void>;
  getDynamicVariables?: (
    context: DynamicVariableContext,
  ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  registerRoutes?: (context: PluginRouteContext) => void | Promise<void>;
}

/** Context passed to plugin registerRoutes() function for mounting HTTP routes. */
export interface PluginRouteContext {
  readonly app: Hono;
  readonly basePath: string;
  readonly logger: Logger;
  readonly getSettings: () => Promise<Record<string, unknown>>;
  readonly saveSettings: (settings: Record<string, unknown>) => Promise<void>;
  readonly config: AppConfig;
}
