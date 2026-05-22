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
 * Pure helpers extracted from {@link PluginSettingsService}. These have no
 * dependency on the live `#plugins` / `#settingsAudit` maps and no disk
 * I/O — the orchestrator snapshots its dependencies once and passes them
 * down. Kept here so the legacy-namespace and rename-migration rules can
 * be reasoned about (and unit-tested) without spinning up the full
 * service.
 */

import type { SettingsAudit } from "./plugin-settings-audit.ts";

/**
 * Apply `x-previous-names`: for each (prev → current) mapping, if `prev`
 * exists in `raw` AND `current` does NOT, copy the value over to
 * `current`. The legacy `prev` key is ALWAYS dropped from the output so
 * GET responses never echo it. Returns a shallow-cloned object; the input
 * is not mutated.
 */
export function applyPreviousNamesMigration(
  raw: Record<string, unknown>,
  audit: SettingsAudit | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };
  if (!audit) return out;
  for (const [prev, current] of audit.previousNames.entries()) {
    if (prev in out && !(current in out)) {
      out[current] = out[prev];
    }
    delete out[prev];
  }
  return out;
}

/**
 * Merge orphan keys into the on-disk `x-legacy` namespace if the schema
 * opted into legacy preservation. Orphans = keys present in the prior
 * on-disk config that are NOT in `stripped` and NOT in the schema's
 * declared properties NOR an `x-previous-names` source.
 *
 * Returns `stripped` unchanged if the plugin did not opt in or there are
 * no orphans.
 */
export function mergeXLegacy(
  stripped: Record<string, unknown>,
  priorDisk: Record<string, unknown>,
  priorXLegacy: unknown,
  schema: Record<string, unknown> | undefined,
  audit: SettingsAudit | undefined,
): Record<string, unknown> {
  if (!schema || !audit?.topLevelLegacy) return stripped;

  const props = schema.properties as Record<string, unknown> | undefined;
  const known = new Set(props ? Object.keys(props) : []);
  const previousNamesSources = new Set(audit.previousNames.keys());

  const carriedXLegacy: Record<string, unknown> =
    priorXLegacy && typeof priorXLegacy === "object" &&
      !Array.isArray(priorXLegacy)
      ? { ...(priorXLegacy as Record<string, unknown>) }
      : {};

  for (const [k, v] of Object.entries(priorDisk)) {
    if (k === "x-legacy") continue;
    if (known.has(k)) continue;
    if (previousNamesSources.has(k)) continue;
    if (k in stripped) continue;
    carriedXLegacy[k] = v;
  }

  if (Object.keys(carriedXLegacy).length === 0) return stripped;
  return { ...stripped, "x-legacy": carriedXLegacy };
}
