// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later

import { assertEquals } from "@std/assert";
import { join } from "@std/path";
import { validateFrontendImports } from "../../../writer/lib/plugin-validators-frontend-imports.ts";
import type { PluginManifest } from "../../../writer/types.ts";

function manifest(
  frontendImports: unknown,
  name = "test-plugin",
): PluginManifest {
  return {
    name,
    version: "1.0.0",
    description: "test",
    type: "utility",
    // deno-lint-ignore no-explicit-any
    frontendImports: frontendImports as any,
  } as PluginManifest;
}

Deno.test("validateFrontendImports: returns [] when field is undefined", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await validateFrontendImports(manifest(undefined), dir);
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: returns [] when field is not an array", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await validateFrontendImports(
      manifest("frontend.js" as unknown),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: accepts existing sibling .js and normalizes ./ prefix", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, "helper.js"), "export {};");
    const result = await validateFrontendImports(
      manifest(["./helper.js"]),
      dir,
    );
    assertEquals(result, ["helper.js"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: deduplicates equivalent entries", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, "helper.js"), "export {};");
    const result = await validateFrontendImports(
      manifest(["./helper.js", "helper.js"]),
      dir,
    );
    assertEquals(result, ["helper.js"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects non-.js entries", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(join(dir, "evil.html"), "<html>");
    const result = await validateFrontendImports(
      manifest(["evil.html", "frontend.mjs"]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects absolute paths", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await validateFrontendImports(
      manifest(["/etc/passwd.js"]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects parent-traversal '..'", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await validateFrontendImports(
      manifest(["../escape.js"]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects backslash, hash, question, percent characters", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await validateFrontendImports(
      manifest([
        "dir\\helper.js",
        "helper.js#frag",
        "helper.js?q=1",
        "helper%2ejs",
      ]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects dotfile segments", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await validateFrontendImports(
      manifest([".hidden.js", "sub/.env.js"]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects entries that do not exist on disk", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await validateFrontendImports(
      manifest(["missing.js"]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects entries that resolve to a directory", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(dir, "subdir.js"));
    const result = await validateFrontendImports(
      manifest(["subdir.js"]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects symlinks that escape the plugin directory", async () => {
  const outside = await Deno.makeTempDir();
  const dir = await Deno.makeTempDir();
  try {
    const target = join(outside, "evil.js");
    await Deno.writeTextFile(target, "/* outside */");
    try {
      await Deno.symlink(target, join(dir, "link.js"));
    } catch {
      // Symlink may be unsupported in the test environment — skip.
      return;
    }
    const result = await validateFrontendImports(
      manifest(["link.js"]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
    await Deno.remove(outside, { recursive: true });
  }
});

Deno.test("validateFrontendImports: nested subdirectory .js is accepted", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(join(dir, "sub"));
    await Deno.writeTextFile(join(dir, "sub", "helper.js"), "export {};");
    const result = await validateFrontendImports(
      manifest(["sub/helper.js"]),
      dir,
    );
    assertEquals(result, ["sub/helper.js"]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("validateFrontendImports: rejects empty string entry", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await validateFrontendImports(
      manifest(["", null, 42]),
      dir,
    );
    assertEquals(result, []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
