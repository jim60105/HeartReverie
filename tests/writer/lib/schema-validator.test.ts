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

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { validate } from "../../../writer/lib/schema-validator.ts";

function findErr(
  errs: { path: string; keyword: string }[],
  path: string,
  keyword: string,
): boolean {
  return errs.some((e) => e.path === path && e.keyword === keyword);
}

Deno.test("schema-validator: type — happy + failing", async () => {
  const schema = { type: "object", properties: { n: { type: "integer" } } };
  const ok = await validate(schema as Record<string, unknown>, { n: 5 });
  assertEquals(ok.errors, []);
  const bad = await validate(
    schema as Record<string, unknown>,
    { n: "five" },
  );
  assert(findErr(bad.errors, "n", "type"));
});

Deno.test("schema-validator: required — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: { a: { type: "string" } },
    required: ["a"],
  };
  const ok = await validate(schema as Record<string, unknown>, { a: "x" });
  assertEquals(ok.errors, []);
  const bad = await validate(schema as Record<string, unknown>, {});
  assert(findErr(bad.errors, "a", "required"));
});

Deno.test("schema-validator: enum — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: { c: { type: "string", enum: ["x", "y"] } },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { c: "x" })).errors,
    [],
  );
  const bad = await validate(schema as Record<string, unknown>, { c: "z" });
  assert(findErr(bad.errors, "c", "enum"));
});

Deno.test("schema-validator: const — happy + failing", async () => {
  const schema = { type: "object", properties: { c: { const: 42 } } };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { c: 42 })).errors,
    [],
  );
  const bad = await validate(schema as Record<string, unknown>, { c: 43 });
  assert(findErr(bad.errors, "c", "const"));
});

Deno.test("schema-validator: pattern — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: { id: { type: "string", pattern: "^[a-z]+$" } },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { id: "foo" })).errors,
    [],
  );
  const bad = await validate(schema as Record<string, unknown>, { id: "F1" });
  assert(findErr(bad.errors, "id", "pattern"));
});

Deno.test("schema-validator: minLength/maxLength — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: {
      s: { type: "string", minLength: 2, maxLength: 4 },
    },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { s: "abc" })).errors,
    [],
  );
  const tooShort = await validate(schema as Record<string, unknown>, { s: "a" });
  assert(findErr(tooShort.errors, "s", "minLength"));
  const tooLong = await validate(
    schema as Record<string, unknown>,
    { s: "abcde" },
  );
  assert(findErr(tooLong.errors, "s", "maxLength"));
});

Deno.test("schema-validator: minimum/maximum — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: { n: { type: "integer", minimum: 1, maximum: 10 } },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { n: 5 })).errors,
    [],
  );
  const lo = await validate(schema as Record<string, unknown>, { n: 0 });
  assert(findErr(lo.errors, "n", "minimum"));
  const hi = await validate(schema as Record<string, unknown>, { n: 11 });
  assert(findErr(hi.errors, "n", "maximum"));
});

Deno.test("schema-validator: exclusiveMinimum/exclusiveMaximum — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: {
      n: { type: "integer", exclusiveMinimum: 0, exclusiveMaximum: 10 },
    },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { n: 5 })).errors,
    [],
  );
  const lo = await validate(schema as Record<string, unknown>, { n: 0 });
  assert(findErr(lo.errors, "n", "exclusiveMinimum"));
  const hi = await validate(schema as Record<string, unknown>, { n: 10 });
  assert(findErr(hi.errors, "n", "exclusiveMaximum"));
});

Deno.test("schema-validator: multipleOf — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: { n: { type: "integer", multipleOf: 3 } },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { n: 9 })).errors,
    [],
  );
  const bad = await validate(schema as Record<string, unknown>, { n: 10 });
  assert(findErr(bad.errors, "n", "multipleOf"));
});

Deno.test("schema-validator: minItems/maxItems/uniqueItems — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: {
      a: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        maxItems: 3,
        uniqueItems: true,
      },
    },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { a: ["x", "y"] }))
      .errors,
    [],
  );
  assert(
    findErr(
      (await validate(schema as Record<string, unknown>, { a: [] })).errors,
      "a",
      "minItems",
    ),
  );
  assert(
    findErr(
      (await validate(schema as Record<string, unknown>, { a: ["1", "2", "3", "4"] }))
        .errors,
      "a",
      "maxItems",
    ),
  );
  assert(
    findErr(
      (await validate(schema as Record<string, unknown>, { a: ["x", "x"] }))
        .errors,
      "a",
      "uniqueItems",
    ),
  );
});

