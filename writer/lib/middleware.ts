// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { resolve, SEPARATOR } from "@std/path";
import { timingSafeEqual } from "@std/crypto/timing-safe-equal";
import type { Context, Next } from "@hono/hono";
import type { SafePathFn } from "../types.ts";
import { problemJson } from "./errors.ts";

export function isValidParam(value: string): boolean {
  return !/\.\.|\x00|[/\\]/.test(value);
}

export function createSafePath(playgroundDir: string): SafePathFn {
  return function safePath(...segments: string[]): string | null {
    const base = resolve(playgroundDir);
    const resolved = resolve(base, ...segments);
    if (resolved !== base && !resolved.startsWith(base + SEPARATOR)) {
      return null;
    }
    return resolved;
  };
}

export async function validateParams(c: Context, next: Next): Promise<Response | void> {
  for (const key of ["series", "name", "number"]) {
    const val = c.req.param(key);
    if (val !== undefined && !isValidParam(val)) {
      return c.json(problemJson("Bad Request", 400, `Invalid parameter: ${key}`), 400);
    }
  }
  await next();
}

export async function verifyPassphrase(c: Context, next: Next): Promise<Response | void> {
  const expected = Deno.env.get("PASSPHRASE");
  if (!expected) {
    return c.json(problemJson("Service Unavailable", 503, "Authentication not configured"), 503);
  }

  const provided = c.req.header("x-passphrase");
  if (!provided) {
    console.warn(
      `[auth] Rejected request: ${c.req.method} ${c.req.path} from ${c.req.header("x-forwarded-for") || "unknown"}`
    );
    return c.json(problemJson("Unauthorized", 401, "Invalid or missing passphrase"), 401);
  }

  const encoder = new TextEncoder();
  const expectedBuf = encoder.encode(expected);
  const providedBuf = encoder.encode(provided);
  const lengthMatch = expectedBuf.length === providedBuf.length;
  // Always call timingSafeEqual on equal-length buffers to prevent timing leaks
  const safeBuf = lengthMatch ? providedBuf : new Uint8Array(expectedBuf.length);
  const equal = timingSafeEqual(expectedBuf, safeBuf);
  // Bitwise AND avoids short-circuit, preserving constant-time behavior
  const match: boolean = (Number(lengthMatch) & Number(equal)) === 1;

  if (match) {
    await next();
    return;
  }

  console.warn(
    `[auth] Rejected request: ${c.req.method} ${c.req.path} from ${c.req.header("x-forwarded-for") || "unknown"}`
  );
  return c.json(problemJson("Unauthorized", 401, "Invalid or missing passphrase"), 401);
}
