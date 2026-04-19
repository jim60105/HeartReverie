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
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps, AppConfig, BuildPromptResult } from "../../../writer/types.ts";
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
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
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

function buildApp(tmpDir: string): Hono {
  const safePath = createSafePath(tmpDir);
  return createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
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
  name: "branch routes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmpDir = await Deno.makeTempDir({ prefix: "branch-test-" });
    Deno.env.set("PASSPHRASE", "test-pass");

    const srcDir = join(tmpDir, "series1", "story1");
    await Deno.mkdir(srcDir, { recursive: true });
    await Deno.writeTextFile(join(srcDir, "001.md"), "chapter one");
    await Deno.writeTextFile(join(srcDir, "002.md"), "chapter two");
    await Deno.writeTextFile(join(srcDir, "003.md"), "chapter three");
    await Deno.writeTextFile(join(srcDir, "001-state.yaml"), "state: one");
    await Deno.writeTextFile(join(srcDir, "001-state-diff.yaml"), "diff: one");
    await Deno.writeTextFile(join(srcDir, "002-state.yaml"), "state: two");
    await Deno.writeTextFile(join(srcDir, "003-state.yaml"), "state: three");
    await Deno.writeTextFile(join(srcDir, "current-status.yaml"), "current: source");

    // Story-scoped lore
    const loreDir = join(srcDir, "_lore");
    await Deno.mkdir(loreDir);
    await Deno.writeTextFile(join(loreDir, "passage.md"), "---\ntags: []\n---\nbody");

    // Series-scoped lore (must NOT be touched)
    const seriesLore = join(tmpDir, "series1", "_lore");
    await Deno.mkdir(seriesLore);
    await Deno.writeTextFile(join(seriesLore, "series-note.md"), "series-level");

    const app = buildApp(tmpDir);

    try {
      await t.step("branch with explicit newName copies chapters 1..fromChapter", async () => {
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 2, newName: "fork-a" },
        );
        assertEquals(res.status, 201);
        assertEquals(res.body.series, "series1");
        assertEquals(res.body.name, "fork-a");
        assertEquals(res.body.copiedChapters, [1, 2]);

        const destDir = join(tmpDir, "series1", "fork-a");
        assertEquals(await Deno.readTextFile(join(destDir, "001.md")), "chapter one");
        assertEquals(await Deno.readTextFile(join(destDir, "002.md")), "chapter two");
        // 003 must not be copied
        let found003 = false;
        try {
          await Deno.stat(join(destDir, "003.md"));
          found003 = true;
        } catch {
          // expected
        }
        assertEquals(found003, false);

        assertEquals(await Deno.readTextFile(join(destDir, "001-state.yaml")), "state: one");
        assertEquals(await Deno.readTextFile(join(destDir, "001-state-diff.yaml")), "diff: one");
        assertEquals(await Deno.readTextFile(join(destDir, "002-state.yaml")), "state: two");

        let found003State = false;
        try {
          await Deno.stat(join(destDir, "003-state.yaml"));
          found003State = true;
        } catch {
          // expected
        }
        assertEquals(found003State, false);

        let foundCurrentStatus = false;
        try {
          await Deno.stat(join(destDir, "current-status.yaml"));
          foundCurrentStatus = true;
        } catch {
          // expected
        }
        assertEquals(foundCurrentStatus, false);

        // Story-scoped lore copied
        const loreCopy = await Deno.readTextFile(join(destDir, "_lore", "passage.md"));
        assertEquals(loreCopy, "---\ntags: []\n---\nbody");

        // Series-scoped lore untouched (same file still exists only where it was)
        const seriesLoreCopy = await Deno.readTextFile(join(tmpDir, "series1", "_lore", "series-note.md"));
        assertEquals(seriesLoreCopy, "series-level");
      });

      await t.step("branch with auto-generated name succeeds", async () => {
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 1 },
        );
        assertEquals(res.status, 201);
        const name = res.body.name as string;
        if (!name.startsWith("story1-branch-")) {
          throw new Error(`Expected auto-generated name, got: ${name}`);
        }
      });

      await t.step("destination already exists returns 409", async () => {
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 2, newName: "fork-a" },
        );
        assertEquals(res.status, 409);
      });

      await t.step("invalid newName returns 400", async () => {
        const res1 = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 1, newName: "_forbidden" },
        );
        assertEquals(res1.status, 400);
        const res2 = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 1, newName: "bad/name" },
        );
        assertEquals(res2.status, 400);
        const res3 = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 1, newName: "" },
        );
        assertEquals(res3.status, 400);
      });

      await t.step("fromChapter out of range returns 400", async () => {
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 99, newName: "far" },
        );
        assertEquals(res.status, 400);
      });

      await t.step("non-positive fromChapter returns 400", async () => {
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 0, newName: "zero" },
        );
        assertEquals(res.status, 400);
      });

      await t.step("missing source story returns 404", async () => {
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/nope/branch",
          { fromChapter: 1, newName: "x" },
        );
        assertEquals(res.status, 404);
      });

      await t.step("malformed JSON returns 400", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/stories/series1/story1/branch", {
            method: "POST",
            headers: { "x-passphrase": "test-pass", "Content-Type": "application/json" },
            body: "{not json",
          }),
        );
        assertEquals(res.status, 400);
      });

      await t.step("object body is required", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/stories/series1/story1/branch", {
            method: "POST",
            headers: { "x-passphrase": "test-pass", "Content-Type": "application/json" },
            body: JSON.stringify("not-object"),
          }),
        );
        assertEquals(res.status, 400);
        assertEquals((await res.json()).detail, "Request body must be an object");
      });

      await t.step("newName must be string", async () => {
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story1/branch",
          { fromChapter: 1, newName: 123 as unknown as string },
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Field 'newName' must be a string");
      });

      await t.step("source path that is not a directory returns 404", async () => {
        await Deno.writeTextFile(join(tmpDir, "series1", "file-story"), "not a directory");
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/file-story/branch",
          { fromChapter: 1, newName: "copy-from-file" },
        );
        assertEquals(res.status, 404);
        assertEquals(res.body.detail, "Story not found");
      });

      await t.step("branch succeeds when source has no story-scoped lore", async () => {
        const srcNoLore = join(tmpDir, "series1", "story-no-lore");
        await Deno.mkdir(srcNoLore, { recursive: true });
        await Deno.writeTextFile(join(srcNoLore, "001.md"), "chapter one");
        const res = await makeRequest(
          app,
          "POST",
          "/api/stories/series1/story-no-lore/branch",
          { fromChapter: 1, newName: "fork-no-lore" },
        );
        assertEquals(res.status, 201);
        assertEquals(res.body.copiedChapters, [1]);
      });
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});
