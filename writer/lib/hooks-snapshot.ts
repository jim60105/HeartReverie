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
import { errorMessage } from "./errors.ts";

/**
 * Per-stage allowlist of context fields snapshotted into `HandlerEvent`
 * `ctxBeforeSnapshot` / `ctxAfterSnapshot`. Stages not listed here produce
 * empty `{}` snapshots — `handler-start`/`handler-end` events still fire so
 * subscribers can attribute timing and errors.
 *
 * The allowlist is intentionally narrow to keep `structuredClone` cost
 * bounded on the hot path and to avoid copying function-valued fields like
 * `logger` which `structuredClone` cannot handle.
 */
export const SNAPSHOT_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "prompt-assembly": Object.freeze(["previousContext", "rawChapters"]) as readonly string[],
  "pre-llm-fetch": Object.freeze(["messages", "model", "requestMetadata"]) as readonly string[],
});

/**
 * Capture references to the per-stage allowlisted fields without cloning.
 * Returns `{}` for stages with no allowlist. Used internally by the
 * dispatcher to record the BEFORE pointers prior to handler execution so
 * the AFTER snapshot can diff against the pre-handler state.
 */
export function captureRefs(
  stage: HookStage,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const fields = SNAPSHOT_ALLOWLIST[stage] ?? [];
  const refs: Record<string, unknown> = {};
  for (const field of fields) {
    refs[field] = context[field];
  }
  return refs;
}

/**
 * Deep-clone the per-stage allowlist subset of `context` into a plain
 * object snapshot. Stages not in the allowlist produce `{}`.
 *
 * Per-field try/catch: a prior handler may have stashed a non-cloneable
 * value (function, Proxy, WeakRef, etc.) on an allowlisted field. We
 * MUST NOT let one bad field break the dispatch — store a sentinel and
 * keep going so subscribers still see the rest of the snapshot.
 */
export function cloneAllowlistSnapshot(
  stage: HookStage,
  context: Record<string, unknown>,
): Record<string, unknown> {
  const fields = SNAPSHOT_ALLOWLIST[stage] ?? [];
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = context[field];
    try {
      out[field] = structuredClone(value);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      out[field] = { __snapshotError: msg };
    }
  }
  return out;
}
