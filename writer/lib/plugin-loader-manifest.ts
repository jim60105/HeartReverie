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
 * Manifest file parsing and identity validation extracted from
 * {@link PluginLoader.scanDir}.
 *
 * Encapsulates the read → JSON parse → name field check → directory-name
 * match guard pipeline. Returns the parsed manifest or `null` if any step
 * rejects the file.
 *
 * Logging behavior matches the original inline implementation precisely:
 *
 * - Missing `plugin.json` (any `Deno.readTextFile` failure) → silent skip,
 *   no warn log. This is the common case for directories that are not
 *   plugins.
 * - All other rejections (invalid JSON, non-object payload, missing/invalid
 *   `name` field, or `name` not matching the directory name) emit a `warn`
 *   log identical to the one previously inlined in `scanDir`.
 */

import { errorMessage } from "./errors.ts";
import type { Logger } from "./logger.ts";
import type { PluginManifest } from "../types.ts";

/**
 * Read, parse and identity-validate a `plugin.json` file.
 *
 * @returns the parsed manifest, or `null` if the file is missing or fails
 * any validation step.
 */
export async function parseManifestFile(
  pluginDir: string,
  manifestPath: string,
  dirName: string,
  log: Logger,
): Promise<PluginManifest | null> {
  let raw: string;
  try {
    raw = await Deno.readTextFile(manifestPath);
  } catch {
    // No plugin.json — skip silently (common for non-plugin subdirectories).
    return null;
  }

  let manifest: PluginManifest;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      log.warn("Invalid plugin manifest: not an object", {
        path: manifestPath,
      });
      return null;
    }
    manifest = parsed as PluginManifest;
  } catch (err: unknown) {
    log.warn("Invalid JSON in manifest", {
      path: manifestPath,
      error: errorMessage(err),
    });
    return null;
  }

  if (!manifest.name || typeof manifest.name !== "string") {
    log.warn("Plugin missing required 'name' field — skipping", {
      dir: pluginDir,
    });
    return null;
  }

  // Require manifest name matches directory name to prevent impersonation.
  if (manifest.name !== dirName) {
    log.warn("Plugin manifest.name does not match directory — skipping", {
      dirName,
      manifestName: manifest.name,
    });
    return null;
  }

  return manifest;
}
