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

import { intersectXPathRoots, validatePathValue } from "./path-allowlist.ts";
import {
  FORMAT_WHITELIST,
  type InternalContext,
} from "./schema-validator-types.ts";

export async function stringChecks(
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
