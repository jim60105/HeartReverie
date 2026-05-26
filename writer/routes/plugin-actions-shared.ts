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

import type { PluginRunPromptResponse, ProblemDetail } from "../types.ts";

/**
 * Reserved Vento variable names that plugin-action callers MUST NOT override
 * via `extraVariables`. The check is case-sensitive and applied AFTER the
 * scalar-type validation. `lore_*` is a wildcard prefix and is handled
 * separately at the validation site.
 */
export const RESERVED_VARIABLE_NAMES: readonly string[] = [
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

export const APPEND_TAG_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,30}$/;

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
 * Shared shape for pre-flight validation helpers: either succeed with a
 * narrowed payload, or fail with an RFC-9457 problem detail + HTTP status.
 */
export type ValidationFailure = {
  readonly ok: false;
  readonly problem: ProblemDetail;
  readonly status: number;
};
