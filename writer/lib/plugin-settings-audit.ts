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
 * Load-time audit of a plugin manifest's `settingsSchema`.
 *
 * Extracted from {@link PluginManager} so the audit can be reasoned about
 * (and unit-tested) in isolation. The audit produces the metadata the
 * settings transactional flow needs at read/write time: previous-name
 * migrations, writeOnly masking keys, schema-version mismatches, and
 * the top-level `x-legacy` toggle.
 */

import { getHardcodedPathRoots, intersectXPathRoots } from "./path-allowlist.ts";
import { createLogger } from "./logger.ts";
import type { PluginManifest } from "../types.ts";

const log = createLogger("plugin");

/**
 * Settings-schema audit metadata captured at load time.
 *  - `versionMismatch=true` means the manifest declared an unsupported
 *    `x-schema-version`; the plugin still loads but the settings API
 *    degrades to defaults (`GET`) and `409` (`PUT`).
 *  - `previousNames` is the union of `x-previous-names` entries → current
 *    property name. Used by GET to migrate legacy keys in-memory.
 *  - `writeOnlyKeys` is the set of top-level property names whose values
 *    SHALL be masked as `null` in the GET response.
 *  - `topLevelLegacy` toggles `x-legacy` relocation at PUT time.
 */
export interface SettingsAudit {
  readonly versionMismatch: boolean;
  readonly previousNames: Map<string, string>;
  readonly writeOnlyKeys: Set<string>;
  readonly topLevelLegacy: boolean;
}

/**
 * Audit a manifest's `settingsSchema` at load time. Returns:
 *   - `null` if the schema is structurally invalid and SHALL be stripped.
 *   - `SettingsAudit` otherwise (with `versionMismatch` set when
 *     `x-schema-version` is declared but != 1).
 *
 * `schemaVersionWarned` is a caller-owned `Set` used to ensure the
 * "missing x-schema-version" warning logs at most once per plugin. The
 * function mutates the set when it emits the warning.
 */
