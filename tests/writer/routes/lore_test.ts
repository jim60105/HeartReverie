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
  body?: Record<string, unknown> | string | null,
  headers?: Record<string, string>,
) {
  const init: RequestInit = {
    method,
    headers: { "x-passphrase": "test-pass", ...headers },
  };
  if (body) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
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

function createTestApp(tmpDir: string): Hono {
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
    buildContinuePromptFromStory: (async () => ({ messages: [], ventoError: null, targetChapterNumber: 0, existingContent: "", userMessageText: "", assistantPrefill: "" })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
    verifyPassphrase,
  } as AppDeps);
}

function passageBody(
  tags: string[] = [],
  content = "Test content",
  priority = 0,
  enabled = true,
) {
  return { frontmatter: { tags, priority, enabled }, content };
}

Deno.test({ name: "lore routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "lore-test-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  const app = createTestApp(tmpDir);

  // Create lore directory structure
  await Deno.mkdir(join(tmpDir, "_lore"), { recursive: true });

  try {
    // ── CRUD Operations (global scope) ──────────────────────────────────

    await t.step("PUT creates a new global passage → 201", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/hero.md", passageBody(["characters"], "The hero is brave."));
      assertEquals(res.status, 201);
      assertEquals(res.body.message, "Passage created");
    });

    await t.step("PUT updates an existing global passage → 200", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/hero.md", passageBody(["characters"], "The hero is very brave.", 5));
      assertEquals(res.status, 200);
      assertEquals(res.body.message, "Passage updated");
    });

    await t.step("GET reads the created global passage with correct frontmatter and content", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/global/hero.md");
      assertEquals(res.status, 200);
      assertEquals(res.body.content, "The hero is very brave.");
      assertEquals(res.body.frontmatter.tags, ["characters"]);
      assertEquals(res.body.frontmatter.priority, 5);
      assertEquals(res.body.frontmatter.enabled, true);
    });

    await t.step("GET lists global passages", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/global");
      assertEquals(res.status, 200);
      assertEquals(Array.isArray(res.body), true);
      assertEquals(res.body.length, 1);
      assertEquals(res.body[0].filename, "hero.md");
      assertEquals(res.body[0].scope, "global");
      assertEquals(res.body[0].priority, 5);
      assertEquals(res.body[0].enabled, true);
    });

    await t.step("GET /api/lore/tags includes the passage's tags", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/tags");
      assertEquals(res.status, 200);
      assertEquals(Array.isArray(res.body), true);
      assertEquals(res.body.includes("characters"), true);
    });

    await t.step("DELETE removes the global passage → 204", async () => {
      const res = await makeRequest(app, "DELETE", "/api/lore/global/hero.md");
      assertEquals(res.status, 204);
    });

    await t.step("GET after delete → 404", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/global/hero.md");
      assertEquals(res.status, 404);
    });

    // ── Scope Variations: series ─────────────────────────────────────────

    await t.step("PUT creates a series passage → 201", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/series/mySeries/world.md", passageBody(["worldbuilding"], "The world is vast."));
      assertEquals(res.status, 201);
      assertEquals(res.body.message, "Passage created");
    });

    await t.step("GET reads the series passage", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/series/mySeries/world.md");
      assertEquals(res.status, 200);
      assertEquals(res.body.content, "The world is vast.");
      assertEquals(res.body.frontmatter.tags, ["worldbuilding"]);
    });

    await t.step("GET lists series passages", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/series/mySeries");
      assertEquals(res.status, 200);
      assertEquals(res.body.length, 1);
      assertEquals(res.body[0].filename, "world.md");
      assertEquals(res.body[0].scope, "series");
    });

    await t.step("DELETE removes the series passage → 204", async () => {
      const res = await makeRequest(app, "DELETE", "/api/lore/series/mySeries/world.md");
      assertEquals(res.status, 204);
    });

    await t.step("GET series passage after delete → 404", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/series/mySeries/world.md");
      assertEquals(res.status, 404);
    });

    // ── Scope Variations: story ──────────────────────────────────────────

    await t.step("PUT creates a story passage → 201", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/story/mySeries/myStory/npc.md", passageBody(["characters"], "An NPC."));
      assertEquals(res.status, 201);
      assertEquals(res.body.message, "Passage created");
    });

    await t.step("GET reads the story passage", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/story/mySeries/myStory/npc.md");
      assertEquals(res.status, 200);
      assertEquals(res.body.content, "An NPC.");
      assertEquals(res.body.frontmatter.tags, ["characters"]);
    });

    await t.step("GET lists story passages", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/story/mySeries/myStory");
      assertEquals(res.status, 200);
      assertEquals(res.body.length, 1);
      assertEquals(res.body[0].filename, "npc.md");
      assertEquals(res.body[0].scope, "story");
    });

    await t.step("DELETE removes the story passage → 204", async () => {
      const res = await makeRequest(app, "DELETE", "/api/lore/story/mySeries/myStory/npc.md");
      assertEquals(res.status, 204);
    });

    await t.step("GET story passage after delete → 404", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/story/mySeries/myStory/npc.md");
      assertEquals(res.status, 404);
    });

    // ── Tag Filtering ────────────────────────────────────────────────────

    await t.step("GET with ?tag= filter returns only matching passages", async () => {
      // Create two passages with different tags
      await makeRequest(app, "PUT", "/api/lore/global/alpha.md", passageBody(["lore"], "Alpha content."));
      await makeRequest(app, "PUT", "/api/lore/global/beta.md", passageBody(["history"], "Beta content."));

      const res = await makeRequest(app, "GET", "/api/lore/global?tag=lore");
      assertEquals(res.status, 200);
      assertEquals(res.body.length, 1);
      assertEquals(res.body[0].filename, "alpha.md");
    });

    await t.step("GET with ?tag= for non-existent tag returns empty array", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/global?tag=nonexistent");
      assertEquals(res.status, 200);
      assertEquals(res.body.length, 0);
    });

    // Clean up tag-filter passages
    await makeRequest(app, "DELETE", "/api/lore/global/alpha.md");
    await makeRequest(app, "DELETE", "/api/lore/global/beta.md");

    // ── GET /api/lore/tags across multiple scopes ────────────────────────

    await t.step("GET /api/lore/tags aggregates tags across all scopes", async () => {
      await makeRequest(app, "PUT", "/api/lore/global/g1.md", passageBody(["magic"], "Global magic."));
      await makeRequest(app, "PUT", "/api/lore/series/s1/s1p.md", passageBody(["technology"], "Series tech."));
      await makeRequest(app, "PUT", "/api/lore/story/s1/t1/sp.md", passageBody(["geography"], "Story geo."));

      const res = await makeRequest(app, "GET", "/api/lore/tags");
      assertEquals(res.status, 200);
      assertEquals(res.body.includes("magic"), true);
      assertEquals(res.body.includes("technology"), true);
      assertEquals(res.body.includes("geography"), true);
      // Tags should be sorted
      const sorted = [...res.body].sort();
      assertEquals(res.body, sorted);

      // Clean up
      await makeRequest(app, "DELETE", "/api/lore/global/g1.md");
      await makeRequest(app, "DELETE", "/api/lore/series/s1/s1p.md");
      await makeRequest(app, "DELETE", "/api/lore/story/s1/t1/sp.md");
    });

    await t.step("GET /api/lore/tags skips reserved platform directories during traversal", async () => {
      const reservedPassage = "---\ntags: [forbidden]\npriority: 0\nenabled: true\n---\n\nreserved";
      await Deno.mkdir(join(tmpDir, "lost+found", "_lore"), { recursive: true });
      await Deno.writeTextFile(join(tmpDir, "lost+found", "_lore", "x.md"), reservedPassage);
      await Deno.mkdir(join(tmpDir, "$RECYCLE.BIN", "_lore"), { recursive: true });
      await Deno.writeTextFile(join(tmpDir, "$RECYCLE.BIN", "_lore", "x.md"), reservedPassage);
      await Deno.mkdir(join(tmpDir, "System Volume Information", "_lore"), { recursive: true });
      await Deno.writeTextFile(join(tmpDir, "System Volume Information", "_lore", "x.md"), reservedPassage);
      await Deno.mkdir(join(tmpDir, ".Spotlight-V100", "_lore"), { recursive: true });
      await Deno.writeTextFile(join(tmpDir, ".Spotlight-V100", "_lore", "x.md"), reservedPassage);
      await Deno.mkdir(join(tmpDir, ".Trashes", "_lore"), { recursive: true });
      await Deno.writeTextFile(join(tmpDir, ".Trashes", "_lore", "x.md"), reservedPassage);
      await Deno.mkdir(join(tmpDir, ".fseventsd", "_lore"), { recursive: true });
      await Deno.writeTextFile(join(tmpDir, ".fseventsd", "_lore", "x.md"), reservedPassage);
      await Deno.mkdir(join(tmpDir, "normalSeries", "lost+found", "_lore"), { recursive: true });
      await Deno.writeTextFile(join(tmpDir, "normalSeries", "lost+found", "_lore", "x.md"), reservedPassage);
      await Deno.mkdir(join(tmpDir, "normalSeries", "$RECYCLE.BIN", "_lore"), { recursive: true });
      await Deno.writeTextFile(join(tmpDir, "normalSeries", "$RECYCLE.BIN", "_lore", "x.md"), reservedPassage);
      await Deno.mkdir(join(tmpDir, "normalSeries", "System Volume Information", "_lore"), {
        recursive: true,
      });
      await Deno.writeTextFile(
        join(tmpDir, "normalSeries", "System Volume Information", "_lore", "x.md"),
        reservedPassage,
      );
      await Deno.mkdir(join(tmpDir, "normalSeries", ".Spotlight-V100", "_lore"), { recursive: true });
      await Deno.writeTextFile(
        join(tmpDir, "normalSeries", ".Spotlight-V100", "_lore", "x.md"),
        reservedPassage,
      );
      await Deno.mkdir(join(tmpDir, "normalSeries", ".Trashes", "_lore"), { recursive: true });
      await Deno.writeTextFile(
        join(tmpDir, "normalSeries", ".Trashes", "_lore", "x.md"),
        reservedPassage,
      );
      await Deno.mkdir(join(tmpDir, "normalSeries", ".fseventsd", "_lore"), { recursive: true });
      await Deno.writeTextFile(
        join(tmpDir, "normalSeries", ".fseventsd", "_lore", "x.md"),
        reservedPassage,
      );

      const res = await makeRequest(app, "GET", "/api/lore/tags");
      assertEquals(res.status, 200);
      assertEquals(res.body.includes("forbidden"), false);
    });

    // ── Subdirectory Passages ────────────────────────────────────────────

    await t.step("PUT creates a passage in a subdirectory", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/characters/villain.md", passageBody(["evil"], "A villain."));
      assertEquals(res.status, 201);
    });

    await t.step("GET reads subdirectory passage", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/global/characters/villain.md");
      assertEquals(res.status, 200);
      assertEquals(res.body.content, "A villain.");
    });

    await t.step("GET list includes subdirectory passages with directory-implicit tag", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/global");
      assertEquals(res.status, 200);
      const villain = res.body.find((p: Record<string, unknown>) => p.filename === "villain.md");
      assertEquals(villain !== undefined, true);
      // "characters" is the directory-implicit tag
      assertEquals(villain.tags.includes("characters"), true);
      // "evil" is from frontmatter
      assertEquals(villain.tags.includes("evil"), true);
    });

    await t.step("DELETE removes subdirectory passage → 204", async () => {
      const res = await makeRequest(app, "DELETE", "/api/lore/global/characters/villain.md");
      assertEquals(res.status, 204);
    });

    // ── Validation & Error Cases ─────────────────────────────────────────

    await t.step("PUT with invalid path (no .md extension) → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/badfile.txt", passageBody([], "content"));
      assertEquals(res.status, 400);
    });

    await t.step("PUT with path traversal attempt → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/sub%2F..%2Fescape.md", passageBody([], "content"));
      assertEquals(res.status, 400);
    });

    await t.step("PUT with invalid JSON body → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/test.md", "not valid json{{{");
      assertEquals(res.status, 400);
    });

    await t.step("PUT with missing frontmatter → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/test.md", { content: "only content" });
      assertEquals(res.status, 400);
    });

    await t.step("PUT with missing content → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/test.md", { frontmatter: { tags: [] } });
      assertEquals(res.status, 400);
    });

    await t.step("GET non-existent passage → 404", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/global/does-not-exist.md");
      assertEquals(res.status, 404);
    });

    await t.step("DELETE non-existent passage → 404", async () => {
      const res = await makeRequest(app, "DELETE", "/api/lore/global/does-not-exist.md");
      assertEquals(res.status, 404);
    });

    await t.step("GET with invalid series param → 400", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/series/bad..param");
      assertEquals(res.status, 400);
    });

    await t.step("PUT with invalid series param → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/series/bad..param/test.md", passageBody([], "content"));
      assertEquals(res.status, 400);
    });

    await t.step("DELETE with invalid series param → 400", async () => {
      const res = await makeRequest(app, "DELETE", "/api/lore/series/bad..param/test.md");
      assertEquals(res.status, 400);
    });

    await t.step("GET with invalid story param → 400", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/story/ok/bad..param");
      assertEquals(res.status, 400);
    });

    await t.step("PUT with invalid story param → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/story/ok/bad..param/test.md", passageBody([], "content"));
      assertEquals(res.status, 400);
    });

    await t.step("DELETE with invalid story param → 400", async () => {
      const res = await makeRequest(app, "DELETE", "/api/lore/story/ok/bad..param/test.md");
      assertEquals(res.status, 400);
    });

    await t.step("story routes reject reserved story directory names → 400", async () => {
      const reservedNames = [
        "lost+found",
        "$RECYCLE.BIN",
        "System Volume Information",
        ".Spotlight-V100",
        ".Trashes",
        ".fseventsd",
      ];

      for (const name of reservedNames) {
        const encoded = encodeURIComponent(name);
        const getRes = await makeRequest(app, "GET", `/api/lore/story/ok/${encoded}`);
        assertEquals(getRes.status, 400);
        assertEquals(getRes.body?.detail, "Invalid parameter: story");

        const putRes = await makeRequest(
          app,
          "PUT",
          `/api/lore/story/ok/${encoded}/test.md`,
          passageBody([], "content"),
        );
        assertEquals(putRes.status, 400);
        assertEquals(putRes.body?.detail, "Invalid parameter: story");

        const deleteRes = await makeRequest(app, "DELETE", `/api/lore/story/ok/${encoded}/test.md`);
        assertEquals(deleteRes.status, 400);
        assertEquals(deleteRes.body?.detail, "Invalid parameter: story");
      }
    });

    await t.step("GET list with invalid series param → 400", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/series/a%2Fb");
      assertEquals(res.status, 400);
    });

    await t.step("GET list with invalid story series param → 400", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/story/a%2Fb/ok");
      assertEquals(res.status, 400);
    });

    await t.step("GET list with invalid story story param → 400", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/story/ok/a%2Fb");
      assertEquals(res.status, 400);
    });

    // ── Auth ─────────────────────────────────────────────────────────────

    await t.step("request without passphrase → 401", async () => {
      const res = await makeRequest(app, "GET", "/api/lore/tags", null, { "x-passphrase": "" });
      assertEquals(res.status, 401);
    });

    // ── Empty scope listing ──────────────────────────────────────────────

    await t.step("GET list on empty scope returns empty array", async () => {
      await Deno.mkdir(join(tmpDir, "emptySeries", "_lore"), { recursive: true });
      const res = await makeRequest(app, "GET", "/api/lore/series/emptySeries");
      assertEquals(res.status, 200);
      assertEquals(res.body, []);
    });

    await t.step("GET /api/lore/tags on empty lore returns empty array", async () => {
      // Ensure all lore is cleaned up first — create fresh temp for isolation
      const emptyTmp = await Deno.makeTempDir({ prefix: "lore-empty-" });
      await Deno.mkdir(join(emptyTmp, "_lore"), { recursive: true });

      const emptyApp = createTestApp(emptyTmp);
      const res = await makeRequest(emptyApp, "GET", "/api/lore/tags");
      assertEquals(res.status, 200);
      assertEquals(res.body, []);

      await Deno.remove(emptyTmp, { recursive: true });
    });

    // ── PUT with enabled=false, then verify list metadata ────────────────

    await t.step("PUT with enabled=false stores correctly and reflects in list", async () => {
      const res = await makeRequest(app, "PUT", "/api/lore/global/disabled.md", passageBody(["test"], "Disabled passage", 0, false));
      assertEquals(res.status, 201);

      const readRes = await makeRequest(app, "GET", "/api/lore/global/disabled.md");
      assertEquals(readRes.status, 200);
      assertEquals(readRes.body.frontmatter.enabled, false);

      const listRes = await makeRequest(app, "GET", "/api/lore/global");
      const found = listRes.body.find((p: Record<string, unknown>) => p.filename === "disabled.md");
      assertEquals(found.enabled, false);

      await makeRequest(app, "DELETE", "/api/lore/global/disabled.md");
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
} });
