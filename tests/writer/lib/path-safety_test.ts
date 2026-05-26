// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import {
  atomicWriteWithBackup,
  isPathContained,
  PathSafetyError,
} from "../../../writer/lib/path-safety.ts";

Deno.test("isPathContained: same path", () => {
  assertEquals(isPathContained("/a/b", "/a/b"), true);
});

Deno.test("isPathContained: child", () => {
  assertEquals(isPathContained("/a/b", "/a/b/c"), true);
});

Deno.test("isPathContained: sibling rejected", () => {
  assertEquals(isPathContained("/a/b", "/a/bb"), false);
});

Deno.test("isPathContained: traversal rejected", () => {
  // Note: helper is lexical only; callers must resolve first.
  assertEquals(isPathContained("/a/b", "/a/c"), false);
});

Deno.test("atomicWriteWithBackup: writes new file with no backup", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const target = join(tmp, "system.md");
    const r = await atomicWriteWithBackup(target, "hello world", tmp);
    assert(r.ok);
    assertEquals(r.backupPath, null);
    assertEquals(await Deno.readTextFile(target), "hello world");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("atomicWriteWithBackup: rotates .bak on overwrite", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const target = join(tmp, "system.md");
    await Deno.writeTextFile(target, "v1");
    const r1 = await atomicWriteWithBackup(target, "v2", tmp);
    assertEquals(r1.backupPath, target + ".bak");
    assertEquals(await Deno.readTextFile(target + ".bak"), "v1");
    assertEquals(await Deno.readTextFile(target), "v2");

    const r2 = await atomicWriteWithBackup(target, "v3", tmp);
    // `.bak` always holds the most recent previous content; the older
    // backup is rotated to `.bak.<ts>`.
    assertEquals(r2.backupPath, target + ".bak");
    assertEquals(await Deno.readTextFile(target + ".bak"), "v2");
    // The timestamped backup should also exist with the older content.
    let foundOlder = false;
    for await (const entry of Deno.readDir(tmp)) {
      if (entry.name.startsWith("system.md.bak.")) {
        foundOlder = true;
        assertEquals(
          await Deno.readTextFile(join(tmp, entry.name)),
          "v1",
        );
      }
    }
    assert(foundOlder, "expected a .bak.<ts> rotation");
    assertEquals(await Deno.readTextFile(target), "v3");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("atomicWriteWithBackup: rejects symlink target", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const realFile = join(tmp, "real.md");
    await Deno.writeTextFile(realFile, "original");
    const linkPath = join(tmp, "link.md");
    await Deno.symlink(realFile, linkPath);

    await assertRejects(
      () => atomicWriteWithBackup(linkPath, "new", tmp),
      PathSafetyError,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("atomicWriteWithBackup: rejects target outside allowedBase", async () => {
  const tmp = await Deno.makeTempDir();
  const outside = await Deno.makeTempDir();
  try {
    const target = join(outside, "escaped.md");
    await assertRejects(
      () => atomicWriteWithBackup(target, "x", tmp),
      PathSafetyError,
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});
