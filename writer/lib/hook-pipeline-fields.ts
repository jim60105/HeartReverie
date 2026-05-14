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

/**
 * Pipeline-semantics field allowlist.
 *
 * Each entry names a `(stage, field)` pair where multiple plugins WRITING to
 * the same context field at the same hook stage is intended pipeline
 * semantics (each handler transforms the value produced by the previous).
 * The hook-inspector uses this list to suppress the C1 "multi-write"
 * conflict heuristic on these pairs.
 *
 * **Engine-owned, single source of truth.** Plugin manifests cannot extend
 * or override this list. The runtime-frozen Object.freeze() guard makes
 * mutation attempts fail loudly at the boundary.
 */
export interface PipelineFieldRef {
  readonly stage: string;
  readonly field: string;
}

export const PIPELINE_FIELDS: readonly PipelineFieldRef[] = Object.freeze([
  Object.freeze({ stage: "response-stream", field: "chunk" }),
  Object.freeze({ stage: "chat:send:before", field: "message" }),
  Object.freeze({ stage: "prompt-assembly", field: "previousContext" }),
]) as readonly PipelineFieldRef[];
