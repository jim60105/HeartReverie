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

import { errorMessage } from "./errors.ts";
import type { LogEntry } from "./logger-types.ts";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_BACKUPS = 5;
const encoder = new TextEncoder();

/**
 * Cross-sink throttled error reporter. Mirrors the original module-level
 * `lastLogWriteErrorTime` + `logWriteFailureCount` state. Shared between the
 * audit and LLM sinks so a write success on either sink resets the counter
 * and emits the recovery message (preserving prior behavior exactly).
 */
export class ErrorThrottler {
  #lastErrorTime = 0;
  #failureCount = 0;

  reportEnqueueError(err: unknown): void {
    const now = Date.now();
    if (now - this.#lastErrorTime > 60_000) {
      this.#lastErrorTime = now;
      console.error(`[logger] Write queue error: ${errorMessage(err)}`);
    }
  }

  reportWriteFailure(err: unknown): void {
    this.#failureCount++;
    if (this.#failureCount === 1) {
      console.error(`[logger] Log file write failed: ${errorMessage(err)}`);
    }
  }

  reportWriteSuccess(): void {
    if (this.#failureCount > 0) {
      console.info(
        `[logger] Log file write recovered after ${this.#failureCount} failed attempts`,
      );
      this.#failureCount = 0;
    }
  }

  reset(): void {
    this.#lastErrorTime = 0;
    this.#failureCount = 0;
  }
}

/**
 * Mutable state for a single log-file sink. Module consumers create one per
 * destination (e.g. audit + LLM) and pass it back to the helpers below.
 */
export interface FileSinkState {
  path: string | null;
  file: Deno.FsFile | null;
  currentSize: number;
  writeQueue: Promise<void>;
  /**
   * Called after a rotate-reopen failure. The LLM sink uses this to null its
   * `path` and warn; the audit sink leaves it undefined (silent retry).
   */
  onReopenFailure?: (path: string) => void;
}

export function createFileSinkState(
  onReopenFailure?: (path: string) => void,
): FileSinkState {
  return {
    path: null,
    file: null,
    currentSize: 0,
    writeQueue: Promise.resolve(),
    onReopenFailure,
  };
}

/**
 * Enqueue a structured entry for asynchronous file write. Errors raised by
 * the underlying write are routed through the shared throttler so log churn
 * cannot itself become a runaway log source.
 */
export function enqueueWrite(
  state: FileSinkState,
  entry: LogEntry,
  throttler: ErrorThrottler,
): void {
  state.writeQueue = state.writeQueue
    .then(() => writeEntry(state, entry, throttler))
    .catch((err: unknown) => throttler.reportEnqueueError(err));
}

async function rotate(state: FileSinkState): Promise<void> {
  if (!state.path || !state.file) return;

  state.file.close();
  state.file = null;

  // Shift existing backups: .MAX → delete, .(N-1) → .N, ..., current → .1
  const pathSnapshot = state.path;
  for (let i = MAX_BACKUPS; i >= 1; i--) {
    const src = i === 1 ? pathSnapshot : `${pathSnapshot}.${i - 1}`;
    const dest = `${pathSnapshot}.${i}`;
    try {
      if (i === MAX_BACKUPS) {
        await Deno.remove(dest).catch(() => {});
      }
      await Deno.rename(src, dest);
    } catch {
      // File may not exist — skip
    }
  }

  if (state.onReopenFailure) {
    try {
      state.file = await Deno.open(pathSnapshot, {
        write: true,
        create: true,
        append: true,
        mode: 0o664,
      });
      state.currentSize = 0;
    } catch {
      state.onReopenFailure(pathSnapshot);
      state.path = null;
    }
    return;
  }
  // No fallback configured: let any open failure propagate to the enqueue
  // catch so it surfaces via the shared throttler (preserving original
  // audit-sink behavior where rotate-reopen errors are routed through the
  // queue's error handler).
  state.file = await Deno.open(pathSnapshot, {
    write: true,
    create: true,
    append: true,
    mode: 0o664,
  });
  state.currentSize = 0;
}

async function writeEntry(
  state: FileSinkState,
  entry: LogEntry,
  throttler: ErrorThrottler,
): Promise<void> {
  if (!state.file || !state.path) return;

  const line = JSON.stringify(entry) + "\n";
  const bytes = encoder.encode(line);

  if (state.currentSize + bytes.length > MAX_FILE_SIZE) {
    await rotate(state);
  }
  if (!state.file) return; // rotate may have nulled it via onReopenFailure

  try {
    await state.file.write(bytes);
    state.currentSize += bytes.length;
    throttler.reportWriteSuccess();
  } catch (err: unknown) {
    throttler.reportWriteFailure(err);
  }
}

/**
 * Synchronously close the sink's file handle and zero its state. Used by the
 * test reset helper. Does NOT wait for in-flight queued writes.
 */
export function resetFileSink(state: FileSinkState): void {
  if (state.file) {
    state.file.close();
    state.file = null;
  }
  state.path = null;
  state.currentSize = 0;
  state.writeQueue = Promise.resolve();
}

/**
 * Asynchronously drain the queue and close the file handle. Used during
 * graceful shutdown to avoid losing buffered log entries.
 */
export async function closeFileSink(state: FileSinkState): Promise<void> {
  await state.writeQueue;
  if (state.file) {
    state.file.close();
    state.file = null;
  }
}
