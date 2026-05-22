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
