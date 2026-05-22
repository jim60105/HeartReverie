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
 * @module templates-path
 *
 * Pure parsing and resolution helpers for the `templatePath` query string
 * accepted by the template-editor routes. Handles three shapes:
 *
 * - `system.md` — the engine system prompt
 * - `plugin:<pluginName>:<relative/file.md>`
 * - `lore:(global|series:<series>|story:<series>:<story>):<relative/file.md>`
 *
 * Segment validation rejects path-separator characters, NUL, `..` traversal,
 * leading `_`, and `lost+found`. The resolver maps a parsed path to an
 * absolute filesystem location plus the allowed base directory it must stay
 * contained in.
 */

import { join, resolve } from "@std/path";
import type { AppDeps } from "../types.ts";
import { isPathContained } from "../lib/path-safety.ts";
import type { TemplateKind } from "../lib/template-lint.ts";

const SEGMENT_RE = /^[^:\/\\\x00]+$/;

/**
 * Validates a single `<series>` or `<story>` segment inside a `lore:` or
 * `plugin:` templatePath. The templatePath syntax uses `:` as separator and
 * resolves to filesystem paths, so segments must not contain `:`, path
 * separators, NUL, or `..`. Other Unicode characters (e.g. CJK series names
 * like `艾爾瑞亞`) are allowed — they round-trip through `Deno.readDir` and
 * the existing playground tooling.
 */
export function isValidSegment(s: string): boolean {
  return SEGMENT_RE.test(s) && !s.includes("..") && !s.startsWith("_") && s !== "lost+found";
}

export interface ParsedTemplatePath {
  readonly kind: Exclude<TemplateKind, "prompt-message-body">;
  readonly pluginName?: string;
  readonly relativeFile?: string;
  readonly loreScope?: "global" | "series" | "story";
  readonly series?: string;
  readonly story?: string;
}

export interface ParseError {
  readonly status: number;
  readonly detail: string;
}

export interface ResolvedPath {
  readonly absolute: string;
  readonly allowedBase: string;
}

export function parseTemplatePath(
  templatePath: unknown,
): { ok: true; value: ParsedTemplatePath } | { ok: false; err: ParseError } {
  if (typeof templatePath !== "string" || templatePath.length === 0) {
    return { ok: false, err: { status: 400, detail: "templatePath required" } };
  }
  if (templatePath === "system.md") {
    return { ok: true, value: { kind: "system" } };
  }
  if (templatePath.startsWith("plugin:")) {
    const parts = templatePath.split(":");
    if (parts.length < 3) {
      return { ok: false, err: { status: 400, detail: "Invalid plugin templatePath" } };
    }
    const pluginName = parts[1];
    const relativeFile = parts.slice(2).join(":");
    if (!pluginName || !relativeFile) {
      return { ok: false, err: { status: 400, detail: "Invalid plugin templatePath" } };
    }
    if (!isValidSegment(pluginName)) {
      return { ok: false, err: { status: 400, detail: "Invalid plugin name segment" } };
    }
    return { ok: true, value: { kind: "plugin-fragment", pluginName, relativeFile } };
  }
  if (templatePath.startsWith("lore:")) {
    const parts = templatePath.split(":");
    if (parts.length < 3) {
      return { ok: false, err: { status: 400, detail: "Invalid lore templatePath" } };
    }
    const scope = parts[1];
    if (scope === "global") {
      const rel = parts.slice(2).join(":");
      if (!rel) return { ok: false, err: { status: 400, detail: "Missing lore relative path" } };
      return { ok: true, value: { kind: "lore", loreScope: "global", relativeFile: rel } };
    }
    if (scope === "series") {
      if (parts.length < 4) {
        return { ok: false, err: { status: 400, detail: "Invalid lore:series templatePath" } };
      }
      const series = parts[2]!;
      const rel = parts.slice(3).join(":");
      if (!isValidSegment(series)) {
        return { ok: false, err: { status: 400, detail: "Invalid series segment" } };
      }
      if (!rel) return { ok: false, err: { status: 400, detail: "Missing lore relative path" } };
      return { ok: true, value: { kind: "lore", loreScope: "series", series, relativeFile: rel } };
    }
    if (scope === "story") {
      if (parts.length < 5) {
        return { ok: false, err: { status: 400, detail: "Invalid lore:story templatePath" } };
      }
      const series = parts[2]!;
      const story = parts[3]!;
      const rel = parts.slice(4).join(":");
      if (!isValidSegment(series) || !isValidSegment(story)) {
        return { ok: false, err: { status: 400, detail: "Invalid series/story segment" } };
      }
      if (!rel) return { ok: false, err: { status: 400, detail: "Missing lore relative path" } };
      return { ok: true, value: { kind: "lore", loreScope: "story", series, story, relativeFile: rel } };
    }
    return { ok: false, err: { status: 400, detail: `Unknown lore scope: ${scope}` } };
  }
  return { ok: false, err: { status: 400, detail: "Unrecognised templatePath prefix" } };
}

/** Resolve a parsed templatePath to the absolute filesystem path + allowed base. */
export function resolveTemplatePath(
  parsed: ParsedTemplatePath,
  deps: AppDeps,
): { ok: true; value: ResolvedPath } | { ok: false; err: ParseError } {
  const { config, pluginManager } = deps;
  if (parsed.kind === "system") {
    const target = config.PROMPT_FILE;
    return { ok: true, value: { absolute: target, allowedBase: parentDir(target) } };
  }
  if (parsed.kind === "plugin-fragment") {
    if (!parsed.pluginName || !parsed.relativeFile) {
      return { ok: false, err: { status: 400, detail: "Missing plugin segments" } };
    }
    if (parsed.relativeFile.includes("..")) {
      return { ok: false, err: { status: 400, detail: "Plugin path contains .." } };
    }
    const dir = pluginManager.getPluginDir(parsed.pluginName);
    if (!dir) {
      return { ok: false, err: { status: 404, detail: `Unknown plugin: ${parsed.pluginName}` } };
    }
    const abs = resolve(dir, parsed.relativeFile);
    if (!isPathContained(dir, abs)) {
      return { ok: false, err: { status: 400, detail: "Plugin path escapes plugin directory" } };
    }
    return { ok: true, value: { absolute: abs, allowedBase: dir } };
  }
  // lore
  if (!parsed.relativeFile || parsed.relativeFile.includes("..")) {
    return { ok: false, err: { status: 400, detail: "Lore path contains .. or is empty" } };
  }
  let scopeRoot: string;
  if (parsed.loreScope === "global") {
    scopeRoot = join(config.PLAYGROUND_DIR, "_lore");
  } else if (parsed.loreScope === "series") {
    scopeRoot = join(config.PLAYGROUND_DIR, parsed.series!, "_lore");
  } else if (parsed.loreScope === "story") {
    scopeRoot = join(config.PLAYGROUND_DIR, parsed.series!, parsed.story!, "_lore");
  } else {
    return { ok: false, err: { status: 400, detail: "Unknown lore scope" } };
  }
  const abs = resolve(scopeRoot, parsed.relativeFile);
  if (!isPathContained(scopeRoot, abs)) {
    return { ok: false, err: { status: 400, detail: "Lore path escapes scope root" } };
  }
  return { ok: true, value: { absolute: abs, allowedBase: scopeRoot } };
}

export function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx > 0 ? p.slice(0, idx) : ".";
}
