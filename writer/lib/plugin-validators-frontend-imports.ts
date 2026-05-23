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
 * Validator for the optional `frontendImports` declarations on a plugin
 * manifest. Mirrors `plugin-validators-frontend-styles.ts` but for `.js`
 * sibling helper modules. The result feeds the per-plugin allowlist used by
 * `GET /plugins/:plugin/:path{.+\.js}` to decide whether a requested asset
 * may be served as executable code.
 */

import { isAbsolute, resolve, SEPARATOR } from "@std/path";
import { errorMessage } from "./errors.ts";
import { isPathContained } from "./path-safety.ts";
import { createLogger } from "./logger.ts";
import type { PluginManifest } from "../types.ts";

const log = createLogger("plugin");

type SyntaxRejection =
  | "not-string"
  | "not-js"
  | "absolute"
  | "traversal"
  | "invalid-chars";

function checkImportEntrySyntax(
  entry: unknown,
): { ok: true; normalized: string } | { ok: false; reason: SyntaxRejection } {
  if (typeof entry !== "string" || entry.length === 0) {
    return { ok: false, reason: "not-string" };
  }
  if (!entry.toLowerCase().endsWith(".js")) {
    return { ok: false, reason: "not-js" };
  }
  if (isAbsolute(entry)) {
    return { ok: false, reason: "absolute" };
  }
  const segments = entry.split(/[\\/]/);
  if (segments.some((s) => s === "..")) {
    return { ok: false, reason: "traversal" };
  }
  if (/[\\#?%]/.test(entry)) {
    return { ok: false, reason: "invalid-chars" };
  }
  let normalized = entry;
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  // Reject any segment that starts with '.' (dotfiles, traversal artefacts).
  if (normalized.split("/").some((s) => s.startsWith("."))) {
    return { ok: false, reason: "invalid-chars" };
  }
  return { ok: true, normalized };
}

async function verifyImportFileOnDisk(
  resolvedPath: string,
  pluginDir: string,
  manifestName: string,
  entry: string,
): Promise<boolean> {
  try {
    const stat = await Deno.stat(resolvedPath);
    if (!stat.isFile) {
      log.warn("Plugin frontendImports entry is not a file — skipping", {
        plugin: manifestName,
        entry,
      });
      return false;
    }
    const realFile = await Deno.realPath(resolvedPath);
    const realPluginDir = await Deno.realPath(pluginDir);
    if (
      !realFile.startsWith(realPluginDir + SEPARATOR) &&
      realFile !== realPluginDir
    ) {
      log.warn(
        "Plugin frontendImports entry resolves outside plugin directory — skipping",
        { plugin: manifestName, entry },
      );
      return false;
    }
    return true;
  } catch (err: unknown) {
    log.warn("Plugin frontendImports entry not found", {
      plugin: manifestName,
      entry,
      error: errorMessage(err),
    });
    return false;
  }
}

/**
 * Validate, normalize, and deduplicate a plugin's frontendImports entries.
 * Returns an array of normalized relative paths (forward-slash, no leading
 * "./") whose resolved targets exist on disk and are contained within the
 * plugin directory.
 */
export async function validateFrontendImports(
  manifest: PluginManifest,
  pluginDir: string,
): Promise<string[]> {
  const raw: unknown = manifest.frontendImports;
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    log.warn("Plugin has non-array frontendImports — ignoring", {
      plugin: manifest.name,
    });
    return [];
  }

  const seenResolved = new Set<string>();
  const validated: string[] = [];

  for (const entry of raw) {
    const syntax = checkImportEntrySyntax(entry);
    if (!syntax.ok) {
      logSyntaxRejection(syntax.reason, manifest.name, entry);
      continue;
    }
    const { normalized } = syntax;
    const resolved = resolve(pluginDir, normalized);
    if (!isPathContained(pluginDir, resolved)) {
      log.warn(
        "Plugin frontendImports entry escapes plugin directory — skipping",
        { plugin: manifest.name, entry },
      );
      continue;
    }
    if (seenResolved.has(resolved)) continue;
    seenResolved.add(resolved);

    const ok = await verifyImportFileOnDisk(
      resolved,
      pluginDir,
      manifest.name,
      entry as string,
    );
    if (!ok) continue;

    validated.push(normalized);
  }

  return validated;
}

function logSyntaxRejection(
  reason: SyntaxRejection,
  manifestName: string,
  entry: unknown,
): void {
  switch (reason) {
    case "not-string":
      log.warn(
        "Plugin has invalid frontendImports entry (must be non-empty string) — skipping",
        { plugin: manifestName },
      );
      return;
    case "not-js":
      log.warn(
        "Plugin frontendImports entry does not end with .js — skipping",
        { plugin: manifestName, entry },
      );
      return;
    case "absolute":
      log.warn("Plugin frontendImports entry is an absolute path — skipping", {
        plugin: manifestName,
        entry,
      });
      return;
    case "traversal":
      log.warn("Plugin frontendImports entry contains '..' — skipping", {
        plugin: manifestName,
        entry,
      });
      return;
    case "invalid-chars":
      log.warn(
        "Plugin frontendImports entry contains invalid characters or dotfile segment — skipping",
        { plugin: manifestName, entry },
      );
      return;
  }
}
