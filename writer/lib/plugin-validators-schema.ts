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
 * Schema-defaults extraction helper, split out of `plugin-validators.ts`
 * for SRP — it's not a validator, it's a tiny JSON-Schema utility.
 */

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
