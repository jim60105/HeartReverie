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
 * Companion service that owns the plugin-settings read / validate / write
 * pipeline. Extracted from {@link PluginManager} so the settings life-cycle
 * (defaults, previous-names migration, writeOnly masking, x-legacy
 * preservation, path-roots resolution, schema-version mismatch handling)
 * can be reasoned about independently of plugin discovery.
 *
 * Lifecycle: a single instance is created by `PluginManager` in its
 * constructor; it holds *references* to the live `#plugins` and
 * `#settingsAudit` maps owned by the manager so it always reads current
 * state without any sync step. The service performs no plugin loading
 * itself — it only consumes already-discovered entries.
 */

import { dirname, join } from "@std/path";
import { errorMessage } from "./errors.ts";
import {
  getHardcodedPathRoots,
  resolveDisplayRoots,
} from "./path-allowlist.ts";
import {
  type ValidationError,
  validate as validateSchema,
} from "./schema-validator.ts";
import { createLogger } from "./logger.ts";
import { extractSchemaDefaults } from "./plugin-validators.ts";
import type { SettingsAudit } from "./plugin-settings-audit.ts";
import {
  computeDeepDiff,
  computeHiddenPaths,
  excludeHiddenFromDiff,
  isPathInScope,
  unionPaths,
} from "./settings-diff.ts";
import type { PluginManifest } from "../types.ts";

const log = createLogger("plugin");

/**
 * Minimal shape of a plugin entry consumed by the settings service.
 * Intentionally narrower than `PluginManager`'s internal `PluginEntry` so
 * the two modules do not become coupled via a shared structural type.
 */
export interface PluginSettingsEntry {
  readonly manifest: PluginManifest;
}

export interface ValidateAndPrepareResult {
  errors: ValidationError[];
  warnings: ValidationError[];
  finalSettings: Record<string, unknown>;
  changedPaths: string[];
  durationMs: number;
  malformedChangedPaths: boolean;
  schemaVersionMismatch: boolean;
}

export interface SettingsForResponse {
  settings: Record<string, unknown>;
  legacyWarnings: ValidationError[];
  schemaVersionMismatch: boolean;
}

export class PluginSettingsService {
  readonly #plugins: ReadonlyMap<string, PluginSettingsEntry>;
  readonly #settingsAudit: ReadonlyMap<string, SettingsAudit>;
  readonly #playgroundDir: string;

  /**
   * @param plugins        Live map of discovered plugins (read-only view).
   * @param settingsAudit  Live audit map populated at load time.
   * @param playgroundDir  Absolute path to the playground directory. The
   *                       project root used for `format: "path"` resolution
   *                       is computed as `dirname(playgroundDir)`.
   */
  constructor(
    plugins: ReadonlyMap<string, PluginSettingsEntry>,
    settingsAudit: ReadonlyMap<string, SettingsAudit>,
    playgroundDir: string,
  ) {
    this.#plugins = plugins;
    this.#settingsAudit = settingsAudit;
    this.#playgroundDir = playgroundDir;
  }

  hasSettingsSchema(name: string): boolean {
    const entry = this.#plugins.get(name);
    return !!entry?.manifest.settingsSchema;
  }

  /**
   * Returns the plugin's settingsSchema or null if none declared.
   */
  getSettingsSchema(name: string): Record<string, unknown> | null {
    const entry = this.#plugins.get(name);
    return (entry?.manifest.settingsSchema as Record<string, unknown>) ?? null;
  }

  /**
   * Read plugin settings from `playground/_plugins/<name>/config.json`.
   * Returns merged result of schema defaults + saved values, with
   * `x-previous-names` rename migration applied IN-MEMORY (the on-disk file
   * is not touched here). Used both by internal plugin code (via
   * `getSettings`) and as the basis of the HTTP GET response.
   *
   * NOTE: This method does NOT apply `writeOnly` masking. For HTTP response
   * shaping (mask + legacy warnings) use {@link getSettingsForResponse}.
   */
  async getSettings(name: string): Promise<Record<string, unknown>> {
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);

