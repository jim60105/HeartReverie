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

import type { HookStage } from "../types.ts";

/**
 * Stages where `parallel:true` is permitted in plugin manifests. Other
 * stages reject parallel registration with a warning during validation.
 */
export const PARALLEL_ALLOWED: ReadonlySet<string> = new Set([
  "prompt-assembly",
  "post-response",
  "response-stream",
  "pre-llm-fetch",
]);

/**
 * Backend hook stages registered via `HookDispatcher.register()`.
 * Note: `strip-tags` is intentionally NOT in this set — it is a declarative
 * manifest field (`promptStripTags` / `displayStripTags`), not a runtime hook.
 */
export const KNOWN_BACKEND_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "prompt-assembly",
  "pre-llm-fetch",
  "response-stream",
  "pre-write",
  "post-response",
]);

/**
 * Valid hook stages accepted by manifest validation and dispatcher
 * registration. Superset of `KNOWN_BACKEND_STAGES` that adds the
 * declarative `strip-tags` field.
 */
export const VALID_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "prompt-assembly",
  "pre-llm-fetch",
  "response-stream",
  "pre-write",
  "post-response",
  "strip-tags",
]);
