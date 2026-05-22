// Regression tests for two findings from the final rubber-duck review:
//   1. Symlink escape: a candidate inside an allowed root that is a symlink
//      to a target OUTSIDE the root must NOT pass `validatePathValue`.
//   2. Hidden-field diff exclusion: `computeHiddenPaths` correctly returns
//      paths whose `x-show-when` evaluates false against the submitted body,
//      so they can be removed from the actualDiff before unioning into the
//      blocking scope.

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import {
  validatePathValue,
} from "../../../writer/lib/path-allowlist.ts";
import {
  computeHiddenPaths,
  excludeHiddenFromDiff,
} from "../../../writer/lib/settings-diff.ts";

Deno.test("path-allowlist: symlink to outside the root is rejected", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "hr-allowlist-" });
  try {
    const lore = join(tmp, "playground", "lore");
    await Deno.mkdir(lore, { recursive: true });

    // Sibling target outside the lore root.
    const outside = join(tmp, "outside.txt");
    await Deno.writeTextFile(outside, "leak");

    // Place a symlink inside lore that points outside.
    const link = join(lore, "escape");
    await Deno.symlink(outside, link);

    const res = await validatePathValue(
      "playground/lore/escape",
      [lore],
      tmp,
    );
    assertEquals(res.ok, false, "symlink escape must be rejected");
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("path-allowlist: non-symlink path under the root is accepted", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "hr-allowlist-" });
  try {
    const lore = join(tmp, "playground", "lore");
    await Deno.mkdir(lore, { recursive: true });
    await Deno.writeTextFile(join(lore, "scene.md"), "x");

    const res = await validatePathValue(
      "playground/lore/scene.md",
      [lore],
      tmp,
    );
    assertEquals(res.ok, true);
  } finally {
    await Deno.remove(tmp, { recursive: true }).catch(() => {});
  }
});

Deno.test("computeHiddenPaths: x-show-when false hides the field", () => {
  const schema = {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["a", "b"] },
      detail: {
        type: "string",
        "x-show-when": { field: "mode", equals: "b" },
      },
    },
  };
  assertEquals(computeHiddenPaths(schema, { mode: "a", detail: "x" }), [
    "detail",
  ]);
  assertEquals(computeHiddenPaths(schema, { mode: "b", detail: "x" }), []);
});

Deno.test("computeHiddenPaths: notEquals and in operators", () => {
  const schema = {
    type: "object",
    properties: {
      mode: { type: "string" },
      a: { type: "string", "x-show-when": { field: "mode", notEquals: "x" } },
      b: {
        type: "string",
        "x-show-when": { field: "mode", in: ["y", "z"] },
      },
    },
  };
  assertEquals(
    computeHiddenPaths(schema, { mode: "x" }).sort(),
    ["a", "b"].sort(),
  );
  assertEquals(computeHiddenPaths(schema, { mode: "y" }), []);
});

Deno.test("excludeHiddenFromDiff filters at-and-under hidden paths", () => {
  const diff = ["detail", "detail.sub", "other", "deep[0]"];
  assertEquals(excludeHiddenFromDiff(diff, ["detail"]), ["other", "deep[0]"]);
  assertEquals(excludeHiddenFromDiff(diff, []), diff);
});
