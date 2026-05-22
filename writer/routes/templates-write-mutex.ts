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
 * @module templates-write-mutex
 *
 * Per-target promise-chain mutex used by the template `PUT` route to
 * serialize concurrent writes to the same resolved absolute filesystem
 * path. Keyed by the resolved absolute final path so that distinct files
 * proceed in parallel while same-file writes queue.
 *
 * The map is module-scoped and persists for the process lifetime; entries
 * delete themselves once their queue drains, so long-lived processes do
 * not accumulate stale keys.
 */

/** Per-target write mutex keyed on resolved absolute final path. */
const WRITE_MUTEX = new Map<string, Promise<void>>();

export async function withWriteMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = WRITE_MUTEX.get(key) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((r) => { release = r; });
  const chained = prev.then(() => next);
  WRITE_MUTEX.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release!();
    if (WRITE_MUTEX.get(key) === chained) {
      WRITE_MUTEX.delete(key);
    }
  }
}
