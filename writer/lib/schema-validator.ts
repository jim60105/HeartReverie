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

import { createLogger } from "./logger.ts";
import {
  type InternalContext,
  KEYWORDS_HANDLED,
  KNOWN_X_KEYWORDS,
  type ValidateOptions,
  type ValidationError,
} from "./schema-validator-types.ts";
import {
  deepEqual,
  jsonTypeOf,
  matchType,
} from "./schema-validator-equality.ts";
import { stringChecks } from "./schema-validator-string.ts";
import { numericChecks } from "./schema-validator-numeric.ts";

export type { ValidateOptions, ValidationError };

const log = createLogger("plugin");

/**
 * Validate `value` against `schema`. Returns the collected errors in a stable
 * order (parent before child, properties iterated in declaration order).
 */
export async function validate(
  schema: Record<string, unknown>,
  value: unknown,
  options: ValidateOptions = {},
): Promise<{ errors: ValidationError[] }> {
  const ctx: InternalContext = {
    errors: [],
    options,
    seenUnknownKeywords: new Set(),
  };
  await walk(schema, value, "", ctx);
  return { errors: ctx.errors };
}

async function walk(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  ctx: InternalContext,
): Promise<void> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return;

  // Log unknown keywords once (non-x, not handled).
  for (const k of Object.keys(schema)) {
    if (k.startsWith("x-")) {
      if (!KNOWN_X_KEYWORDS.has(k) && !ctx.seenUnknownKeywords.has(k)) {
        ctx.seenUnknownKeywords.add(k);
        // x-* unknown keywords are silently allowed per D8.
      }
      continue;
    }
    if (!KEYWORDS_HANDLED.has(k) && !ctx.seenUnknownKeywords.has(k)) {
      ctx.seenUnknownKeywords.add(k);
      log.info("Schema validator ignoring unknown keyword", {
        keyword: k,
        path: path || "(root)",
      });
    }
  }

  // type
  const type = schema.type;
  if (typeof type === "string") {
    if (!matchType(value, type)) {
      ctx.errors.push({
        path,
        keyword: "type",
        messageKey: "type",
        params: { expected: type, actual: jsonTypeOf(value) },
      });
      // If type fails, skip deeper checks for this subtree.
      return;
    }
  } else if (Array.isArray(type)) {
    if (!type.some((t) => typeof t === "string" && matchType(value, t))) {
      ctx.errors.push({
        path,
        keyword: "type",
        messageKey: "type",
        params: { expected: type, actual: jsonTypeOf(value) },
      });
      return;
    }
  }

  // const
  if ("const" in schema) {
    if (!deepEqual(value, schema.const)) {
      ctx.errors.push({
        path,
        keyword: "const",
        messageKey: "const",
        params: { const: schema.const },
      });
    }
  }

  // enum
  if (Array.isArray(schema.enum)) {
    if (!schema.enum.some((c) => deepEqual(value, c))) {
      ctx.errors.push({
        path,
        keyword: "enum",
        messageKey: "enum",
        params: { enum: schema.enum },
      });
    }
  }

  if (typeof value === "string") await stringChecks(schema, value, path, ctx);
  if (typeof value === "number") numericChecks(schema, value, path, ctx);
  if (Array.isArray(value)) await arrayChecks(schema, value, path, ctx);
  if (
    value !== null && typeof value === "object" && !Array.isArray(value)
  ) {
    await objectChecks(schema, value as Record<string, unknown>, path, ctx);
  }
}

async function arrayChecks(
  schema: Record<string, unknown>,
  value: unknown[],
  path: string,
  ctx: InternalContext,
): Promise<void> {
  if (typeof schema.minItems === "number" && value.length < schema.minItems) {
    ctx.errors.push({
      path,
      keyword: "minItems",
      messageKey: "minItems",
      params: { minItems: schema.minItems, actual: value.length },
    });
  }
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
    ctx.errors.push({
      path,
      keyword: "maxItems",
      messageKey: "maxItems",
      params: { maxItems: schema.maxItems, actual: value.length },
    });
  }
  if (schema.uniqueItems === true) {
    const seen: unknown[] = [];
    let dup = false;
    for (const item of value) {
      if (seen.some((s) => deepEqual(s, item))) {
        dup = true;
        break;
      }
      seen.push(item);
    }
    if (dup) {
      ctx.errors.push({
        path,
        keyword: "uniqueItems",
        messageKey: "uniqueItems",
        params: {},
      });
    }
  }

  const items = schema.items;
  if (items && typeof items === "object" && !Array.isArray(items)) {
    for (let i = 0; i < value.length; i++) {
      await walk(
        items as Record<string, unknown>,
        value[i],
        `${path}[${i}]`,
        ctx,
      );
    }
  }
}

async function objectChecks(
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
  path: string,
  ctx: InternalContext,
): Promise<void> {
  // required
  if (Array.isArray(schema.required)) {
    for (const field of schema.required) {
      if (typeof field !== "string") continue;
      if (!(field in value)) {
        ctx.errors.push({
          path: path ? `${path}.${field}` : field,
          keyword: "required",
          messageKey: "required",
          params: { property: field },
        });
      }
    }
  }

  const properties = schema.properties;
  const propsRec =
    properties && typeof properties === "object" && !Array.isArray(properties)
      ? properties as Record<string, unknown>
      : null;

  if (propsRec) {
    for (const [k, propSchema] of Object.entries(propsRec)) {
      if (!(k in value)) continue;
      if (propSchema && typeof propSchema === "object") {
        await walk(
          propSchema as Record<string, unknown>,
          value[k],
          path ? `${path}.${k}` : k,
          ctx,
        );
      }
    }
  }

  // additionalProperties (boolean form only — phase 1)
  if (schema.additionalProperties === false) {
    for (const k of Object.keys(value)) {
      if (!propsRec || !(k in propsRec)) {
        ctx.errors.push({
          path: path ? `${path}.${k}` : k,
          keyword: "additionalProperties",
          messageKey: "additionalProperties",
          params: { property: k },
        });
      }
    }
  }
}
