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

import { createLogger } from "./logger.ts";

const log = createLogger("generation");

/**
 * In-process registry tracking active LLM generations per story.
 *
 * Used to guard destructive operations (chapter edit, rewind, branch) against
 * running generations. The registry is refcounted so overlapping generations
 * against the same story remain "active" until every caller has cleared.
 */

const activeGenerations: Map<string, number> = new Map();

function keyOf(series: string, name: string): string {
  return `${series}/${name}`;
}

/**
 * Mark the `<series>/<name>` story as having an active generation. Every call
 * increments the refcount and MUST be paired with a matching
 * `clearGenerationActive`, typically in a `finally` block.
 */
export function markGenerationActive(series: string, name: string): void {
  const key = keyOf(series, name);
  const prev = activeGenerations.get(key) ?? 0;
  activeGenerations.set(key, prev + 1);
}

/**
 * Decrement the refcount for `<series>/<name>`. The entry is removed from the
 * map when the refcount reaches zero. Safe to call when the key is absent
 * (no-op).
 */
export function clearGenerationActive(series: string, name: string): void {
  const key = keyOf(series, name);
  const prev = activeGenerations.get(key) ?? 0;
  if (prev <= 1) {
    activeGenerations.delete(key);
    return;
  }
  activeGenerations.set(key, prev - 1);
}

/**
 * Atomically check that no generation is in flight for `<series>/<name>` and,
 * if so, mark it active in a single synchronous step. Returns `true` when the
 * caller acquired the lock (and MUST eventually pair with
 * `clearGenerationActive`), `false` when the story already had at least one
 * active generation. This is the canonical helper to use in route handlers
 * that need to refuse concurrent generations rather than refcount them.
 *
 * Because JavaScript runs synchronous code in a single thread, the read +
 * write below cannot be interleaved with another `tryMarkGenerationActive`
 * call. Two simultaneous callers therefore see distinct outcomes (first
 * wins, second returns false) without any explicit locking primitive.
 */
export function tryMarkGenerationActive(series: string, name: string): boolean {
  const key = keyOf(series, name);
  const prev = activeGenerations.get(key) ?? 0;
  if (prev > 0) {
    log.debug(`[generation-registry] Lock rejected for ${key} (already active: ${prev})`);
    return false;
  }
  activeGenerations.set(key, 1);
  return true;
}

/**
 * Return `true` when at least one generation is currently active against
 * `<series>/<name>`.
 */
export function isGenerationActive(series: string, name: string): boolean {
  const count = activeGenerations.get(keyOf(series, name)) ?? 0;
  return count > 0;
}
