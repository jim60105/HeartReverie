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
  headers?: Record<string, string>,
) {
  const init: RequestInit = {
    method,
    headers: { "x-passphrase": "test-pass", ...headers },
  };
  if (body) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${urlPath}`, init));
  let parsed = null;
  try {
    parsed = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed, headers: Object.fromEntries(res.headers) };
}

Deno.test({ name: "chapter routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "chapters-test-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  // Create test story with chapters
  const storyDir = join(tmpDir, "series1", "story1");
  await Deno.mkdir(storyDir, { recursive: true });
  await Deno.writeTextFile(join(storyDir, "001.md"), "Chapter 1 content");
  await Deno.writeTextFile(join(storyDir, "002.md"), "Chapter 2 content");

  const safePath = createSafePath(tmpDir);
  const app = createApp({
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
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

  try {
    await t.step("GET /api/stories/:series/:name/chapters lists chapters", async () => {
      const res = await makeRequest(
        app,
        "GET",
        "/api/stories/series1/story1/chapters",
      );
      assertEquals(res.status, 200);
      assertEquals(res.body, [1, 2]);
    });

    await t.step("GET /api/stories/:series/:name/chapters/:number reads a chapter", async () => {
      const res = await makeRequest(
        app,
        "GET",
        "/api/stories/series1/story1/chapters/1",
      );
      assertEquals(res.status, 200);
      assertEquals(res.body.number, 1);
      assertEquals(res.body.content, "Chapter 1 content");
    });

    await t.step("GET /api/stories/:series/:name/chapters/:number returns 404 for nonexistent", async () => {
      const res = await makeRequest(
        app,
        "GET",
        "/api/stories/series1/story1/chapters/99",
      );
      assertEquals(res.status, 404);
    });

    await t.step("DELETE /api/stories/:series/:name/chapters/last deletes last chapter", async () => {
      const res = await makeRequest(
        app,
        "DELETE",
        "/api/stories/series1/story1/chapters/last",
      );
      assertEquals(res.status, 200);
      assertEquals(res.body.deleted, 2);

      // Verify chapter 2 was actually deleted
      const listRes = await makeRequest(
        app,
        "GET",
        "/api/stories/series1/story1/chapters",
      );
      assertEquals(listRes.body, [1]);
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
} });

Deno.test({ name: "chapter routes – additional coverage", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "chapters-test2-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  const safePath = createSafePath(tmpDir);
  const app = createApp({
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
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
    verifyPassphrase,
  } as AppDeps);

  /** Like makeRequest but returns raw text + headers (for non-JSON endpoints). */
  async function makeRawRequest(app: Hono, method: string, urlPath: string) {
    const res = await app.fetch(new Request(`http://localhost${urlPath}`, {
      method,
      headers: { "x-passphrase": "test-pass" },
    }));
    const text = await res.text();
    return { status: res.status, text, headers: Object.fromEntries(res.headers) };
  }

  try {
    // ── POST /init ──────────────────────────────────────────────────────

    await t.step("POST init creates story directory and 001.md", async () => {
      const res = await makeRequest(app, "POST", "/api/stories/newseries/newstory/init");
      assertEquals(res.status, 201);
      assertEquals(res.body.message, "Story initialized");

      // 001.md must exist and be empty
      const content = await Deno.readTextFile(join(tmpDir, "newseries", "newstory", "001.md"));
      assertEquals(content, "");
    });

    await t.step("POST init returns 200 when story already exists", async () => {
      // Story was created by the previous step
      const res = await makeRequest(app, "POST", "/api/stories/newseries/newstory/init");
      assertEquals(res.status, 200);
      assertEquals(res.body.message, "Story already exists");
    });

    // ── GET /status ─────────────────────────────────────────────────────

    await t.step("GET status returns current-status.yml when it exists", async () => {
      const storyDir = join(tmpDir, "s1", "n1");
      await Deno.mkdir(storyDir, { recursive: true });
      await Deno.writeTextFile(join(storyDir, "current-status.yml"), "status: current");

      const res = await makeRawRequest(app, "GET", "/api/stories/s1/n1/status");
      assertEquals(res.status, 200);
      assertEquals(res.headers["content-type"], "text/yaml");
      assertEquals(res.text, "status: current");
    });

    await t.step("GET status falls back to init-status.yml", async () => {
      // Create series dir with init-status.yml but no current-status.yml in story
      const seriesDir = join(tmpDir, "s2");
      const storyDir = join(seriesDir, "n2");
      await Deno.mkdir(storyDir, { recursive: true });
      await Deno.writeTextFile(join(seriesDir, "init-status.yml"), "status: init");

      const res = await makeRawRequest(app, "GET", "/api/stories/s2/n2/status");
      assertEquals(res.status, 200);
      assertEquals(res.headers["content-type"], "text/yaml");
      assertEquals(res.text, "status: init");
    });

    await t.step("GET status returns 404 when no status files exist", async () => {
      const storyDir = join(tmpDir, "s3", "n3");
      await Deno.mkdir(storyDir, { recursive: true });

      const res = await makeRequest(app, "GET", "/api/stories/s3/n3/status");
      assertEquals(res.status, 404);
    });

    // ── GET /chapters edge cases ────────────────────────────────────────

    await t.step("GET chapters returns 404 for nonexistent story", async () => {
      const res = await makeRequest(app, "GET", "/api/stories/no/such/chapters");
      assertEquals(res.status, 404);
    });

    await t.step("GET chapter with negative number returns 400", async () => {
      const res = await makeRequest(app, "GET", "/api/stories/s1/n1/chapters/-1");
      assertEquals(res.status, 400);
    });

    // ── DELETE /chapters/last edge cases ─────────────────────────────────

    await t.step("DELETE last chapter returns 404 when no chapters exist", async () => {
      // s3/n3 exists but has no .md files
      const res = await makeRequest(app, "DELETE", "/api/stories/s3/n3/chapters/last");
      assertEquals(res.status, 404);
    });

    await t.step("DELETE last chapter returns 404 for nonexistent story", async () => {
      const res = await makeRequest(app, "DELETE", "/api/stories/no/such/chapters/last");
      assertEquals(res.status, 404);
    });

    await t.step("DELETE when only one chapter succeeds", async () => {
      const oneChapDir = join(tmpDir, "s4", "n4");
      await Deno.mkdir(oneChapDir, { recursive: true });
      await Deno.writeTextFile(join(oneChapDir, "001.md"), "Only chapter");

      const res = await makeRequest(app, "DELETE", "/api/stories/s4/n4/chapters/last");
      assertEquals(res.status, 200);
      assertEquals(res.body.deleted, 1);

      // Verify file removed
      const entries = [];
      for await (const entry of Deno.readDir(oneChapDir)) {
        entries.push(entry.name);
      }
      const mdFiles = entries.filter((f) => /^\d+\.md$/.test(f));
      assertEquals(mdFiles.length, 0);
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
} });
