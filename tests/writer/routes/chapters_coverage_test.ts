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
    verifyPassphrase,
  } as AppDeps);
}

Deno.test({
  name: "chapter routes — additional coverage",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmpDir = await Deno.makeTempDir({ prefix: "chapters-cov-" });
    const previousPassphrase = Deno.env.get("PASSPHRASE");
    Deno.env.set("PASSPHRASE", "test-pass");
    const app = buildApp(tmpDir);

    try {
      // ── DELETE /chapters/last on existing-but-empty story → 404 (line 144) ──

      await t.step(
        "DELETE last → 404 when story dir exists but is empty",
        async () => {
          const dir = join(tmpDir, "empty-s", "empty-n");
          await Deno.mkdir(dir, { recursive: true });
          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/empty-s/empty-n/chapters/last",
          );
          assertEquals(res.status, 404);
          assertEquals(res.body.detail, "No chapters to delete");
        },
      );

      // ── Malformed state-diff.yaml: batch include=content tolerates it (lines 65-67) ──

      await t.step(
        "GET chapters?include=content tolerates malformed state-diff.yaml",
        async () => {
          const dir = join(tmpDir, "yaml-bad-s", "story");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "ch1");
          await Deno.writeTextFile(
            join(dir, "001-state-diff.yaml"),
            "::: not valid yaml :::\n  -- bad",
          );
          const res = await makeRequest(
            app,
            "GET",
            "/api/stories/yaml-bad-s/story/chapters?include=content",
          );
          assertEquals(res.status, 200);
          const rows = res.body as unknown as Array<Record<string, unknown>>;
          assertEquals(rows.length, 1);
          assertEquals(rows[0]!.number, 1);
          assertEquals(rows[0]!.content, "ch1");
          assertEquals(rows[0]!.stateDiff, undefined);
        },
      );

      await t.step(
        "GET chapters?include=content tolerates state-diff.yaml without entries[]",
        async () => {
          const dir = join(tmpDir, "yaml-noent-s", "story");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "ch1");
          await Deno.writeTextFile(
            join(dir, "001-state-diff.yaml"),
            "wrong_key: 1\n",
          );
          const res = await makeRequest(
            app,
            "GET",
            "/api/stories/yaml-noent-s/story/chapters?include=content",
          );
          assertEquals(res.status, 200);
          const rows = res.body as unknown as Array<Record<string, unknown>>;
          assertEquals(rows[0]!.stateDiff, undefined);
        },
      );

      // ── Malformed state-diff.yaml on single GET (lines 117-119) ──

      await t.step(
        "GET single chapter tolerates malformed state-diff.yaml",
        async () => {
          const dir = join(tmpDir, "yaml-bad-single", "story");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "single-ch");
          await Deno.writeTextFile(
            join(dir, "001-state-diff.yaml"),
            ":: invalid yaml ::",
          );
          const res = await makeRequest(
            app,
            "GET",
            "/api/stories/yaml-bad-single/story/chapters/1",
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.content, "single-ch");
          assertEquals(res.body.stateDiff, undefined);
        },
      );

      await t.step(
        "GET single chapter ignores state-diff missing entries field",
        async () => {
          const dir = join(tmpDir, "yaml-noent-single", "story");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "ch");
          await Deno.writeTextFile(
            join(dir, "001-state-diff.yaml"),
            "foo: bar\n",
          );
          const res = await makeRequest(
            app,
            "GET",
            "/api/stories/yaml-noent-single/story/chapters/1",
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.stateDiff, undefined);
        },
      );

      // ── PUT chapter: state cleanup loop must skip non-file entries (line 231) ──

      await t.step(
        "PUT chapter skips non-file entries during state cache invalidation",
        async () => {
          const dir = join(tmpDir, "put-subdir", "story");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "before");
          // Subdirectory whose name matches the state-yaml regex but is NOT a file
          await Deno.mkdir(join(dir, "002-state.yaml"), { recursive: true });
          await Deno.writeTextFile(join(dir, "002-state.yaml", "keep"), "k");

          const res = await makeRequest(
            app,
            "PUT",
            "/api/stories/put-subdir/story/chapters/1",
            { content: "after" },
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.content, "after");
          // The directory must still exist (was skipped, not removed)
          const stat = await Deno.stat(join(dir, "002-state.yaml"));
          assertEquals(stat.isDirectory, true);
        },
      );

      // ── DELETE /after: state cleanup loop must skip non-file entries (line 310) ──

      await t.step(
        "DELETE /chapters/after skips non-file entries during cleanup",
        async () => {
          const dir = join(tmpDir, "after-subdir", "story");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "a");
          await Deno.writeTextFile(join(dir, "002.md"), "b");
          // Make a directory whose name parses as a state file but should be skipped
          await Deno.mkdir(join(dir, "003-state.yaml"), { recursive: true });
          await Deno.writeTextFile(join(dir, "003-state.yaml", "k"), "k");

          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/after-subdir/story/chapters/after/1",
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.deleted, [2]);
          const stat = await Deno.stat(join(dir, "003-state.yaml"));
          assertEquals(stat.isDirectory, true);
        },
      );

      // ── isGenerationActive guard on PUT and DELETE-after ──

      await t.step(
        "PUT chapter 409 when generation active (revisited)",
        async () => {
          const { markGenerationActive, clearGenerationActive } = await import(
            "../../../writer/lib/generation-registry.ts"
          );
          const dir = join(tmpDir, "lock-s", "lock-n");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "x");
          markGenerationActive("lock-s", "lock-n");
          try {
            const res = await makeRequest(
              app,
              "PUT",
              "/api/stories/lock-s/lock-n/chapters/1",
              { content: "y" },
            );
            assertEquals(res.status, 409);
            assertEquals(
              res.body.detail,
              "Generation in progress for this story",
            );
          } finally {
            clearGenerationActive("lock-s", "lock-n");
          }
        },
      );

      // ── Auth guard on chapters routes ──

      await t.step("GET chapters without passphrase → 401", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/stories/x/y/chapters"),
        );
        assertEquals(res.status, 401);
      });

      // ── 500 catch-alls via deterministic filesystem errors ──

      await t.step(
        "GET chapters?include=content with chapter path as directory → 500",
        async () => {
          const dir = join(tmpDir, "dir-s", "dir-n");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.mkdir(join(dir, "001.md"));
          const res = await makeRequest(
            app,
            "GET",
            "/api/stories/dir-s/dir-n/chapters?include=content",
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to list chapters");
        },
      );

      await t.step("GET chapter when file is a directory → 500", async () => {
        const dir = join(tmpDir, "rdfail", "rdfail");
        await Deno.mkdir(dir, { recursive: true });
        // Create 001.md as a directory so readTextFile fails with non-NotFound
        await Deno.mkdir(join(dir, "001.md"));
        const res = await makeRequest(
          app,
          "GET",
          "/api/stories/rdfail/rdfail/chapters/1",
        );
        assertEquals(res.status, 500);
        assertEquals(res.body.detail, "Failed to read chapter");
      });

      await t.step(
        "DELETE last chapter on non-empty directory → 500",
        async () => {
          const dir = join(tmpDir, "del500", "del500");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.mkdir(join(dir, "001.md"));
          await Deno.writeTextFile(join(dir, "001.md", "child"), "x");
          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/del500/del500/chapters/last",
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to delete chapter");
        },
      );

      await t.step("PUT chapter over directory path → 500", async () => {
        const dir = join(tmpDir, "put500", "put500");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.mkdir(join(dir, "001.md"));
        const res = await makeRequest(
          app,
          "PUT",
          "/api/stories/put500/put500/chapters/1",
          { content: "new" },
        );
        assertEquals(res.status, 500);
        assertEquals(res.body.detail, "Failed to write chapter");
      });

      await t.step(
        "DELETE rewind on non-empty directory chapter → 500",
        async () => {
          const dir = join(tmpDir, "rw500", "rw500");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.writeTextFile(join(dir, "001.md"), "a");
          await Deno.mkdir(join(dir, "002.md"));
          await Deno.writeTextFile(join(dir, "002.md", "child"), "b");
          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/rw500/rw500/chapters/after/1",
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to delete chapters");
        },
      );

      await t.step(
        "POST init when dirPath collides with regular file → 500",
        async () => {
          // Pre-create the destination as a file so mkdir fails
          await Deno.mkdir(join(tmpDir, "init500"), { recursive: true });
          await Deno.writeTextFile(
            join(tmpDir, "init500", "init500"),
            "blocking-file",
          );
          const res = await makeRequest(
            app,
            "POST",
            "/api/stories/init500/init500/init",
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to initialize story");
        },
      );

      await t.step(
        "PUT chapter when stat fails (parent path is a file) → 500",
        async () => {
          await Deno.mkdir(join(tmpDir, "stat500"), { recursive: true });
          await Deno.writeTextFile(join(tmpDir, "stat500", "stat500"), "x");
          const res = await makeRequest(
            app,
            "PUT",
            "/api/stories/stat500/stat500/chapters/1",
            { content: "y" },
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to stat chapter");
        },
      );

      await t.step(
        "DELETE rewind when stat fails (series path is a file) → 500",
        async () => {
          const series = "rwstat";
          await Deno.writeTextFile(join(tmpDir, series), "not a directory");
          const res = await makeRequest(
            app,
            "DELETE",
            `/api/stories/${series}/rwstat/chapters/after/0`,
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to access story");
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
