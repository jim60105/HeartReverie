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
 * Pure plugin-manifest validators extracted from {@link PluginManager}.
 *
 * These functions consume a {@link PluginManifest} (and, where relevant, the
 * plugin's resolved directory) and return validated/normalized values without
 * touching any class state. They are exported so they can be unit-tested in
 * isolation; consumers inside the package should call them as free functions.
 */

import { errorMessage } from "./errors.ts";
import { isAbsolute, resolve, SEPARATOR } from "@std/path";
import { isPathContained } from "./path-safety.ts";
import { PARALLEL_ALLOWED } from "./hooks.ts";
import { createLogger } from "./logger.ts";
import type {
  ActionButtonDescriptor,
  ActionButtonVisibility,
  PluginHookDeclaration,
  PluginManifest,
} from "../types.ts";

const log = createLogger("plugin");

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
 * Constraints enforced:
 * - `hooks` must be an array when present
 * - each entry must be an object with a string `stage` field
 * - `stage === "strip-tags"` is rejected (use `promptStripTags` /
 *   `displayStripTags` instead)
 * - duplicate `stage` values within the same array are rejected
 * - `note` longer than 200 chars is rejected
 * - non-string entries in `reads` / `writes` are rejected
 * - `parallel`, `readOnly` must be booleans when present
 * - `concurrency` must be a positive integer when present
 * - `dependsOn` must be a string[] when present
 *
 * After schema validation, coercion / guard rules are applied:
 * - parallel:true on non-PARALLEL_ALLOWED stage → coerced to false
 * - parallel:true without readOnly:true → coerced to false (error for
 *   response-stream)
 * - readOnly:true without parallel → auto-promoted to parallel:true
 *   (only for PARALLEL_ALLOWED stages)
 * - parallel:true with priority < 100 → warn (parallel runs after serial)
 * - invalid concurrency → coerced to undefined
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
  }

  // Use a mutable alias so we can reassign properties during coercion.
  const mutableHooks = manifest.hooks as unknown as Array<Record<string, unknown>>;

  // Coercion / guard rules (2.2–2.7)
  for (const raw of mutableHooks) {
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
    // Only applies to PARALLEL_ALLOWED stages; non-eligible stages ignore this.
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

  return true;
}

/**
 * Validate, default, and deduplicate a plugin's `actionButtons` entries.
 * Returns an array of fully-resolved descriptors with defaults filled
 * (`priority: 100`, `visibleWhen: "last-chapter-backend"`). Invalid entries
 * are dropped individually with a logged warning under the plugin's scope.
 */
export function validateActionButtons(
  manifest: PluginManifest,
): ActionButtonDescriptor[] {
  const raw: unknown = manifest.actionButtons;
  if (raw === undefined) return [];
  const pluginLog = log.withContext({ baseData: { plugin: manifest.name } });
  if (!Array.isArray(raw)) {
    pluginLog.warn("Plugin has non-array actionButtons — ignoring");
    return [];
  }

  const idRegex = /^[a-z0-9-]+$/;
  const allowedVisibility: readonly ActionButtonVisibility[] = [
    "last-chapter-backend",
    "backend-only",
  ];
  const seenIds = new Set<string>();
  const validated: ActionButtonDescriptor[] = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      pluginLog.warn(
        "Plugin actionButtons entry is not an object — skipping",
      );
      continue;
    }
    const descriptor = entry as Record<string, unknown>;

    const id = descriptor.id;
    if (typeof id !== "string" || !idRegex.test(id)) {
      pluginLog.warn("Plugin actionButtons entry has invalid id — skipping", {
        id,
      });
      continue;
    }
    if (seenIds.has(id)) {
      pluginLog.warn(
        "Plugin actionButtons entry has duplicate id — skipping",
        { id },
      );
      continue;
    }

    const labelRaw = descriptor.label;
    if (typeof labelRaw !== "string") {
      pluginLog.warn(
        "Plugin actionButtons entry has non-string label — skipping",
        { id },
      );
      continue;
    }
    const label = labelRaw.trim();
    if (label.length < 1 || label.length > 40) {
      pluginLog.warn(
        "Plugin actionButtons entry has out-of-range label — skipping",
        { id, length: label.length },
      );
      continue;
    }

    const iconRaw = descriptor.icon;
    let icon: string | undefined;
    if (iconRaw !== undefined) {
      if (typeof iconRaw !== "string") {
        pluginLog.warn(
          "Plugin actionButtons entry has non-string icon — skipping",
          { id },
        );
        continue;
      }
      icon = iconRaw;
    }

    const tooltipRaw = descriptor.tooltip;
    let tooltip: string | undefined;
    if (tooltipRaw !== undefined) {
      if (typeof tooltipRaw !== "string" || tooltipRaw.length > 200) {
        pluginLog.warn(
          "Plugin actionButtons entry has invalid tooltip — skipping",
          { id },
        );
        continue;
      }
      tooltip = tooltipRaw;
    }

    const priorityRaw = descriptor.priority;
    let priority = 100;
    if (priorityRaw !== undefined) {
      if (typeof priorityRaw !== "number" || !Number.isFinite(priorityRaw)) {
        pluginLog.warn(
          "Plugin actionButtons entry has non-finite priority — skipping",
          { id, priority: priorityRaw },
        );
        continue;
      }
      priority = priorityRaw;
    }

    const visibleWhenRaw = descriptor.visibleWhen;
    let visibleWhen: ActionButtonVisibility = "last-chapter-backend";
    if (visibleWhenRaw !== undefined) {
      if (
        typeof visibleWhenRaw !== "string" ||
        !allowedVisibility.includes(visibleWhenRaw as ActionButtonVisibility)
      ) {
        pluginLog.warn(
          "Plugin actionButtons entry has unknown visibleWhen — skipping",
          { id, visibleWhen: visibleWhenRaw },
        );
        continue;
      }
      visibleWhen = visibleWhenRaw as ActionButtonVisibility;
    }

    seenIds.add(id);
    const resolved: ActionButtonDescriptor = {
      id,
      label,
      ...(icon !== undefined ? { icon } : {}),
      ...(tooltip !== undefined ? { tooltip } : {}),
      priority,
      visibleWhen,
    };
    validated.push(resolved);
  }

  return validated;
}

