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

import { assertEquals, assert as assertTrue } from "@std/assert";
import { levenshtein, findClosestMatch } from "../../../writer/lib/errors.ts";

Deno.test("levenshtein", async (t) => {
  await t.step("returns 0 for identical strings", () => {
    assertEquals(levenshtein("hello", "hello"), 0);
  });

  await t.step("returns 1 for single edit", () => {
    assertEquals(levenshtein("cat", "car"), 1);
  });

  await t.step("returns larger number for completely different strings", () => {
    const d = levenshtein("abc", "xyz");
    assertTrue(d > 1);
  });

  await t.step("handles empty strings", () => {
    assertEquals(levenshtein("", ""), 0);
    assertEquals(levenshtein("abc", ""), 3);
    assertEquals(levenshtein("", "abc"), 3);
  });

  await t.step("handles single character strings", () => {
    assertEquals(levenshtein("a", "b"), 1);
    assertEquals(levenshtein("a", "a"), 0);
  });
});

Deno.test("findClosestMatch", async (t) => {
  await t.step("returns exact match", () => {
    assertEquals(findClosestMatch("hello", ["hello", "world"]), "hello");
  });

  await t.step("returns close match within threshold", () => {
    assertEquals(findClosestMatch("scnario", ["scenario", "status"]), "scenario");
  });

  await t.step("returns null when no match within threshold", () => {
    assertEquals(
      findClosestMatch("xyz", ["abcdef", "ghijkl"]),
      null,
    );
  });

  await t.step("returns null for empty candidates", () => {
    assertEquals(findClosestMatch("hello", []), null);
  });

  await t.step("picks the closest among multiple candidates", () => {
    assertEquals(
      findClosestMatch("cat", ["car", "dog", "bat"]),
      "car",
    );
  });
});
