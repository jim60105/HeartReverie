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
 * The two-phase validation pipeline used by
 * {@link PluginSettingsService.validateAndPrepare}. Extracted as a pure
 * function so the orchestrator can stay focused on lifecycle / snapshot
 * concerns while this module owns the validation algorithm:
 *
 *  1. parse caller-supplied `_changedPaths` (malformed → single error,
 *     short-circuit).
 *  2. strip `_changedPaths` from the body to be persisted.
 *  3. resolve `writeOnly` short-circuits against the on-disk config
 *     (`null` ⇒ keep existing under current key or x-previous-names
 *     alias; `""` ⇒ clear).
 *  4. compute the deep diff between disk-post-rename and stripped body,
 *     excluding fields hidden by `x-show-when`.
 *  5. run schema validation; classify each error as blocking (path in
 *     scope) vs warning.
 *  6. on success, merge the legacy namespace via {@link mergeXLegacy}.
 *
 * The caller owns the disk read and the duration timer, so this module
 * has no I/O and no clock reads of its own.
 */

import {
  type ValidationError,
  validate as validateSchema,
} from "./schema-validator.ts";
import {
  computeDeepDiff,
  computeHiddenPaths,
  excludeHiddenFromDiff,
  isPathInScope,
  unionPaths,
} from "./settings-diff.ts";
import {
  applyPreviousNamesMigration,
  mergeXLegacy,
} from "./plugin-settings-helpers.ts";
import type { SettingsAudit } from "./plugin-settings-audit.ts";

export interface ValidateAndPrepareResult {
  errors: ValidationError[];
  warnings: ValidationError[];
  finalSettings: Record<string, unknown>;
  changedPaths: string[];
  durationMs: number;
  malformedChangedPaths: boolean;
  schemaVersionMismatch: boolean;
}

/**
 * Snapshot of the per-plugin context the orchestrator passes in. Read
 * once at the top of the public method so an interleaving plugin reload
 * cannot tear our view of schema / audit / on-disk.
 */
export interface ValidateContext {
  /** Plugin name — included in the schema_version_mismatch error params. */
  name: string;
  schema: Record<string, unknown> | undefined;
  audit: SettingsAudit | undefined;
  /** Raw on-disk config; this fn clones before mutating. */
  onDisk: Record<string, unknown>;
  projectRoot: string;
  pathRoots: { display: string[]; absolute: string[] } | null;
  /** Wall-clock start (performance.now()) captured BEFORE the disk read. */
  start: number;
}

/**
 * Run validation + writeOnly short-circuit + legacy-namespace merge. The
 * legacy substring contract is enforced by the caller — this function
 * only returns the structured envelope.
 */
export async function runValidateAndPrepare(
  body: Record<string, unknown>,
  ctx: ValidateContext,
): Promise<ValidateAndPrepareResult> {
  const { schema, audit, projectRoot, pathRoots, start } = ctx;

  if (audit?.versionMismatch) {
    return {
      errors: [{
        path: "",
        keyword: "schema_version_mismatch",
        messageKey: "schema_version_mismatch",
        params: { plugin: ctx.name },
      }],
      warnings: [],
      finalSettings: {},
      changedPaths: [],
      durationMs: performance.now() - start,
      malformedChangedPaths: false,
      schemaVersionMismatch: true,
    };
  }

  // Caller-supplied `_changedPaths` MUST be an array of strings. A
  // non-array (or array containing non-strings) is a hard error: short
  // out with the malformed marker as the sole error so the route can
  // respond 400 without running validation.
  const rawChanged = (body as Record<string, unknown>)["_changedPaths"];
  let providedChangedPaths: string[] | null = null;
  let malformed = false;
  if (rawChanged !== undefined) {
    if (
      !Array.isArray(rawChanged) ||
      !rawChanged.every((s) => typeof s === "string")
    ) {
      malformed = true;
    } else {
      providedChangedPaths = rawChanged.slice();
    }
  }

  if (malformed) {
    return {
      errors: [{
        path: "_changedPaths",
        keyword: "type",
        messageKey: "type",
        params: { expected: "array<string>" },
      }],
      warnings: [],
      finalSettings: {},
      changedPaths: [],
      durationMs: performance.now() - start,
      malformedChangedPaths: true,
      schemaVersionMismatch: false,
    };
  }

  const stripped: Record<string, unknown> = { ...body };
  delete stripped["_changedPaths"];

  // Clone on-disk BEFORE mutating; the caller owns the original.
  const diskNoLegacy: Record<string, unknown> = { ...ctx.onDisk };
  const xLegacyExisting = diskNoLegacy["x-legacy"];
  delete diskNoLegacy["x-legacy"];

  // writeOnly short-circuits BEFORE validation. `null` ⇒ keep existing
  // (look at current key, then any x-previous-names alias); `""` ⇒ clear;
  // other ⇒ set+validate.
  if (audit) {
    for (const k of audit.writeOnlyKeys) {
      if (!(k in stripped)) continue;
      const v = stripped[k];
      if (v === null) {
        if (k in diskNoLegacy) {
          stripped[k] = diskNoLegacy[k];
        } else {
          for (const [prev, current] of audit.previousNames.entries()) {
            if (current === k && prev in diskNoLegacy) {
              stripped[k] = diskNoLegacy[prev];
              break;
            }
          }
          if (stripped[k] === null) {
            delete stripped[k];
          }
        }
      } else if (v === "") {
        delete stripped[k];
      }
    }
  }

  // Diff against the post-rename disk so we don't mark renames as diffs.
  const diskPostRename = applyPreviousNamesMigration(diskNoLegacy, audit);
  let actualDiffPaths = computeDeepDiff(diskPostRename, stripped);

  // Conditional fields (x-show-when=false on the SUBMITTED body) are
  // hidden in the UI and MUST NOT be blocking. The frontend strips them
  // from _changedPaths; the server's independent diff would otherwise
  // re-enter the scope, so we exclude them here too.
  if (schema) {
    const hidden = computeHiddenPaths(schema, stripped);
    if (hidden.length > 0) {
      actualDiffPaths = excludeHiddenFromDiff(actualDiffPaths, hidden);
    }
  }

  const scope = unionPaths(providedChangedPaths ?? [], actualDiffPaths);

  let allErrors: ValidationError[] = [];
  if (schema) {
    const opts = pathRoots
      ? {
        projectRoot,
        hardcodedPathRoots: pathRoots.display,
        absolutePathRoots: pathRoots.absolute,
      }
      : {};
    const { errors } = await validateSchema(schema, stripped, opts);
    allErrors = errors;
  }

  const blocking: ValidationError[] = [];
  const warnings: ValidationError[] = [];
  for (const e of allErrors) {
    if (isPathInScope(e.path, scope)) blocking.push(e);
    else warnings.push(e);
  }

  let finalSettings = stripped;
  if (blocking.length === 0) {
    finalSettings = mergeXLegacy(
      stripped,
      diskNoLegacy,
      xLegacyExisting,
      schema,
      audit,
    );
  }

  return {
    errors: blocking,
    warnings,
    finalSettings,
    changedPaths: scope,
    durationMs: performance.now() - start,
    malformedChangedPaths: false,
    schemaVersionMismatch: false,
  };
}