/**
 * Validate, normalize, and deduplicate a plugin's frontendStyles entries.
 * Returns an array of normalized relative paths (forward-slash, no leading "./")
 * whose resolved targets exist on disk and are contained within the plugin directory.
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

  const seen = new Set<string>();
  const validated: string[] = [];

  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) {
      log.warn(
        "Plugin has invalid frontendStyles entry (must be non-empty string) — skipping",
        { plugin: manifest.name },
      );
      continue;
    }
    if (!entry.toLowerCase().endsWith(".css")) {
      log.warn(
        "Plugin frontendStyles entry does not end with .css — skipping",
        { plugin: manifest.name, entry },
      );
      continue;
    }
    if (isAbsolute(entry)) {
      log.warn("Plugin frontendStyles entry is an absolute path — skipping", {
        plugin: manifest.name,
        entry,
      });
      continue;
    }
    // Reject path traversal segments
    const segments = entry.split(/[\\/]/);
    if (segments.some((s) => s === "..")) {
      log.warn("Plugin frontendStyles entry contains '..' — skipping", {
        plugin: manifest.name,
        entry,
      });
      continue;
    }
    // Reject backslashes and URL-hostile characters
    if (/[\\#?%]/.test(entry)) {
      log.warn(
        "Plugin frontendStyles entry contains invalid characters — skipping",
        { plugin: manifest.name, entry },
      );
      continue;
    }

    // Normalize: strip leading "./" (possibly repeated)
    let normalized = entry;
    while (normalized.startsWith("./")) {
      normalized = normalized.slice(2);
    }

    const resolved = resolve(pluginDir, normalized);
    if (!isPathContained(pluginDir, resolved)) {
      log.warn(
        "Plugin frontendStyles entry escapes plugin directory — skipping",
        { plugin: manifest.name, entry },
      );
      continue;
    }

    // Deduplicate by resolved path
    if (seen.has(resolved)) continue;
    seen.add(resolved);

    // Verify file exists; log warning and skip if missing (consistent with promptFragments)
    try {
      const stat = await Deno.stat(resolved);
      if (!stat.isFile) {
        log.warn("Plugin frontendStyles entry is not a file — skipping", {
          plugin: manifest.name,
          entry,
        });
        continue;
      }
      // Symlink-safe: verify real path is still within plugin directory
      const realFile = await Deno.realPath(resolved);
      const realPluginDir = await Deno.realPath(pluginDir);
      if (
        !realFile.startsWith(realPluginDir + SEPARATOR) &&
        realFile !== realPluginDir
      ) {
        log.warn(
          "Plugin frontendStyles entry resolves outside plugin directory — skipping",
          { plugin: manifest.name, entry },
        );
        continue;
      }
    } catch (err: unknown) {
      log.warn("Plugin frontendStyles entry not found", {
        plugin: manifest.name,
        entry,
        error: errorMessage(err),
      });
      continue;
    }

    validated.push(normalized);
  }

  return validated;
}

/**
 * Extract default values from a JSON Schema's properties.
 */
export function extractSchemaDefaults(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!schema || typeof schema !== "object") return {};
  const properties = schema.properties;
  if (
    !properties || typeof properties !== "object" || Array.isArray(properties)
  ) return {};

  const defaults: Record<string, unknown> = {};
  for (
    const [key, prop] of Object.entries(properties as Record<string, unknown>)
  ) {
    if (prop && typeof prop === "object" && !Array.isArray(prop)) {
      const propObj = prop as Record<string, unknown>;
      if ("default" in propObj) {
        defaults[key] = propObj.default;
      }
    }
  }
  return defaults;
}
