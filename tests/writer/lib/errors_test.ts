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
import { problemJson, buildVentoError } from "../../../writer/lib/errors.ts";

Deno.test("problemJson", async (t) => {
  await t.step("generates correct RFC 9457 structure", () => {
    const result = problemJson("Not Found", 404, "Resource not found");
    assertEquals(result, {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Resource not found",
    });
  });

  await t.step("merges extra fields", () => {
    const result = problemJson("Bad Request", 400, "Invalid input", {
      field: "email",
    });
    assertEquals(result.type, "about:blank");
    assertEquals(result.title, "Bad Request");
    assertEquals(result.status, 400);
    assertEquals(result.detail, "Invalid input");
    assertEquals(result.field, "email");
  });

  await t.step("works with empty extra", () => {
    const result = problemJson("OK", 200, "Success");
    assertEquals(Object.keys(result).length, 4);
  });
});

Deno.test("buildVentoError", async (t) => {
  await t.step("extracts line number from error message", () => {
    const err = new Error("Something failed at line 42");
    const result = buildVentoError(err, "/path/to/template.md", {
      variables: {},
    });
    assertEquals(result.line, 42);
    assertEquals(result.source, "template.md");
  });

  await t.step("generates variable suggestion for undefined variable", () => {
    const err = new Error("Variable 'series_nme' is not defined");
    const result = buildVentoError(err, "/path/to/system.md", {
      variables: {},
    });
    assertEquals(result.suggestion, "Did you mean 'series_name'?");
  });

  await t.step("handles missing line info", () => {
    const err = new Error("Some generic error");
    const result = buildVentoError(err, "/path/to/template.md", {
      variables: {},
    });
    assertEquals(result.line, null);
  });

  await t.step("sets type and stage correctly", () => {
    const err = new Error("test");
    const result = buildVentoError(err, "/path/to/file.md", {
      variables: {},
    });
    assertEquals(result.type, "vento-error");
    assertEquals(result.stage, "prompt-assembly");
  });

  await t.step("returns null suggestion when no close match", () => {
    const err = new Error("Variable 'xyzabc' is not defined");
    const result = buildVentoError(err, "/path/to/file.md", {
      variables: {},
    });
    assertEquals(result.suggestion, null);
  });
});
