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
 * Validator for the optional `frontendStyles` declarations on a plugin
 * manifest. Split out of `plugin-validators.ts` for SRP.
 */

import { isAbsolute, resolve, SEPARATOR } from "@std/path";
import { errorMessage } from "./errors.ts";
import { isPathContained } from "./path-safety.ts";
import { createLogger } from "./logger.ts";
import type { PluginManifest } from "../types.ts";

const log = createLogger("plugin");

/** Rejection reason for a raw frontendStyles string entry (sync rules only). */
type SyntaxRejection =
  | "not-string"
  | "not-css"
  | "absolute"
  | "traversal"
  | "invalid-chars";

/**
 * Apply the synchronous syntax rules to a raw entry. Returns either a
 * normalized relative path (forward-slash, no leading "./") or a tagged
 * rejection reason for the caller to log.
 */
function checkStyleEntrySyntax(
  entry: unknown,
): { ok: true; normalized: string } | { ok: false; reason: SyntaxRejection } {
  if (typeof entry !== "string" || entry.length === 0) {
    return { ok: false, reason: "not-string" };
  }
  if (!entry.toLowerCase().endsWith(".css")) {
    return { ok: false, reason: "not-css" };
  }
  if (isAbsolute(entry)) {
    return { ok: false, reason: "absolute" };
  }
  // Reject path traversal segments
  const segments = entry.split(/[\\/]/);
  if (segments.some((s) => s === "..")) {
    return { ok: false, reason: "traversal" };
  }
  // Reject backslashes and URL-hostile characters
  if (/[\\#?%]/.test(entry)) {
    return { ok: false, reason: "invalid-chars" };
  }
  // Normalize: strip leading "./" (possibly repeated)
  let normalized = entry;
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  return { ok: true, normalized };
}

/**
 * Verify that the resolved style path exists on disk, is a regular file,
 * and that its real path (after symlink resolution) remains contained
 * within the plugin directory. Returns `true` when the entry is acceptable.
 */
async function verifyStyleFileOnDisk(
  resolvedPath: string,
  pluginDir: string,
  manifestName: string,
  entry: string,
): Promise<boolean> {
  try {
    const stat = await Deno.stat(resolvedPath);
    if (!stat.isFile) {
      log.warn("Plugin frontendStyles entry is not a file — skipping", {
        plugin: manifestName,
        entry,
      });
      return false;
    }
    // Symlink-safe: verify real path is still within plugin directory.
    const realFile = await Deno.realPath(resolvedPath);
    const realPluginDir = await Deno.realPath(pluginDir);
    if (
      !realFile.startsWith(realPluginDir + SEPARATOR) &&
      realFile !== realPluginDir
    ) {
      log.warn(
        "Plugin frontendStyles entry resolves outside plugin directory — skipping",
        { plugin: manifestName, entry },
      );
      return false;
    }
    return true;
  } catch (err: unknown) {
    log.warn("Plugin frontendStyles entry not found", {
      plugin: manifestName,
      entry,
      error: errorMessage(err),
    });
    return false;
  }
}

/**
 * Validate, normalize, and deduplicate a plugin's frontendStyles entries.
 * Returns an array of normalized relative paths (forward-slash, no leading
 * "./") whose resolved targets exist on disk and are contained within the
 * plugin directory. Dedupe is by **resolved absolute path** (preserves
 * behavior across syntactic variants like leading `./`).
 */
export async function validateFrontendStyles(
  manifest: PluginManifest,
  pluginDir: string,
): Promise<string[]> {
  const raw: unknown = manifest.frontendStyles;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    log.warn("Plugin has non-array frontendStyles — ignoring", {
      plugin: manifest.name,
    });
    return [];
  }

  const seenResolved = new Set<string>();
  const validated: string[] = [];

  for (const entry of raw) {
    const syntax = checkStyleEntrySyntax(entry);
    if (!syntax.ok) {
      logSyntaxRejection(syntax.reason, manifest.name, entry);
      continue;
    }
    const { normalized } = syntax;
    const resolved = resolve(pluginDir, normalized);
    if (!isPathContained(pluginDir, resolved)) {
      log.warn(
        "Plugin frontendStyles entry escapes plugin directory — skipping",
        { plugin: manifest.name, entry },
      );
      continue;
    }
    // Deduplicate by resolved path BEFORE the I/O check (matches original).
    if (seenResolved.has(resolved)) continue;
    seenResolved.add(resolved);

    const ok = await verifyStyleFileOnDisk(resolved, pluginDir, manifest.name, entry as string);
    if (!ok) continue;

    validated.push(normalized);
  }

  return validated;
}

/** Map a tagged syntax rejection to its corresponding warn-level log message. */
function logSyntaxRejection(
  reason: SyntaxRejection,
  manifestName: string,
  entry: unknown,
): void {
  switch (reason) {
    case "not-string":
      log.warn(
        "Plugin has invalid frontendStyles entry (must be non-empty string) — skipping",
        { plugin: manifestName },
      );
      return;
    case "not-css":
      log.warn(
        "Plugin frontendStyles entry does not end with .css — skipping",
        { plugin: manifestName, entry },
      );
      return;
    case "absolute":
      log.warn("Plugin frontendStyles entry is an absolute path — skipping", {
        plugin: manifestName,
        entry,
      });
      return;
    case "traversal":
      log.warn("Plugin frontendStyles entry contains '..' — skipping", {
        plugin: manifestName,
        entry,
      });
      return;
    case "invalid-chars":
      log.warn(
        "Plugin frontendStyles entry contains invalid characters — skipping",
        { plugin: manifestName, entry },
      );
      return;
  }
}
