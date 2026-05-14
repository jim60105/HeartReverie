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

import { assertEquals, assert as assertTrue, assertThrows } from "@std/assert";
import { PIPELINE_FIELDS } from "../../../writer/lib/hook-pipeline-fields.ts";

Deno.test("PIPELINE_FIELDS — required entries are present", () => {
  const keys = new Set(PIPELINE_FIELDS.map((p) => `${p.stage}::${p.field}`));
  assertTrue(keys.has("response-stream::chunk"));
  assertTrue(keys.has("chat:send:before::message"));
  assertTrue(keys.has("prompt-assembly::previousContext"));
});

Deno.test("PIPELINE_FIELDS — frozen at array and entry level", () => {
  assertTrue(Object.isFrozen(PIPELINE_FIELDS));
  for (const entry of PIPELINE_FIELDS) {
    assertTrue(Object.isFrozen(entry));
  }
  assertThrows(() => {
    // deno-lint-ignore no-explicit-any
    (PIPELINE_FIELDS as any).push({ stage: "x", field: "y" });
  });
});

Deno.test("PIPELINE_FIELDS — no duplicate (stage,field) pairs", () => {
  const pairs = PIPELINE_FIELDS.map((p) => `${p.stage}::${p.field}`);
  assertEquals(pairs.length, new Set(pairs).size);
});
