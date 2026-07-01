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

import { timingSafeEqual } from "@std/crypto/timing-safe-equal";

export const IDLE_TIMEOUT_MS = 60_000;
export const MAX_MESSAGE_LENGTH = 100_000;

/**
 * Maximum byte length of a message payload accepted on an *unauthenticated*
 * connection, enforced before `JSON.parse`. Sized to the `auth` envelope with
 * wide headroom (a real auth message is well under 1 KiB). Hono's `bodyLimit`
 * middleware does not apply to WebSocket payloads, so this is the guard that
 * prevents an unauthenticated peer from forcing a large transient allocation.
 */
export const PRE_AUTH_PAYLOAD_CAP_BYTES = 4096;

/**
 * Default deadline (ms) by which a freshly upgraded connection MUST complete
 * authentication or be closed with code 4002. Overridable via the
 * `WS_AUTH_DEADLINE_MS` env var (primarily for tests). Pre-auth messages do
 * NOT reset this deadline.
 */
export function getAuthDeadlineMs(): number {
  const raw = Deno.env.get("WS_AUTH_DEADLINE_MS");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30_000;
}

/**
 * Global cap on the number of concurrent live WebSocket connections.
 * Overridable via the `MAX_WS_CONNECTIONS` env var (primarily for tests).
 */
export function getMaxWsConnections(): number {
  const raw = Deno.env.get("MAX_WS_CONNECTIONS");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 256;
}

/**
 * Verify a passphrase using timing-safe comparison (mirrors middleware.ts logic).
 * @param passphrase - Client-provided passphrase to verify
 * @returns true if the passphrase matches the configured PASSPHRASE
 */
export function verifyWsPassphrase(passphrase: string): boolean {
  const expected = Deno.env.get("PASSPHRASE");
  if (!expected) return false;

  const encoder = new TextEncoder();
  const expectedBuf = encoder.encode(expected);
  const providedBuf = encoder.encode(passphrase);
  const lengthMatch = expectedBuf.length === providedBuf.length;
  // Always call timingSafeEqual on equal-length buffers to prevent timing leaks
  const safeBuf = lengthMatch ? providedBuf : new Uint8Array(expectedBuf.length);
  const equal = timingSafeEqual(expectedBuf, safeBuf);
  return (Number(lengthMatch) & Number(equal)) === 1;
}
