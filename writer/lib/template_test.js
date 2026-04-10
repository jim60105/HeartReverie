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

import { assertEquals, assertMatch } from "@std/assert";
import { validateTemplate } from "./template.js";

Deno.test("validateTemplate", async (t) => {
  await t.step("safe expressions accepted", async (t) => {
    await t.step("allows simple variable", () => {
      assertEquals(validateTemplate("{{ variable }}"), []);
    });

    await t.step("allows for-of loop", () => {
      assertEquals(
        validateTemplate("{{ for x of items }}body{{ /for }}"),
        [],
      );
    });

    await t.step("allows if condition", () => {
      assertEquals(
        validateTemplate("{{ if condition }}body{{ /if }}"),
        [],
      );
    });

    await t.step("allows pipe filters", () => {
      assertEquals(
        validateTemplate("{{ variable |> filter }}"),
        [],
      );
    });

    await t.step("rejects includes (file-inclusion vector)", () => {
      const errors = validateTemplate('{{ > "path" }}');
      assertEquals(errors.length, 1);
    });

    await t.step("allows comments", () => {
      assertEquals(
        validateTemplate("{{ # this is a comment }}"),
        [],
      );
    });

    await t.step("allows else", () => {
      assertEquals(
        validateTemplate("{{ if x }}a{{ else }}b{{ /if }}"),
        [],
      );
    });
  });

  await t.step("unsafe expressions rejected", async (t) => {
    await t.step("rejects process.env access", () => {
      const errors = validateTemplate("{{ process.env.SECRET }}");
      assertEquals(errors.length, 1);
      assertMatch(errors[0], /Unsafe template expression/);
    });

    await t.step("rejects require calls", () => {
      const errors = validateTemplate("{{ require('fs') }}");
      assertEquals(errors.length, 1);
    });

    await t.step("rejects constructor chain", () => {
      const errors = validateTemplate(
        "{{ constructor.constructor('return this')() }}",
      );
      assertEquals(errors.length, 1);
    });
  });

  await t.step("edge cases", async (t) => {
    await t.step("returns no errors for empty template", () => {
      assertEquals(validateTemplate(""), []);
    });

    await t.step("returns no errors for template with no tags", () => {
      assertEquals(
        validateTemplate("Hello world, no template tags here!"),
        [],
      );
    });
  });
});
