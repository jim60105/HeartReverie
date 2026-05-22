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
 * Validator for the optional `hooks` declarations on a plugin manifest.
 * Split out of `plugin-validators.ts` for SRP.
 */

import { PARALLEL_ALLOWED } from "./hooks.ts";
import { createLogger, type Logger } from "./logger.ts";
import type { PluginHookDeclaration, PluginManifest } from "../types.ts";

const log = createLogger("plugin");

/**
 * Validate one hook entry's schema. Returns `false` on any rejection
 * (caller short-circuits the whole plugin). `seen` is mutated to track
 * duplicate-stage detection across iterations.
 */
function validateHookEntrySchema(
  entry: unknown,
  seen: Set<string>,
  pluginLog: Logger,
): boolean {
  if (typeof entry !== "object" || entry === null) {
    pluginLog.error("Plugin manifest 'hooks' entry must be an object — skipping plugin");
    return false;
  }
  const decl = entry as PluginHookDeclaration;
  if (typeof decl.stage !== "string" || decl.stage.length === 0) {
    pluginLog.error(
      "Plugin manifest 'hooks' entry missing 'stage' string — skipping plugin",
    );
    return false;
  }
  if (decl.stage === "strip-tags") {
    pluginLog.error(
      "Plugin manifest 'hooks' may not declare 'strip-tags' — use promptStripTags / displayStripTags instead — skipping plugin",
      { stage: decl.stage },
    );
    return false;
  }
  if (seen.has(decl.stage)) {
    pluginLog.error(
      "Plugin manifest 'hooks' has duplicate stage entry — skipping plugin",
      { stage: decl.stage },
    );
    return false;
  }
  seen.add(decl.stage);

  if (decl.note !== undefined) {
    if (typeof decl.note !== "string" || decl.note.length > 200) {
      pluginLog.error(
        "Plugin manifest 'hooks' entry 'note' must be a string ≤200 chars — skipping plugin",
        { stage: decl.stage },
      );
      return false;
    }
  }
  for (const field of ["reads", "writes"] as const) {
    const arr = decl[field];
    if (arr === undefined) continue;
    if (!Array.isArray(arr) || arr.some((x) => typeof x !== "string")) {
      pluginLog.error(
        `Plugin manifest 'hooks' entry '${field}' must be a string[] — skipping plugin`,
        { stage: decl.stage },
      );
      return false;
    }
  }
  if (decl.priority !== undefined && typeof decl.priority !== "number") {
    pluginLog.error(
      "Plugin manifest 'hooks' entry 'priority' must be a number — skipping plugin",
      { stage: decl.stage },
    );
    return false;
  }
  if (decl.parallel !== undefined && typeof decl.parallel !== "boolean") {
    pluginLog.error(
      "Plugin manifest 'hooks' entry 'parallel' must be a boolean — skipping plugin",
      { stage: decl.stage },
    );
    return false;
  }
  if (decl.readOnly !== undefined && typeof decl.readOnly !== "boolean") {
    pluginLog.error(
      "Plugin manifest 'hooks' entry 'readOnly' must be a boolean — skipping plugin",
      { stage: decl.stage },
    );
    return false;
  }
  if (decl.concurrency !== undefined && typeof decl.concurrency !== "number") {
    pluginLog.error(
      "Plugin manifest 'hooks' entry 'concurrency' must be a number — skipping plugin",
      { stage: decl.stage },
    );
    return false;
  }
  if (decl.dependsOn !== undefined) {
    if (!Array.isArray(decl.dependsOn) || decl.dependsOn.some((x) => typeof x !== "string")) {
      pluginLog.error(
        "Plugin manifest 'hooks' entry 'dependsOn' must be a string[] — skipping plugin",
        { stage: decl.stage },
      );
      return false;
    }
  }
  return true;
}

/**
 * Apply coercion / guard rules (2.2–2.7) to one already-schema-valid hook
 * declaration. Mutates `raw` in place. Pure-ish: emits warn/error/debug logs.
 */
function applyHookCoercions(raw: Record<string, unknown>, pluginLog: Logger): void {
  const stage = raw.stage as string;

  // 2.2 Stage allowlist guard (redundant with filter above but kept as runtime guard)
  if (raw.parallel === true && !PARALLEL_ALLOWED.has(stage)) {
    pluginLog.warn(
      "Plugin manifest: parallel:true is only allowed for stages in PARALLEL_ALLOWED",
      { stage },
    );
    raw.parallel = false;
  }

  // 2.3 / 2.4 readOnly requirement for parallel dispatch
  if (raw.parallel === true && raw.readOnly !== true) {
    if (stage === "response-stream") {
      // 2.4 response-stream: REJECT (not coerce)
      pluginLog.error(
        "Plugin manifest: response-stream + parallel:true requires readOnly:true",
        { stage },
      );
      raw.parallel = false;
    } else {
      // 2.3 Other stages: coerce
      pluginLog.warn(
        "Plugin manifest: parallel:true requires readOnly:true — coercing parallel to false",
        { stage },
      );
      raw.parallel = false;
    }
  }

  // 2.5 Track B auto-promotion: readOnly:true without explicit parallel → parallel:true
  if (raw.readOnly === true && raw.parallel === undefined && PARALLEL_ALLOWED.has(stage)) {
    raw.parallel = true;
    pluginLog.debug(
      "Plugin manifest: Track B auto-promotion readOnly:true → parallel:true",
      { stage },
    );
  }

  // 2.6 Priority warning for parallel handlers
  if (raw.parallel === true && typeof raw.priority === "number" && (raw.priority as number) < 100) {
    pluginLog.warn(
      "Plugin manifest: parallel handlers run after all serial handlers regardless of priority",
      { stage, priority: raw.priority },
    );
  }

  // 2.7 Concurrency coercion
  if (raw.concurrency !== undefined) {
    if (!Number.isInteger(raw.concurrency) || (raw.concurrency as number) < 1) {
      pluginLog.warn(
        "Plugin manifest: invalid concurrency value, coercing to undefined",
        { stage, rejectedValue: raw.concurrency },
      );
      raw.concurrency = undefined;
    }
  }
}

/**
 * Validate the optional `hooks` declarations on a plugin manifest. Returns
 * `true` when validation passes (or when `hooks` is absent — legacy mode),
 * `false` when the manifest must be skipped entirely.
 *
 * Note: this validator mutates `manifest.hooks` in place during the
 * coercion / guard pass (e.g. forcing `parallel: false`, clearing invalid
 * `concurrency`). Callers SHOULD treat the manifest as freshly normalized
 * after this call.
 *
 * See the original docstring in plugin-validators.ts for the full ruleset.
 */
export function validateHookDeclarations(manifest: PluginManifest): boolean {
  if (manifest.hooks === undefined) return true;
  const pluginLog = log.withContext({ baseData: { plugin: manifest.name } });
  if (!Array.isArray(manifest.hooks)) {
    pluginLog.error("Plugin manifest 'hooks' must be an array — skipping plugin");
    return false;
  }

  const seen = new Set<string>();
  for (const entry of manifest.hooks) {
    if (!validateHookEntrySchema(entry, seen, pluginLog)) return false;
  }

  // Coercion / guard rules — operate on a mutable alias.
  const mutableHooks = manifest.hooks as unknown as Array<Record<string, unknown>>;
  for (const raw of mutableHooks) {
    applyHookCoercions(raw, pluginLog);
  }

  return true;
}
