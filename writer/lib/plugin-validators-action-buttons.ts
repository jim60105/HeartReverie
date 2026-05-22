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
 * Validator for the optional `actionButtons` declarations on a plugin manifest.
 * Split out of `plugin-validators.ts` for SRP.
 */

import { createLogger, type Logger } from "./logger.ts";
import type {
  ActionButtonDescriptor,
  ActionButtonVisibility,
  PluginManifest,
} from "../types.ts";

const log = createLogger("plugin");

const ID_REGEX = /^[a-z0-9-]+$/;
const ALLOWED_VISIBILITY: readonly ActionButtonVisibility[] = [
  "last-chapter-backend",
  "backend-only",
];

/**
 * Parse and validate a single actionButtons entry. Returns the resolved
 * descriptor with defaults filled, or `null` if the entry is invalid (a
 * warn-level log is emitted in that case). Mutates `seenIds` to enforce
 * id uniqueness across calls.
 */
function parseActionButton(
  entry: unknown,
  seenIds: Set<string>,
  pluginLog: Logger,
): ActionButtonDescriptor | null {
  if (!entry || typeof entry !== "object") {
    pluginLog.warn("Plugin actionButtons entry is not an object — skipping");
    return null;
  }
  const descriptor = entry as Record<string, unknown>;

  const id = descriptor.id;
  if (typeof id !== "string" || !ID_REGEX.test(id)) {
    pluginLog.warn("Plugin actionButtons entry has invalid id — skipping", { id });
    return null;
  }
  if (seenIds.has(id)) {
    pluginLog.warn("Plugin actionButtons entry has duplicate id — skipping", { id });
    return null;
  }

  const labelRaw = descriptor.label;
  if (typeof labelRaw !== "string") {
    pluginLog.warn("Plugin actionButtons entry has non-string label — skipping", { id });
    return null;
  }
  const label = labelRaw.trim();
  if (label.length < 1 || label.length > 40) {
    pluginLog.warn(
      "Plugin actionButtons entry has out-of-range label — skipping",
      { id, length: label.length },
    );
    return null;
  }

  let icon: string | undefined;
  if (descriptor.icon !== undefined) {
    if (typeof descriptor.icon !== "string") {
      pluginLog.warn("Plugin actionButtons entry has non-string icon — skipping", { id });
      return null;
    }
    icon = descriptor.icon;
  }

  let tooltip: string | undefined;
  if (descriptor.tooltip !== undefined) {
    if (typeof descriptor.tooltip !== "string" || descriptor.tooltip.length > 200) {
      pluginLog.warn("Plugin actionButtons entry has invalid tooltip — skipping", { id });
      return null;
    }
    tooltip = descriptor.tooltip;
  }

  let priority = 100;
  if (descriptor.priority !== undefined) {
    if (typeof descriptor.priority !== "number" || !Number.isFinite(descriptor.priority)) {
      pluginLog.warn(
        "Plugin actionButtons entry has non-finite priority — skipping",
        { id, priority: descriptor.priority },
      );
      return null;
    }
    priority = descriptor.priority;
  }

  let visibleWhen: ActionButtonVisibility = "last-chapter-backend";
  if (descriptor.visibleWhen !== undefined) {
    if (
      typeof descriptor.visibleWhen !== "string" ||
      !ALLOWED_VISIBILITY.includes(descriptor.visibleWhen as ActionButtonVisibility)
    ) {
      pluginLog.warn(
        "Plugin actionButtons entry has unknown visibleWhen — skipping",
        { id, visibleWhen: descriptor.visibleWhen },
      );
      return null;
    }
    visibleWhen = descriptor.visibleWhen as ActionButtonVisibility;
  }

  seenIds.add(id);
  return {
    id,
    label,
    ...(icon !== undefined ? { icon } : {}),
    ...(tooltip !== undefined ? { tooltip } : {}),
    priority,
    visibleWhen,
  };
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

  const seenIds = new Set<string>();
  const validated: ActionButtonDescriptor[] = [];
  for (const entry of raw) {
    const parsed = parseActionButton(entry, seenIds, pluginLog);
    if (parsed !== null) validated.push(parsed);
  }
  return validated;
}
