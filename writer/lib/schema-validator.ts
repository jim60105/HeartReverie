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
import { intersectXPathRoots, validatePathValue } from "./path-allowlist.ts";

const log = createLogger("plugin");

/**
 * Structured validation error. The shape is i18n-ready: `messageKey` is a
 * stable identifier, `params` carries the keyword parameters for templating.
 */
export interface ValidationError {
  readonly path: string;
  readonly keyword: string;
  readonly messageKey: string;
  readonly params: Record<string, unknown>;
}

/**
 * Per-invocation context for the validator. `format: "path"` requires the
 * project root and the hardcoded allowlist; pure-shape validations do not.
 */
export interface ValidateOptions {
  readonly projectRoot?: string;
  readonly hardcodedPathRoots?: readonly string[];
  readonly absolutePathRoots?: readonly string[];
}

interface InternalContext {
  readonly errors: ValidationError[];
  readonly options: ValidateOptions;
  readonly seenUnknownKeywords: Set<string>;
}

const KEYWORDS_HANDLED = new Set([
  // structural / type
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  // numeric
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  // string
  "minLength",
  "maxLength",
  "pattern",
  "format",
  // array
  "minItems",
  "maxItems",
  "uniqueItems",
  // annotation (no validation)
  "title",
  "description",
  "default",
  "writeOnly",
  "examples",
  "$schema",
  "$id",
  "$comment",
]);

const KNOWN_X_KEYWORDS = new Set([
  "x-show-when",
  "x-options-url",
  "x-format",
  "x-path-roots",
  "x-previous-names",
  "x-legacy",
  "x-schema-version",
]);

const FORMAT_WHITELIST = new Set(["path", "color", "url", "email", "uuid"]);

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

function matchType(value: unknown, type: string): boolean {
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return value !== null && typeof value === "object" &&
        !Array.isArray(value);
    case "null":
      return value === null;
    default:
      return true;
  }
}

function jsonTypeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

async function stringChecks(
  schema: Record<string, unknown>,
  value: string,
  path: string,
  ctx: InternalContext,
): Promise<void> {
  if (typeof schema.minLength === "number" && value.length < schema.minLength) {
    ctx.errors.push({
      path,
      keyword: "minLength",
      messageKey: "minLength",
      params: { minLength: schema.minLength, actual: value.length },
    });
  }
  if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
    ctx.errors.push({
      path,
      keyword: "maxLength",
      messageKey: "maxLength",
      params: { maxLength: schema.maxLength, actual: value.length },
    });
  }
  if (typeof schema.pattern === "string") {
    let re: RegExp | null = null;
    try {
      re = new RegExp(schema.pattern);
    } catch {
      // Malformed pattern at schema-load time — ignore here.
    }
    if (re && !re.test(value)) {
      ctx.errors.push({
        path,
        keyword: "pattern",
        messageKey: "pattern",
        params: { pattern: schema.pattern },
      });
    }
  }
  if (typeof schema.format === "string") {
    await formatCheck(schema, value, path, ctx);
  }
}

async function formatCheck(
  schema: Record<string, unknown>,
  value: string,
  path: string,
  ctx: InternalContext,
): Promise<void> {
  const fmt = String(schema.format);
  if (!FORMAT_WHITELIST.has(fmt)) return;

  switch (fmt) {
    case "color":
      if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(value)) {
        ctx.errors.push({
          path,
          keyword: "format",
          messageKey: "format",
          params: { format: "color" },
        });
      }
      break;
    case "url":
      try {
        new URL(value);
      } catch {
        ctx.errors.push({
          path,
          keyword: "format",
          messageKey: "format",
          params: { format: "url" },
        });
      }
      break;
    case "email":
      // Conservative: localpart@domain.tld with at least one dot in domain.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        ctx.errors.push({
          path,
          keyword: "format",
          messageKey: "format",
          params: { format: "email" },
        });
      }
      break;
    case "uuid":
      if (
        !/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
          .test(value)
      ) {
        ctx.errors.push({
          path,
          keyword: "format",
          messageKey: "format",
          params: { format: "uuid" },
        });
      }
      break;
    case "path":
      await pathFormatCheck(schema, value, path, ctx);
      break;
  }
}

async function pathFormatCheck(
  schema: Record<string, unknown>,
  value: string,
  path: string,
  ctx: InternalContext,
): Promise<void> {
  const { hardcodedPathRoots, absolutePathRoots, projectRoot } = ctx.options;
  if (!hardcodedPathRoots || !absolutePathRoots || !projectRoot) {
    // No path context provided — cannot evaluate; skip silently (e.g. unit
    // tests that only care about pure-shape keywords).
    return;
  }

  // Resolve per-field x-path-roots intersection.
  const xpr = schema["x-path-roots"];
  const xprArr = Array.isArray(xpr)
    ? xpr.filter((s): s is string => typeof s === "string")
    : null;
  const effectiveDisplay = intersectXPathRoots(hardcodedPathRoots, xprArr);

  // Map effective display roots back to absolute roots via index alignment
  // with the hardcoded list provided in context.
  const effectiveAbsolute: string[] = [];
  for (const d of effectiveDisplay) {
    const idx = hardcodedPathRoots.indexOf(d);
    if (idx >= 0) {
      const abs = absolutePathRoots[idx];
      if (typeof abs === "string") effectiveAbsolute.push(abs);
    }
  }

  if (effectiveAbsolute.length === 0) {
    ctx.errors.push({
      path,
      keyword: "format",
      messageKey: "format",
      params: { format: "path", reason: "no-effective-roots" },
    });
    return;
  }

  const result = await validatePathValue(value, effectiveAbsolute, projectRoot);
  if (!result.ok) {
    ctx.errors.push({
      path,
      keyword: "format",
      messageKey: "format",
      params: {
        format: "path",
        reason: result.reason,
        roots: effectiveDisplay,
      },
    });
  }
}

function numericChecks(
  schema: Record<string, unknown>,
  value: number,
  path: string,
  ctx: InternalContext,
): void {
  if (typeof schema.minimum === "number" && value < schema.minimum) {
    ctx.errors.push({
      path,
      keyword: "minimum",
      messageKey: "minimum",
      params: { minimum: schema.minimum },
    });
  }
  if (typeof schema.maximum === "number" && value > schema.maximum) {
    ctx.errors.push({
      path,
      keyword: "maximum",
      messageKey: "maximum",
      params: { maximum: schema.maximum },
    });
  }
  if (
    typeof schema.exclusiveMinimum === "number" &&
    value <= schema.exclusiveMinimum
  ) {
    ctx.errors.push({
      path,
      keyword: "exclusiveMinimum",
      messageKey: "exclusiveMinimum",
      params: { exclusiveMinimum: schema.exclusiveMinimum },
    });
  }
  if (
    typeof schema.exclusiveMaximum === "number" &&
    value >= schema.exclusiveMaximum
  ) {
    ctx.errors.push({
      path,
      keyword: "exclusiveMaximum",
      messageKey: "exclusiveMaximum",
      params: { exclusiveMaximum: schema.exclusiveMaximum },
    });
  }
  if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
    const ratio = value / schema.multipleOf;
    if (Math.abs(ratio - Math.round(ratio)) > 1e-9) {
      ctx.errors.push({
        path,
        keyword: "multipleOf",
        messageKey: "multipleOf",
        params: { multipleOf: schema.multipleOf },
      });
    }
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

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    for (const k of ak) {
      if (!(k in bo)) return false;
      if (!deepEqual(ao[k], bo[k])) return false;
    }
    return true;
  }
  return false;
}