export function auditSettingsSchema(
  manifest: PluginManifest,
  schemaVersionWarned: Set<string>,
): SettingsAudit | null {
  const pluginName = manifest.name;
  const schema = manifest.settingsSchema;
  if (
    typeof schema !== "object" || schema === null || Array.isArray(schema)
  ) {
    log.warn("Plugin settingsSchema must be an object — ignoring", {
      plugin: pluginName,
    });
    return null;
  }
  if (
    schema.type !== "object" || typeof schema.properties !== "object" ||
    schema.properties === null || Array.isArray(schema.properties)
  ) {
    log.warn(
      "Plugin settingsSchema must have type:'object' and a properties record — ignoring",
      { plugin: pluginName },
    );
    return null;
  }

  // x-schema-version
  let versionMismatch = false;
  const rawVer = (schema as Record<string, unknown>)["x-schema-version"];
  if (rawVer === undefined) {
    if (!schemaVersionWarned.has(pluginName)) {
      schemaVersionWarned.add(pluginName);
      log.warn(
        "Plugin settingsSchema missing x-schema-version — auto-migrating to 1",
        { plugin: pluginName },
      );
    }
  } else if (rawVer !== 1) {
    versionMismatch = true;
    log.warn(
      "Plugin settingsSchema declares unsupported x-schema-version — settings degraded",
      { plugin: pluginName, declared: rawVer },
    );
  }

  // Walk schema; collect per-property metadata, reject on hard rules.
  const previousNames = new Map<string, string>();
  const previousNamesSeen = new Map<string, string>(); // string → owning property
  const writeOnlyKeys = new Set<string>();
  const topLevelLegacy = (schema as Record<string, unknown>)["x-legacy"] === true;

  const failures: string[] = [];

  const walkObject = (
    objSchema: Record<string, unknown>,
    path: string,
    isTopLevel: boolean,
  ): void => {
    const props = objSchema.properties as Record<string, unknown> | undefined;
    if (!props) return;
    const requiredArr = Array.isArray(objSchema.required)
      ? objSchema.required.filter((s): s is string => typeof s === "string")
      : [];
    const requiredSet = new Set(requiredArr);

    const siblingNames = new Set(Object.keys(props));

    for (const [pname, raw] of Object.entries(props)) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const prop = raw as Record<string, unknown>;
      const pPath = path ? `${path}.${pname}` : pname;

      // Reserved top-level property names (would leak the internal
      // legacy namespace via GET defaults if allowed).
      if (
        isTopLevel &&
        (pname === "x-legacy" || pname === "x-legacy-warnings" ||
          pname === "_changedPaths")
      ) {
        failures.push(
          `${pPath}: property name is reserved by HeartReverie`,
        );
      }

      // x-show-when
      const sw = prop["x-show-when"];
      if (sw !== undefined) {
        if (typeof sw !== "object" || sw === null || Array.isArray(sw)) {
          failures.push(`${pPath}: x-show-when must be an object`);
        } else {
          const swObj = sw as Record<string, unknown>;
          const field = swObj.field;
          if (typeof field !== "string") {
            failures.push(`${pPath}: x-show-when.field must be a string`);
          } else if (!siblingNames.has(field)) {
            failures.push(
              `${pPath}: x-show-when.field '${field}' is not a sibling property`,
            );
          }
          const ops = ["equals", "notEquals", "in"].filter((k) => k in swObj);
          if (ops.length !== 1) {
            failures.push(
              `${pPath}: x-show-when must declare exactly one of equals/notEquals/in (found: ${ops.length})`,
            );
          }
          if (requiredSet.has(pname)) {
            failures.push(
              `${pPath}: declared in 'required' AND uses x-show-when (dead config)`,
            );
          }
        }
      }

      // x-previous-names
      const xpn = prop["x-previous-names"];
      if (xpn !== undefined) {
        if (
          !Array.isArray(xpn) ||
          !xpn.every((s) => typeof s === "string")
        ) {
          failures.push(
            `${pPath}: x-previous-names must be an array of strings`,
          );
        } else {
          for (const prev of xpn as string[]) {
            if (prev === pname) {
              failures.push(
                `${pPath}: x-previous-names cannot include the property's own current name`,
              );
            }
            if (isTopLevel) {
              const owner = previousNamesSeen.get(prev);
              if (owner && owner !== pname) {
                failures.push(
                  `x-previous-names string '${prev}' is declared by both ${owner} and ${pname}`,
                );
              } else {
                previousNamesSeen.set(prev, pname);
                previousNames.set(prev, pname);
              }
            }
          }
        }
      }

      // x-path-roots
      const xpr = prop["x-path-roots"];
      if (xpr !== undefined) {
        if (
          !Array.isArray(xpr) ||
          !xpr.every((s) => typeof s === "string")
        ) {
          failures.push(
            `${pPath}: x-path-roots must be an array of strings`,
          );
        } else {
          const hardcoded = getHardcodedPathRoots(pluginName);
          const isect = intersectXPathRoots(hardcoded, xpr as string[]);
          if (isect.length === 0) {
            failures.push(
              `${pPath}: x-path-roots has empty intersection with the hard-coded allowlist`,
            );
          }
        }
      }

      // writeOnly (top-level only in phase 1)
      if (isTopLevel && prop.writeOnly === true) {
        writeOnlyKeys.add(pname);
      }

      // Recurse into nested object schemas.
      if (
        prop.type === "object" && prop.properties &&
        typeof prop.properties === "object" && !Array.isArray(prop.properties)
      ) {
        walkObject(prop, pPath, false);
      }
      // Recurse into array items if object-shaped.
      if (
        prop.type === "array" && prop.items &&
        typeof prop.items === "object" && !Array.isArray(prop.items) &&
        (prop.items as Record<string, unknown>).type === "object"
      ) {
        walkObject(prop.items as Record<string, unknown>, `${pPath}[]`, false);
      }
    }
  };

  walkObject(schema as Record<string, unknown>, "", true);

  if (failures.length > 0) {
    log.warn("Plugin settingsSchema rejected — load-time audit failed", {
      plugin: pluginName,
      failures,
    });
    return null;
  }

  return { versionMismatch, previousNames, writeOnlyKeys, topLevelLegacy };
}
