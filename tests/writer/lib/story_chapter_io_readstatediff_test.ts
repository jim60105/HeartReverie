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

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { readStateDiff } from "../../../writer/lib/story-chapter-io.ts";

/** Minimal warn-only logger spy. */
function warnSpy() {
  const calls: { message: string; data?: Record<string, unknown> }[] = [];
  return {
    calls,
    warn(message: string, data?: Record<string, unknown>) {
      calls.push({ message, data });
    },
  };
}

Deno.test("readStateDiff", async (t) => {
  await t.step("returns the parsed payload for a valid diff file", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(dir, "001-state-diff.yaml"),
        "entries:\n  - path: /hp\n    op: replace\n    value: 10\n",
      );
      const logger = warnSpy();
      const result = await readStateDiff(dir, 1, logger);
      assertEquals(Array.isArray(result?.entries), true);
      assertEquals(result?.entries.length, 1);
      assertEquals(logger.calls.length, 0);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("returns undefined silently when the file is missing", async () => {
    const dir = await Deno.makeTempDir();
    try {
      const logger = warnSpy();
      const result = await readStateDiff(dir, 1, logger);
      assertEquals(result, undefined);
      assertEquals(logger.calls.length, 0);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("logs once and returns undefined on malformed YAML", async () => {
    const dir = await Deno.makeTempDir();
    try {
      // Tab indentation produces a YAML parse error.
      await Deno.writeTextFile(
        join(dir, "002-state-diff.yaml"),
        "entries:\n\t- broken: [unterminated\n",
      );
      const logger = warnSpy();
      const result = await readStateDiff(dir, 2, logger);
      assertEquals(result, undefined);
      assertEquals(logger.calls.length, 1);
      assertEquals(logger.calls[0]?.data?.chapter, 2);
      assertEquals(logger.calls[0]?.data?.op, "read-state-diff");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("returns undefined for valid YAML without an entries array", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(dir, "003-state-diff.yaml"),
        "summary: nothing here\n",
      );
      const logger = warnSpy();
      const result = await readStateDiff(dir, 3, logger);
      assertEquals(result, undefined);
      assertEquals(logger.calls.length, 0);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  await t.step("works when no logger is provided", async () => {
    const dir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(
        join(dir, "004-state-diff.yaml"),
        "entries:\n\t- broken: [unterminated\n",
      );
      const result = await readStateDiff(dir, 4);
      assertEquals(result, undefined);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });
});
