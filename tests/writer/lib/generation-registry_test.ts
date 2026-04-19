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
import {
  clearGenerationActive,
  isGenerationActive,
  markGenerationActive,
} from "../../../writer/lib/generation-registry.ts";

Deno.test("generation-registry: single mark/clear toggles active state", () => {
  assertEquals(isGenerationActive("s", "n"), false);
  markGenerationActive("s", "n");
  assertEquals(isGenerationActive("s", "n"), true);
  clearGenerationActive("s", "n");
  assertEquals(isGenerationActive("s", "n"), false);
});

Deno.test("generation-registry: refcount tracks overlapping generations", () => {
  markGenerationActive("s", "overlap");
  markGenerationActive("s", "overlap");
  assertEquals(isGenerationActive("s", "overlap"), true);

  // First clear decrements but keeps active because of second mark.
  clearGenerationActive("s", "overlap");
  assertEquals(isGenerationActive("s", "overlap"), true);

  clearGenerationActive("s", "overlap");
  assertEquals(isGenerationActive("s", "overlap"), false);
});

Deno.test("generation-registry: clear on absent key is a no-op", () => {
  clearGenerationActive("s", "absent");
  assertEquals(isGenerationActive("s", "absent"), false);
});

Deno.test("generation-registry: keys are scoped by series and name", () => {
  markGenerationActive("series-a", "story");
  assertEquals(isGenerationActive("series-a", "story"), true);
  assertEquals(isGenerationActive("series-b", "story"), false);
  clearGenerationActive("series-a", "story");
});