Deno.test("schema-validator: items recursion + items.enum", async () => {
  const schema = {
    type: "object",
    properties: {
      a: {
        type: "array",
        items: { type: "string", enum: ["red", "blue"] },
      },
    },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { a: ["red"] })).errors,
    [],
  );
  const bad = await validate(
    schema as Record<string, unknown>,
    { a: ["green"] },
  );
  assert(findErr(bad.errors, "a[0]", "enum"));
});

Deno.test("schema-validator: nested object properties recursion", async () => {
  const schema = {
    type: "object",
    properties: {
      outer: {
        type: "object",
        properties: {
          inner: { type: "string", minLength: 2 },
        },
      },
    },
  };
  const bad = await validate(
    schema as Record<string, unknown>,
    { outer: { inner: "x" } },
  );
  assert(findErr(bad.errors, "outer.inner", "minLength"));
});

Deno.test("schema-validator: additionalProperties false — happy + failing", async () => {
  const schema = {
    type: "object",
    properties: { a: { type: "string" } },
    additionalProperties: false,
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, { a: "x" })).errors,
    [],
  );
  const bad = await validate(
    schema as Record<string, unknown>,
    { a: "x", b: 1 },
  );
  assert(findErr(bad.errors, "b", "additionalProperties"));
});

Deno.test("schema-validator: format whitelist — color/url/email/uuid happy+fail", async () => {
  const schema = {
    type: "object",
    properties: {
      c: { type: "string", format: "color" },
      u: { type: "string", format: "url" },
      e: { type: "string", format: "email" },
      i: { type: "string", format: "uuid" },
    },
  };
  assertEquals(
    (await validate(schema as Record<string, unknown>, {
      c: "#aabbcc",
      u: "https://x.com",
      e: "a@b.co",
      i: "12345678-1234-1234-1234-1234567890ab",
    })).errors,
    [],
  );
  const bad = await validate(schema as Record<string, unknown>, {
    c: "red",
    u: "::::",
    e: "no-at",
    i: "nope",
  });
  for (const p of ["c", "u", "e", "i"]) {
    assert(findErr(bad.errors, p, "format"), `missing format error for ${p}`);
  }
});

Deno.test("schema-validator: unknown format is silently accepted", async () => {
  const schema = {
    type: "object",
    properties: { ip: { type: "string", format: "ipv4" } },
  };
  const ok = await validate(
    schema as Record<string, unknown>,
    { ip: "not-an-ip" },
  );
  assertEquals(ok.errors, []);
});

Deno.test("schema-validator: format path — accepts inside root, rejects outside", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "sv-path-" });
  await Deno.mkdir(join(tmp, "playground", "lore"), { recursive: true });
  await Deno.writeTextFile(
    join(tmp, "playground", "lore", "intro.md"),
    "x",
  );
  const schema = {
    type: "object",
    properties: { p: { type: "string", format: "path" } },
  };
  const hardcoded = [
    "playground/lore/",
    "playground/chapters/",
    "playground/_plugins/demo/",
  ];
  const absolute = [
    join(tmp, "playground", "lore"),
    join(tmp, "playground", "chapters"),
    join(tmp, "playground", "_plugins", "demo"),
  ];
  const opts = {
    projectRoot: tmp,
    hardcodedPathRoots: hardcoded,
    absolutePathRoots: absolute,
  };

  const ok = await validate(
    schema as Record<string, unknown>,
    { p: "playground/lore/intro.md" },
    opts,
  );
  assertEquals(ok.errors, []);

  const newFile = await validate(
    schema as Record<string, unknown>,
    { p: "playground/lore/new.md" },
    opts,
  );
  assertEquals(newFile.errors, [], "non-existent file under root should pass");

  const traversal = await validate(
    schema as Record<string, unknown>,
    { p: "../etc/passwd" },
    opts,
  );
  assert(findErr(traversal.errors, "p", "format"));
});

Deno.test("schema-validator: x-* and UI-only keywords are ignored", async () => {
  const schema = {
    type: "object",
    properties: {
      a: {
        type: "string",
        "x-show-when": { field: "mode", equals: "x" },
        "x-format": "secret",
        "x-options-url": "/api/x",
      },
    },
  };
  const ok = await validate(
    schema as Record<string, unknown>,
    { a: "anything" },
  );
  assertEquals(ok.errors, []);
});

Deno.test("schema-validator: JSON-Pointer-ish path for nested items", async () => {
  const schema = {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: { name: { type: "string", minLength: 2 } },
        },
      },
    },
  };
  const bad = await validate(
    schema as Record<string, unknown>,
    { items: [{ name: "ok" }, { name: "x" }] },
  );
  assert(findErr(bad.errors, "items[1].name", "minLength"));
});
