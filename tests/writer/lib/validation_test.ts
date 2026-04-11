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
import { resolve } from "@std/path";
import { isValidParam, createSafePath } from "../../../writer/lib/middleware.ts";

Deno.test("isValidParam", async (t) => {
  await t.step("accepts simple valid strings", () => {
    assertEquals(isValidParam("hello"), true);
    assertEquals(isValidParam("my-story"), true);
    assertEquals(isValidParam("chapter_01"), true);
  });

  await t.step("rejects path traversal (..) patterns", () => {
    assertEquals(isValidParam(".."), false);
    assertEquals(isValidParam("../etc"), false);
    assertEquals(isValidParam("foo/../bar"), false);
  });

  await t.step("rejects null bytes", () => {
    assertEquals(isValidParam("foo\x00bar"), false);
  });

  await t.step("rejects forward slashes", () => {
    assertEquals(isValidParam("foo/bar"), false);
  });

  await t.step("rejects backslashes", () => {
    assertEquals(isValidParam("foo\\bar"), false);
  });

  await t.step("accepts empty string (no traversal pattern)", () => {
    assertEquals(isValidParam(""), true);
  });
});

Deno.test("safePath (via createSafePath)", async (t) => {
  const playgroundDir = "/fake/playground";
  const safePath = createSafePath(playgroundDir);

  await t.step("resolves valid paths correctly", () => {
    const result = safePath("series1", "story1");
    assertEquals(
      result,
      resolve(playgroundDir, "series1", "story1"),
    );
  });

  await t.step("returns null for traversal attempts", () => {
    assertEquals(safePath("..", "etc", "passwd"), null);
  });

  await t.step("returns null for absolute path escape", () => {
    assertEquals(safePath("/etc/passwd"), null);
  });

  await t.step("allows the base path itself", () => {
    const result = safePath();
    assertEquals(result, resolve(playgroundDir));
  });

  await t.step("resolves nested valid paths", () => {
    const result = safePath("a", "b", "c");
    assertEquals(result, resolve(playgroundDir, "a", "b", "c"));
  });
});