    const schema = entry.manifest.settingsSchema as
      | Record<string, unknown>
      | undefined;
    const audit = this.#settingsAudit.get(name);

    // If schema version mismatched, return schema defaults only.
    if (audit?.versionMismatch) {
      return extractSchemaDefaults(schema);
    }

    const defaults = extractSchemaDefaults(schema);

    const saved = await this.#readDiskConfig(name);
    // Strip x-legacy from the in-memory view immediately — it must never
    // leak past this method.
    delete (saved as Record<string, unknown>)["x-legacy"];

    const renamed = this.#applyPreviousNamesMigration(saved, audit);

    return { ...defaults, ...renamed };
  }

  /**
   * GET-response shape: applies `x-previous-names` rename, masks `writeOnly`
   * fields with `null`, and computes `x-legacy-warnings` by validating the
   * in-memory (post-rename) value against the schema.
   *
   * Never modifies the on-disk file.
   */
  async getSettingsForResponse(name: string): Promise<SettingsForResponse> {
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);
    const audit = this.#settingsAudit.get(name);
    const schema = entry.manifest.settingsSchema as
      | Record<string, unknown>
      | undefined;

    if (audit?.versionMismatch) {
      return {
        settings: extractSchemaDefaults(schema),
        legacyWarnings: [],
        schemaVersionMismatch: true,
      };
    }

    const merged = await this.getSettings(name);

    // Validate the post-rename payload to produce legacy warnings.
    let legacyWarnings: ValidationError[] = [];
    if (schema) {
      const roots = this.#getEffectivePathRootsForPlugin(name);
      const opts = roots
        ? {
          projectRoot: this.#projectRoot(),
          hardcodedPathRoots: roots.display,
          absolutePathRoots: roots.absolute,
        }
        : {};
      const { errors } = await validateSchema(schema, merged, opts);
      legacyWarnings = errors;
    }

    // Apply writeOnly masking AFTER validation.
    if (audit) {
      for (const k of audit.writeOnlyKeys) {
        if (k in merged) merged[k] = null;
      }
    }

    return { settings: merged, legacyWarnings, schemaVersionMismatch: false };
  }

  /**
   * Save plugin settings to `playground/_plugins/<name>/config.json` after
   * running two-phase validation.
   *
   * The legacy substring contract (`"Settings validation failed: ..."`) is
   * preserved on `throw` so existing call sites that catch by substring keep
   * working until they migrate to the new structured envelope.
   */
  async saveSettings(
    name: string,
    settings: Record<string, unknown>,
  ): Promise<void> {
    const result = await this.validateAndPrepare(name, settings);
    if (result.errors.length > 0) {
      throw new Error(
        "Settings validation failed: " +
          result.errors.map((e) => `${e.path} ${e.keyword}`).join("; "),
      );
    }
    await this.commit(name, result.finalSettings);
  }

  /**
   * Two-phase validation + writeOnly short-circuit. Does not write to disk.
   * Returns a structured envelope:
   *   - `errors`: blocking errors (path ⊆ blocking scope)
   *   - `warnings`: non-blocking errors (path outside scope)
   *   - `finalSettings`: the value that SHOULD be passed to {@link commit}
   *     if `errors.length === 0`. Has `_changedPaths` stripped and
   *     `writeOnly` null short-circuits resolved.
   *   - `changedPaths`: the union scope used to classify blocking vs warning.
   *   - `durationMs`: validator wall-clock duration (for audit logging).
   *   - `malformedChangedPaths`: true when caller-supplied `_changedPaths`
   *     was non-array; the only error returned is the malformed marker.
   *   - `schemaVersionMismatch`: true when this plugin's schema version is
   *     unsupported; routes SHALL respond `409` in that case.
   */
  async validateAndPrepare(
    name: string,
    body: Record<string, unknown>,
  ): Promise<ValidateAndPrepareResult> {
    const start = performance.now();
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);
    const audit = this.#settingsAudit.get(name);
    const schema = entry.manifest.settingsSchema as
      | Record<string, unknown>
      | undefined;

    if (audit?.versionMismatch) {
      return {
        errors: [{
          path: "",
          keyword: "schema_version_mismatch",
          messageKey: "schema_version_mismatch",
          params: { plugin: name },
        }],
        warnings: [],
        finalSettings: {},
        changedPaths: [],
        durationMs: performance.now() - start,
        malformedChangedPaths: false,
        schemaVersionMismatch: true,
      };
    }

    // Extract + validate caller-supplied _changedPaths.
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

    // Strip _changedPaths from the body that will be persisted.
    const stripped: Record<string, unknown> = { ...body };
    delete stripped["_changedPaths"];

    // Resolve writeOnly short-circuits BEFORE validation. `null` ⇒ keep
    // existing; `""` ⇒ clear; other ⇒ set+validate. Existing value may live
    // under the current key OR an `x-previous-names` entry.
    const onDisk = await this.#readDiskConfig(name);
    const diskNoLegacy: Record<string, unknown> = { ...onDisk };
    const xLegacyExisting = diskNoLegacy["x-legacy"];
    delete diskNoLegacy["x-legacy"];

    if (audit) {
      for (const k of audit.writeOnlyKeys) {
        if (!(k in stripped)) continue;
        const v = stripped[k];
        if (v === null) {
          // Keep existing: look at the current key first, then any
          // x-previous-names alias.
          if (k in diskNoLegacy) {
            stripped[k] = diskNoLegacy[k];
          } else {
            // find a previous-name alias that maps to k
            for (const [prev, current] of audit.previousNames.entries()) {
              if (current === k && prev in diskNoLegacy) {
                stripped[k] = diskNoLegacy[prev];
                break;
              }
            }
            if (stripped[k] === null) {
              // Nothing on disk to keep — treat as "absent" by removing.
              delete stripped[k];
            }
          }
        } else if (v === "") {
          // Explicit clear: remove key from saved settings.
          delete stripped[k];
        }
      }
    }

    // Compute the diff between stripped body and on-disk (post-rename for
    // disk side, so we don't mark renames as diffs).
    const diskPostRename = this.#applyPreviousNamesMigration(diskNoLegacy, audit);
    let actualDiffPaths = computeDeepDiff(diskPostRename, stripped);

    // Spec: a field whose x-show-when evaluates false on the submitted body
    // is hidden in the UI; pre-existing or transiently-invalid values at
    // hidden paths must NOT be blocking (see conditional-field-visibility
    // spec L61). The frontend strips these from _changedPaths, but the
    // server's independent diff would otherwise re-enter the blocking
    // scope. Exclude hidden paths from the diff contribution.
    if (schema) {
      const hidden = computeHiddenPaths(schema, stripped);
      if (hidden.length > 0) {
        actualDiffPaths = excludeHiddenFromDiff(actualDiffPaths, hidden);
      }
    }

    const scope = unionPaths(providedChangedPaths ?? [], actualDiffPaths);

    // Run validation.
    let allErrors: ValidationError[] = [];
    if (schema) {
      const roots = this.#getEffectivePathRootsForPlugin(name);
      const opts = roots
        ? {
          projectRoot: this.#projectRoot(),
          hardcodedPathRoots: roots.display,
          absolutePathRoots: roots.absolute,
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

    // If we are about to succeed, build finalSettings including the
    // x-legacy namespace handling.
    let finalSettings = stripped;
    if (blocking.length === 0) {
      finalSettings = this.#mergeXLegacy(
        name,
        stripped,
        diskNoLegacy,
        xLegacyExisting,
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

  /**
   * Persist a validated settings object to disk. Caller is responsible for
   * having invoked {@link validateAndPrepare} first.
   */
  async commit(
    name: string,
    finalSettings: Record<string, unknown>,
  ): Promise<void> {
    const entry = this.#plugins.get(name);
    if (!entry) throw new Error(`Unknown plugin: ${name}`);

    const configDir = join(this.#playgroundDir, "_plugins", name);
    await Deno.mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "config.json");
    await Deno.writeTextFile(
      configPath,
      JSON.stringify(finalSettings, null, 2) + "\n",
    );
    log.debug("Plugin settings saved", { plugin: name });
  }

  /**
   * Returns the effective display + absolute path-root lists for a plugin
   * (used for `format: "path"` validation and the `schema-meta` endpoint).
   * Returns `null` for plugins without a `settingsSchema`.
   */
  getEffectivePathRoots(
    name: string,
  ): { display: string[]; absolute: string[] } | null {
    return this.#getEffectivePathRootsForPlugin(name);
  }

  /**
   * Returns the schema version (always `1` after auto-migration), `null` if
   * the plugin has no settingsSchema, or a special sentinel `-1` when the
   * version is mismatched (routes SHALL respond 409 in that case).
   */
  getSchemaVersion(name: string): number | null {
    const entry = this.#plugins.get(name);
    if (!entry?.manifest.settingsSchema) return null;
    const audit = this.#settingsAudit.get(name);
    if (audit?.versionMismatch) return -1;
    return 1;
  }

  /** Returns true if the plugin's `x-schema-version` is unsupported. */
  isSchemaVersionMismatch(name: string): boolean {
    return this.#settingsAudit.get(name)?.versionMismatch === true;
  }

  /** Returns the project root used for `format: "path"` resolution. */
  #projectRoot(): string {
    return dirname(this.#playgroundDir);
  }

  #getEffectivePathRootsForPlugin(
    name: string,
  ): { display: string[]; absolute: string[] } | null {
    const entry = this.#plugins.get(name);
    if (!entry?.manifest.settingsSchema) return null;
    const display = getHardcodedPathRoots(name);
    const absolute = resolveDisplayRoots(display, this.#projectRoot());
    return { display, absolute };
  }

  async #readDiskConfig(name: string): Promise<Record<string, unknown>> {
    const configPath = join(
      this.#playgroundDir,
      "_plugins",
      name,
      "config.json",
    );
    try {
      const raw = await Deno.readTextFile(configPath);
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ) {
        return parsed as Record<string, unknown>;
      }
    } catch (err: unknown) {
      if (!(err instanceof Deno.errors.NotFound)) {
        log.warn("Failed to read plugin config", {
          plugin: name,
          error: errorMessage(err),
        });
      }
    }
    return {};
  }

  /**
   * Apply `x-previous-names`: for each (prev → current) mapping, if `prev`
   * exists in `raw` AND `current` does NOT, copy the value over to `current`
   * and drop `prev`. Returns a shallow-cloned object.
   */
  #applyPreviousNamesMigration(
    raw: Record<string, unknown>,
    audit: SettingsAudit | undefined,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = { ...raw };
    if (!audit) return out;
    for (const [prev, current] of audit.previousNames.entries()) {
      if (prev in out && !(current in out)) {
        out[current] = out[prev];
      }
      // Drop the legacy key from the in-memory view regardless: GET response
      // SHALL NOT echo the legacy key.
      delete out[prev];
    }
    return out;
  }

  /**
   * Merge orphan keys into the on-disk `x-legacy` namespace if the schema
   * opted into legacy preservation. Orphans = keys present in the prior
   * on-disk config that are NOT in `stripped` and NOT in the schema's
   * declared properties NOR an `x-previous-names` source.
   */
  #mergeXLegacy(
    name: string,
    stripped: Record<string, unknown>,
    priorDisk: Record<string, unknown>,
    priorXLegacy: unknown,
  ): Record<string, unknown> {
    const entry = this.#plugins.get(name)!;
    const audit = this.#settingsAudit.get(name);
    const schema = entry.manifest.settingsSchema as
      | Record<string, unknown>
      | undefined;
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
}
