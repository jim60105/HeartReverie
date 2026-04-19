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

import { join } from "@std/path";
import { createLogger } from "./logger.ts";
import type { TokenUsageRecord, UsageTotals } from "../types.ts";

/** Filename used for per-story token usage persistence. */
export const USAGE_FILENAME = "_usage.json";
/** Filename used to back up a malformed `_usage.json` before resetting it. */
export const USAGE_BACKUP_FILENAME = "_usage.json.bak";

const log = createLogger("file");

/** Per-story async locks; keyed by absolute story directory path. */
const locks: Map<string, Promise<void>> = new Map();

/**
 * Run `fn` serialised against any other in-flight operation for the same
 * `storyDir`. The lock is internal to this module and survives only in-process.
 */
async function withStoryLock<T>(storyDir: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(storyDir) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next);
  locks.set(storyDir, chained);
  try {
    await prev;
    return await fn();
  } finally {
    release();
    // Only clear the slot if no later waiter has replaced it.
    if (locks.get(storyDir) === chained) {
      locks.delete(storyDir);
    }
  }
}

/**
 * Narrow an unknown value to a well-formed `TokenUsageRecord`.
 * Returns null when any required field is missing or mistyped.
 */
function coerceRecord(raw: unknown): TokenUsageRecord | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (
    typeof r.chapter !== "number" ||
    typeof r.promptTokens !== "number" ||
    typeof r.completionTokens !== "number" ||
    typeof r.totalTokens !== "number" ||
    typeof r.model !== "string" ||
    typeof r.timestamp !== "string"
  ) {
    return null;
  }
  return {
    chapter: r.chapter,
    promptTokens: r.promptTokens,
    completionTokens: r.completionTokens,
    totalTokens: r.totalTokens,
    model: r.model,
    timestamp: r.timestamp,
  };
}

/**
 * Read `_usage.json` from the given story directory.
 *
 * Returns `[]` when the file is absent or malformed. On parse failure a
 * warning is logged but no backup is written — that is the writer's job.
 *
 * @param storyDir Absolute path to the story directory.
 */
export async function readUsage(storyDir: string): Promise<TokenUsageRecord[]> {
  const filePath = join(storyDir, USAGE_FILENAME);
  let raw: string;
  try {
    raw = await Deno.readTextFile(filePath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Failed to read _usage.json", { op: "read", path: filePath, error: msg });
    return [];
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Malformed _usage.json", { op: "read", path: filePath, error: msg });
    return [];
  }
  if (!Array.isArray(parsed)) {
    log.warn("_usage.json is not an array", { op: "read", path: filePath });
    return [];
  }
  const records: TokenUsageRecord[] = [];
  for (const entry of parsed) {
    const rec = coerceRecord(entry);
    if (rec) records.push(rec);
  }
  return records;
}

/**
 * Read the raw file, backing up and resetting to `[]` if malformed.
 * Used only by `appendUsage`. Returns a fresh (mutable) array.
 */
async function readForAppend(storyDir: string): Promise<TokenUsageRecord[]> {
  const filePath = join(storyDir, USAGE_FILENAME);
  let raw: string;
  try {
    raw = await Deno.readTextFile(filePath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return [];
    throw err;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) throw new Error("not an array");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const backupPath = join(storyDir, USAGE_BACKUP_FILENAME);
    try {
      await Deno.rename(filePath, backupPath);
      log.warn("Backed up malformed _usage.json", { op: "backup", path: backupPath, error: msg });
    } catch (backupErr) {
      const bmsg = backupErr instanceof Error ? backupErr.message : String(backupErr);
      log.warn("Failed to back up malformed _usage.json", { op: "backup", path: backupPath, error: bmsg });
    }
    return [];
  }
  const records: TokenUsageRecord[] = [];
  for (const entry of parsed as unknown[]) {
    const rec = coerceRecord(entry);
    if (rec) records.push(rec);
  }
  return records;
}

/**
 * Compute running totals across a list of usage records. Pure function.
 */
export function computeTotals(records: readonly TokenUsageRecord[]): UsageTotals {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const r of records) {
    promptTokens += r.promptTokens;
    completionTokens += r.completionTokens;
    totalTokens += r.totalTokens;
  }
  return { promptTokens, completionTokens, totalTokens, count: records.length };
}

/**
 * Build a `TokenUsageRecord` from raw inputs, stamping `timestamp` now.
 */
export function buildRecord(input: {
  readonly chapter: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly model: string;
}): TokenUsageRecord {
  return {
    chapter: input.chapter,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    totalTokens: input.totalTokens,
    model: input.model,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Append `record` to `<storyDir>/_usage.json`, creating the file when absent.
 *
 * Appends are serialised per story via an in-process async lock. On parse
 * failure the existing file is renamed to `_usage.json.bak` and a fresh
 * array containing just `record` is written.
 *
 * Swallows all errors (logs warn) — token accounting must never break chat.
 */
export async function appendUsage(storyDir: string, record: TokenUsageRecord): Promise<void> {
  await withStoryLock(storyDir, async () => {
    try {
      const records = await readForAppend(storyDir);
      records.push(record);
      const filePath = join(storyDir, USAGE_FILENAME);
      const body = `${JSON.stringify(records, null, 2)}\n`;
      const tmpPath = join(storyDir, `.${USAGE_FILENAME}.${crypto.randomUUID()}.tmp`);
      await Deno.writeTextFile(tmpPath, body, { mode: 0o664 });
      await Deno.rename(tmpPath, filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Failed to append usage record", { op: "write", storyDir, error: msg });
    }
  });
}

/**
 * Remove usage records with `chapter > keepThroughChapter`. No-op when the
 * file is absent. Writes an empty array when every record is pruned.
 * Swallows all errors.
 */
export async function pruneUsage(storyDir: string, keepThroughChapter: number): Promise<void> {
  await withStoryLock(storyDir, async () => {
    try {
      const records = await readForAppend(storyDir);
      const kept = records.filter((r) => r.chapter <= keepThroughChapter);
      if (kept.length === records.length) return;
      const filePath = join(storyDir, USAGE_FILENAME);
      const body = `${JSON.stringify(kept, null, 2)}\n`;
      const tmpPath = join(storyDir, `.${USAGE_FILENAME}.${crypto.randomUUID()}.tmp`);
      await Deno.writeTextFile(tmpPath, body, { mode: 0o664 });
      await Deno.rename(tmpPath, filePath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Failed to prune usage records", { op: "write", storyDir, error: msg });
    }
  });
}

/**
 * Copy usage records from `sourceDir` into `destDir`, filtering to
 * `chapter <= keepThroughChapter`. Used when branching a story at an edit
 * point. Swallows all errors.
 */
export async function copyUsage(
  sourceDir: string,
  destDir: string,
  keepThroughChapter: number,
): Promise<void> {
  try {
    const records = await readUsage(sourceDir);
    const kept = records.filter((r) => r.chapter <= keepThroughChapter);
    const filePath = join(destDir, USAGE_FILENAME);
    const body = `${JSON.stringify(kept, null, 2)}\n`;
    await withStoryLock(destDir, async () => {
      const tmpPath = join(destDir, `.${USAGE_FILENAME}.${crypto.randomUUID()}.tmp`);
      await Deno.writeTextFile(tmpPath, body, { mode: 0o664 });
      await Deno.rename(tmpPath, filePath);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("Failed to copy usage records", { op: "write", sourceDir, destDir, error: msg });
  }
}
