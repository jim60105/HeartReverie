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
import {
  appendUsage,
  buildRecord,
  computeTotals,
  readUsage,
  USAGE_BACKUP_FILENAME,
  USAGE_FILENAME,
} from "../../../writer/lib/usage.ts";

function makeRecord(chapter: number, prompt: number, completion: number): ReturnType<typeof buildRecord> {
  return buildRecord({
    chapter,
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: prompt + completion,
    model: "test-model",
  });
}

Deno.test({
  name: "usage lib",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await t.step("readUsage returns [] when file is absent", async () => {
      const dir = await Deno.makeTempDir({ prefix: "usage-missing-" });
      try {
        assertEquals(await readUsage(dir), []);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    await t.step("readUsage returns [] on malformed JSON (no backup written)", async () => {
      const dir = await Deno.makeTempDir({ prefix: "usage-bad-" });
      try {
        await Deno.writeTextFile(join(dir, USAGE_FILENAME), "{not-json");
        const out = await readUsage(dir);
        assertEquals(out, []);
        // readUsage must not create a backup
        try {
          await Deno.stat(join(dir, USAGE_BACKUP_FILENAME));
          throw new Error("backup should not exist");
        } catch (err) {
          if (!(err instanceof Deno.errors.NotFound)) throw err;
        }
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    await t.step("round-trip appendUsage then readUsage", async () => {
      const dir = await Deno.makeTempDir({ prefix: "usage-rt-" });
      try {
        const rec = makeRecord(1, 10, 5);
        await appendUsage(dir, rec);
        const out = await readUsage(dir);
        assertEquals(out.length, 1);
        assertEquals(out[0]!.chapter, 1);
        assertEquals(out[0]!.promptTokens, 10);
        assertEquals(out[0]!.completionTokens, 5);
        assertEquals(out[0]!.totalTokens, 15);
        assertEquals(out[0]!.model, "test-model");
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    await t.step("computeTotals sums arithmetic", () => {
      const records = [
        makeRecord(1, 10, 5),
        makeRecord(2, 20, 7),
        makeRecord(3, 3, 4),
      ];
      const totals = computeTotals(records);
      assertEquals(totals, {
        promptTokens: 33,
        completionTokens: 16,
        totalTokens: 49,
        count: 3,
      });
    });

    await t.step("5 concurrent appendUsage calls serialise without loss", async () => {
      const dir = await Deno.makeTempDir({ prefix: "usage-concurrent-" });
      try {
        const tasks = [1, 2, 3, 4, 5].map((n) => appendUsage(dir, makeRecord(n, n * 10, n)));
        await Promise.all(tasks);
        const out = await readUsage(dir);
        assertEquals(out.length, 5);
        const chapters = out.map((r) => r.chapter).sort((a, b) => a - b);
        assertEquals(chapters, [1, 2, 3, 4, 5]);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    await t.step("malformed file is backed up and reset to one record", async () => {
      const dir = await Deno.makeTempDir({ prefix: "usage-bak-" });
      try {
        await Deno.writeTextFile(join(dir, USAGE_FILENAME), "not-valid-json");
        await appendUsage(dir, makeRecord(1, 1, 1));
        const backupExists = await Deno.stat(join(dir, USAGE_BACKUP_FILENAME));
        assertEquals(backupExists.isFile, true);
        const out = await readUsage(dir);
        assertEquals(out.length, 1);
        assertEquals(out[0]!.chapter, 1);
      } finally {
        await Deno.remove(dir, { recursive: true });
      }
    });

    await t.step("appendUsage swallows errors when story dir does not exist", async () => {
      // Target a non-existent directory; appendUsage must not throw.
      await appendUsage("/nonexistent-path-for-usage-test-xyz", makeRecord(1, 1, 1));
    });
  },
});
