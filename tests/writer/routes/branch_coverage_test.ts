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
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import {
  createSafePath,
  verifyPassphrase,
} from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type { Hono } from "@hono/hono";
import type {
  AppConfig,
  AppDeps,
  BuildPromptResult,
} from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

async function makeRequest(
  app: Hono,
  method: string,
  urlPath: string,
  body?: Record<string, unknown> | null,
) {
  const init: RequestInit = {
    method,
    headers: { "x-passphrase": "test-pass" },
  };
  if (body) {
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${urlPath}`, init));
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed as Record<string, unknown> };
}

function buildApp(playgroundDir: string): Hono {
  const safePath = createSafePath(playgroundDir);
  return createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: playgroundDir,
      ROOT_DIR: "/nonexistent-root",
    } as unknown as AppConfig,
    safePath,
    pluginManager: {
      getPlugins: () => [],
      getParameters: () => [],
      getPluginDir: () => null,
      getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
    buildContinuePromptFromStory: (async () => ({ messages: [], ventoError: null, targetChapterNumber: 0, existingContent: "", userMessageText: "", assistantPrefill: "" })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
    verifyPassphrase,
  } as AppDeps);
}

Deno.test({
  name: "branch routes — additional coverage",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmpDir = await Deno.makeTempDir({ prefix: "branch-cov-" });
    const previousPassphrase = Deno.env.get("PASSPHRASE");
    Deno.env.set("PASSPHRASE", "test-pass");
    const app = buildApp(tmpDir);

    try {
      // ── _lore subdirectory: copyDirRecursive recurses into directories (lines 39-41) ──

      await t.step(
        "branch copies nested _lore subdirectory entries",
        async () => {
          const src = join(tmpDir, "rec", "src");
          await Deno.mkdir(src, { recursive: true });
          await Deno.writeTextFile(join(src, "001.md"), "ch1");
          await Deno.mkdir(join(src, "_lore", "characters"), {
            recursive: true,
          });
          await Deno.writeTextFile(
            join(src, "_lore", "top.md"),
            "---\ntags: []\n---\ntop",
          );
          await Deno.writeTextFile(
            join(src, "_lore", "characters", "hero.md"),
            "---\ntags: [hero]\n---\nbrave",
          );

          const res = await makeRequest(
            app,
            "POST",
            "/api/stories/rec/src/branch",
            { fromChapter: 1, newName: "rec-fork" },
          );
          assertEquals(res.status, 201);

          const dst = join(tmpDir, "rec", "rec-fork");
          const top = await Deno.readTextFile(join(dst, "_lore", "top.md"));
          assertEquals(top.includes("top"), true);
          const hero = await Deno.readTextFile(
            join(dst, "_lore", "characters", "hero.md"),
          );
          assertEquals(hero.includes("brave"), true);
        },
      );

      // ── Symlinks in _lore are skipped (line 36) ──

      await t.step("branch skips symlink entries in _lore", async () => {
        const src = join(tmpDir, "sym", "src");
        await Deno.mkdir(join(src, "_lore"), { recursive: true });
        await Deno.writeTextFile(join(src, "001.md"), "ch1");
        await Deno.writeTextFile(
          join(src, "_lore", "real.md"),
          "---\ntags: []\n---\nreal",
        );
        // Create an external file then symlink to it from inside _lore
        const externalFile = join(tmpDir, "external-target.md");
        await Deno.writeTextFile(externalFile, "EXTERNAL");
        try {
          await Deno.symlink(externalFile, join(src, "_lore", "link.md"));
        } catch {
          // Some filesystems may reject; treat as skip
          return;
        }

        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/sym/src/branch",
          { fromChapter: 1, newName: "sym-fork" },
        );
        assertEquals(res.status, 201);

        const dst = join(tmpDir, "sym", "sym-fork");
        const real = await Deno.readTextFile(join(dst, "_lore", "real.md"));
        assertEquals(real.includes("real"), true);
        // Symlink must NOT have been copied
        let foundLink = true;
        try {
          await Deno.lstat(join(dst, "_lore", "link.md"));
        } catch {
          foundLink = false;
        }
        assertEquals(foundLink, false);
      });

      // ── Chapter gap: missing chapter numbers are skipped (line 147) ──

      await t.step(
        "branch with chapter gap copies only existing chapters in 1..fromChapter",
        async () => {
          const src = join(tmpDir, "gap", "src");
          await Deno.mkdir(src, { recursive: true });
          // Create only chapter 1 and 3 — gap at 2
          await Deno.writeTextFile(join(src, "001.md"), "one");
          await Deno.writeTextFile(join(src, "003.md"), "three");

          const res = await makeRequest(
            app,
            "POST",
            "/api/stories/gap/src/branch",
            { fromChapter: 3, newName: "gap-fork" },
          );
          assertEquals(res.status, 201);
          assertEquals(res.body.copiedChapters, [1, 3]);

          const dst = join(tmpDir, "gap", "gap-fork");
          assertEquals(await Deno.readTextFile(join(dst, "001.md")), "one");
          assertEquals(await Deno.readTextFile(join(dst, "003.md")), "three");
          let has2 = true;
          try {
            await Deno.stat(join(dst, "002.md"));
          } catch {
            has2 = false;
          }
          assertEquals(has2, false);
        },
      );

      // ── Auth guard ──

      await t.step("POST branch without passphrase → 401", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/stories/x/y/branch", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fromChapter: 1 }),
          }),
        );
        assertEquals(res.status, 401);
      });

      // ── fromChapter type guards ──

      await t.step("fromChapter must be a number → 400", async () => {
        const src = join(tmpDir, "type", "src");
        await Deno.mkdir(src, { recursive: true });
        await Deno.writeTextFile(join(src, "001.md"), "x");
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/type/src/branch",
          {
            fromChapter: "1",
          },
        );
        assertEquals(res.status, 400);
      });

      await t.step("fromChapter must be integer → 400", async () => {
        const src = join(tmpDir, "frac", "src");
        await Deno.mkdir(src, { recursive: true });
        await Deno.writeTextFile(join(src, "001.md"), "x");
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/frac/src/branch",
          {
            fromChapter: 1.5,
          },
        );
        assertEquals(res.status, 400);
      });

      // ── Branching from a story with zero chapter files ──

      await t.step(
        "branch on story dir with zero chapter files → 400 'exceeds highest existing'",
        async () => {
          const src = join(tmpDir, "empty", "src");
          await Deno.mkdir(src, { recursive: true });
          const res = await makeRequest(
            app,
            "POST",
            "/api/stories/empty/src/branch",
            { fromChapter: 1, newName: "empty-fork" },
          );
          assertEquals(res.status, 400);
          assertEquals(
            (res.body.detail as string).includes("exceeds highest existing"),
            true,
          );
        },
      );

      // ── 500 catch-alls via deterministic filesystem errors ──

      await t.step(
        "POST branch when destination component is too long → 500",
        async () => {
          const series = "branch-long-name";
          const src = join(tmpDir, series, "src");
          await Deno.mkdir(src, { recursive: true });
          await Deno.writeTextFile(join(src, "001.md"), "x");
          const res = await makeRequest(
            app,
            "POST",
            `/api/stories/${series}/src/branch`,
            { fromChapter: 1, newName: "x".repeat(300) },
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to create destination story");
        },
      );

      await t.step(
        "POST branch when source chapter path is a directory → 500 + cleanup",
        async () => {
          const series = "branch-copy-fail";
          const src = join(tmpDir, series, "src");
          await Deno.mkdir(src, { recursive: true });
          await Deno.mkdir(join(src, "001.md"));
          await Deno.writeTextFile(join(src, "001.md", "child"), "not a file");
          const res = await makeRequest(
            app,
            "POST",
            `/api/stories/${series}/src/branch`,
            { fromChapter: 1, newName: "dest" },
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to branch story");
          // Best-effort cleanup deleted destDir.
          const destStat = await Deno.stat(join(tmpDir, series, "dest"))
            .then(() => true)
            .catch(() => false);
          assertEquals(destStat, false);
        },
      );
    } finally {
      if (previousPassphrase === undefined) {
        Deno.env.delete("PASSPHRASE");
      } else {
        Deno.env.set("PASSPHRASE", previousPassphrase);
      }
      // Best-effort: restore perms before recursive removal
      async function fixPerms(p: string): Promise<void> {
        try {
          await Deno.chmod(p, 0o755);
          for await (const e of Deno.readDir(p)) {
            await fixPerms(join(p, e.name));
          }
        } catch { /* not a dir or already removed */ }
      }
      await fixPerms(tmpDir);
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});
