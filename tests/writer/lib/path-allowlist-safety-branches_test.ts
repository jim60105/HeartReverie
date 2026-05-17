// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Branch coverage for writer/lib/path-allowlist.ts + writer/lib/path-safety.ts.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { dirname, join } from "@std/path";
import {
  getHardcodedPathRoots,
  intersectXPathRoots,
  resolveDisplayRoot,
  resolveDisplayRoots,
  validatePathValue,
} from "../../../writer/lib/path-allowlist.ts";
import {
  atomicWriteWithBackup,
  isPathContained,
  PathSafetyError,
} from "../../../writer/lib/path-safety.ts";

Deno.test("getHardcodedPathRoots: returns 3 templated roots", () => {
  const roots = getHardcodedPathRoots("my-plug");
  assertEquals(roots.length, 3);
  assert(roots[2]?.includes("my-plug"));
});

Deno.test("resolveDisplayRoot + resolveDisplayRoots: trim trailing slash", () => {
  const root = resolveDisplayRoot("/srv", "playground/lore/");
  assert(root.endsWith("playground/lore"));
  const list = resolveDisplayRoots(["playground/a/", "playground/b"], "/srv");
  assertEquals(list.length, 2);
});

Deno.test("intersectXPathRoots: null xPathRoots returns full hardcoded list", () => {
  const out = intersectXPathRoots(["a/", "b/"], null);
  assertEquals(out, ["a/", "b/"]);
});

Deno.test("intersectXPathRoots: respects user opt-in subset, normalises slash", () => {
  const out = intersectXPathRoots(["a/", "b/", "c/"], ["a", "c/"]);
  assertEquals(out, ["a/", "c/"]);
});

Deno.test("validatePathValue: empty string rejected", async () => {
  const r = await validatePathValue("", ["/tmp"], "/tmp");
  assert(!r.ok);
  if (!r.ok) assertEquals(r.reason, "empty");
});

Deno.test("validatePathValue: absolute path rejected", async () => {
  const r = await validatePathValue("/etc/passwd", ["/tmp"], "/tmp");
  assert(!r.ok);
  if (!r.ok) assertEquals(r.reason, "absolute");
});

Deno.test("validatePathValue: parent traversal rejected", async () => {
  const r = await validatePathValue("../etc", ["/tmp"], "/tmp");
  assert(!r.ok);
  if (!r.ok) assertEquals(r.reason, "parent-traversal");
});

Deno.test("validatePathValue: existing path inside root passes", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "pa-ok-" });
  try {
    const root = join(tmp, "playground", "lore");
    await Deno.mkdir(root, { recursive: true });
    const file = join(root, "x.md");
    await Deno.writeTextFile(file, "hi");
    const r = await validatePathValue("playground/lore/x.md", [root], tmp);
    assert(r.ok);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("validatePathValue: candidate ancestor resolved when leaf missing", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "pa-leaf-" });
  try {
    const root = join(tmp, "playground", "lore");
    await Deno.mkdir(root, { recursive: true });
    const r = await validatePathValue(
      "playground/lore/not-yet-created.md",
      [root],
      tmp,
    );
    assert(r.ok);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("validatePathValue: outside allowlist rejected", async () => {
  const tmp = await Deno.makeTempDir({ prefix: "pa-out-" });
  try {
    const root = join(tmp, "playground", "lore");
    const other = join(tmp, "elsewhere");
    await Deno.mkdir(root, { recursive: true });
    await Deno.mkdir(other, { recursive: true });
    const r = await validatePathValue("elsewhere/x.md", [root], tmp);
    assert(!r.ok);
    if (!r.ok) assertEquals(r.reason, "outside-allowlist");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("validatePathValue: nonexistent root falls back to lexical match", async () => {
  // Use a never-existing root path so the realPath() catch branch executes.
  const tmp = await Deno.makeTempDir({ prefix: "pa-no-root-" });
  try {
    const fakeRoot = join(tmp, "does-not-exist");
    // Place a real file outside fakeRoot; nothing should match.
    await Deno.writeTextFile(join(tmp, "x.md"), "hi");
    const r = await validatePathValue("x.md", [fakeRoot], tmp);
    assert(!r.ok);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("isPathContained: equal + descendant + sibling", () => {
  assert(isPathContained("/a/b", "/a/b"));
  assert(isPathContained("/a/b", "/a/b/c"));
  assert(!isPathContained("/a/b", "/a/bb"));
  assert(!isPathContained("/a/b", "/x"));
});

Deno.test("atomicWriteWithBackup: parent-missing when allowedBase absent", async () => {
  await assertRejects(
    () =>
      atomicWriteWithBackup(
        "/tmp/never-1/file.txt",
        "x",
        "/tmp/does-not-exist-allowed-base-xxx",
      ),
    PathSafetyError,
    "allowedBase does not exist",
  );
});

Deno.test("atomicWriteWithBackup: parent-missing when target dir absent", async () => {
  const base = await Deno.makeTempDir({ prefix: "aw-base-" });
  try {
    await assertRejects(
      () =>
        atomicWriteWithBackup(
          join(base, "no-such-dir", "file.txt"),
          "x",
          base,
        ),
      PathSafetyError,
      "target parent does not exist",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("atomicWriteWithBackup: containment violation when target outside base", async () => {
  const base = await Deno.makeTempDir({ prefix: "aw-cv-base-" });
  const outside = await Deno.makeTempDir({ prefix: "aw-cv-out-" });
  try {
    await assertRejects(
      () =>
        atomicWriteWithBackup(
          join(outside, "file.txt"),
          "x",
          base,
        ),
      PathSafetyError,
      "escapes allowed base",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("atomicWriteWithBackup: symlink target is rejected", async () => {
  const base = await Deno.makeTempDir({ prefix: "aw-sl-" });
  try {
    const real = join(base, "real.txt");
    const link = join(base, "link.txt");
    await Deno.writeTextFile(real, "real");
    await Deno.symlink(real, link);
    await assertRejects(
      () => atomicWriteWithBackup(link, "x", base),
      PathSafetyError,
      "refusing to write through symlink",
    );
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("atomicWriteWithBackup: writes new file (no backup)", async () => {
  const base = await Deno.makeTempDir({ prefix: "aw-new-" });
  try {
    const target = join(base, "new.txt");
    const r = await atomicWriteWithBackup(target, "hello", base);
    assertEquals(r.ok, true);
    assertEquals(r.backupPath, null);
    assertEquals(await Deno.readTextFile(target), "hello");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("atomicWriteWithBackup: existing target produces .bak", async () => {
  const base = await Deno.makeTempDir({ prefix: "aw-bak-" });
  try {
    const target = join(base, "x.txt");
    await Deno.writeTextFile(target, "v1");
    const r1 = await atomicWriteWithBackup(target, "v2", base);
    assertEquals(r1.backupPath, target + ".bak");
    assertEquals(await Deno.readTextFile(target), "v2");
    assertEquals(await Deno.readTextFile(target + ".bak"), "v1");

    // Second write rotates the old .bak to a timestamped name and replaces it.
    const r2 = await atomicWriteWithBackup(target, "v3", base);
    assertEquals(r2.backupPath, target + ".bak");
    assertEquals(await Deno.readTextFile(target + ".bak"), "v2");
    // At least one rotated backup file should exist.
    let rotated = 0;
    for await (const entry of Deno.readDir(dirname(target))) {
      if (entry.name.startsWith("x.txt.bak.")) rotated++;
    }
    assert(rotated >= 1, "expected timestamped rotated backup to exist");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
