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
import { basename, dirname, join, SEPARATOR } from "@std/path";

/**
 * Lexical containment check: returns `true` when `resolved` is `base` or a
 * descendant of `base`. Both paths SHOULD be absolute and already normalised
 * (e.g. via `resolve()` or `Deno.realPath()`); this helper does NOT itself
 * normalise or hit the filesystem. Callers MUST realpath both ends if they
 * need symlink-safe containment.
 */
export function isPathContained(base: string, resolved: string): boolean {
  return resolved === base || resolved.startsWith(base + SEPARATOR);
}

/**
 * Atomic write with `.bak` rotation and symlink rejection.
 *
 * Steps:
 *   1. `base = await Deno.realPath(allowedBase)` (must exist).
 *   2. `parent = await Deno.realPath(dirname(target))` — assert containment.
 *   3. If `target` exists, `lstat()` and refuse symlinks.
 *   4. Copy existing target to `<target>.bak`, rotating to
 *      `<target>.bak.<timestamp>` when `.bak` already exists.
 *   5. Write to `<parent>/.<basename>.tmp.<uuid>`.
 *   6. `Deno.rename` to the realpath-resolved final location.
 *
 * Concurrent writes against the same `target` SHOULD be serialised by callers
 * (e.g. via an in-process `Map<string, Promise<void>>` mutex keyed on the
 * realpath of the absolute target) to keep `.bak` rotation deterministic.
 */
export interface AtomicWriteResult {
  readonly ok: true;
  readonly path: string;
  readonly backupPath: string | null;
}

export class PathSafetyError extends Error {
  readonly code:
    | "symlink-rejected"
    | "containment-violation"
    | "parent-missing";
  constructor(
    code:
      | "symlink-rejected"
      | "containment-violation"
      | "parent-missing",
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "PathSafetyError";
  }
}

export async function atomicWriteWithBackup(
  target: string,
  content: string,
  allowedBase: string,
): Promise<AtomicWriteResult> {
  let base: string;
  try {
    base = await Deno.realPath(allowedBase);
  } catch (err: unknown) {
    throw new PathSafetyError(
      "parent-missing",
      `allowedBase does not exist: ${allowedBase} (${
        errorMessage(err)
      })`,
    );
  }

  const parentDir = dirname(target);
  let parent: string;
  try {
    parent = await Deno.realPath(parentDir);
  } catch (err: unknown) {
    throw new PathSafetyError(
      "parent-missing",
      `target parent does not exist: ${parentDir} (${
        errorMessage(err)
      })`,
    );
  }

  if (!isPathContained(base, parent)) {
    throw new PathSafetyError(
      "containment-violation",
      `target parent ${parent} escapes allowed base ${base}`,
    );
  }

  const finalPath = join(parent, basename(target));

  // Reject symlinks at the target itself (do not follow)
  try {
    const targetStat = await Deno.lstat(finalPath);
    if (targetStat.isSymlink) {
      throw new PathSafetyError(
        "symlink-rejected",
        `refusing to write through symlink: ${finalPath}`,
      );
    }
  } catch (err: unknown) {
    if (!(err instanceof Deno.errors.NotFound)) {
      if (err instanceof PathSafetyError) throw err;
      throw err;
    }
    // Target does not yet exist — fall through; no backup needed.
  }

  // Backup existing target with rotation. Policy: `.bak` always holds the
  // most recent previous content. If `.bak` already exists, rotate it to
  // `.bak.<timestamp>` first, then copy the current `finalPath` to `.bak`.
  let backupPath: string | null = null;
  try {
    await Deno.lstat(finalPath); // throws NotFound for brand-new file
    const primaryBak = `${finalPath}.bak`;
    try {
      await Deno.lstat(primaryBak);
      // Already exists — rotate old `.bak` to timestamped name.
      await Deno.rename(primaryBak, `${finalPath}.bak.${Date.now()}`);
    } catch (err: unknown) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
    }
    await Deno.copyFile(finalPath, primaryBak);
    backupPath = primaryBak;
  } catch (err: unknown) {
    if (!(err instanceof Deno.errors.NotFound)) {
      // Genuine failure during backup — surface it.
      throw err;
    }
    // Target was new — no backup created.
  }

  const tmpName = `.${basename(target)}.tmp.${crypto.randomUUID()}`;
  const tmpPath = join(parent, tmpName);
  let renamed = false;
  try {
    await Deno.writeTextFile(tmpPath, content, { mode: 0o664 });
    await Deno.rename(tmpPath, finalPath);
    renamed = true;
  } finally {
    if (!renamed) {
      try {
        await Deno.remove(tmpPath);
      } catch {
        // temp may not exist — best-effort cleanup, ignore.
      }
    }
  }

  return { ok: true, path: finalPath, backupPath };
}
