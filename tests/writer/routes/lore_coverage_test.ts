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
  body?: Record<string, unknown> | string | null,
) {
  const init: RequestInit = {
    method,
    headers: { "x-passphrase": "test-pass" },
  };
  if (body !== undefined && body !== null) {
    (init.headers as Record<string, string>)["Content-Type"] =
      "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
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

const okBody = (
  fmOverride: Record<string, unknown> = {},
  content: unknown = "body",
) => ({
  frontmatter: { tags: [], priority: 0, enabled: true, ...fmOverride },
  content,
});

Deno.test({
  name: "lore routes — additional coverage",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const tmpDir = await Deno.makeTempDir({ prefix: "lore-cov-" });
    const previousPassphrase = Deno.env.get("PASSPHRASE");
    Deno.env.set("PASSPHRASE", "test-pass");
    const app = buildApp(tmpDir);

    try {
      // ── isValidPassagePath rejects > 2 segments ────────────────────────

      await t.step("PUT with 3-segment passage path → 400", async () => {
        const res = await makeRequest(
          app,
          "PUT",
          "/api/lore/global/a/b/c.md",
          okBody(),
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Invalid passage path");
      });

      await t.step("GET with 3-segment passage path → 400", async () => {
        const res = await makeRequest(app, "GET", "/api/lore/global/a/b/c.md");
        assertEquals(res.status, 400);
      });

      await t.step("DELETE with 3-segment passage path → 400", async () => {
        const res = await makeRequest(
          app,
          "DELETE",
          "/api/lore/global/a/b/c.md",
        );
        assertEquals(res.status, 400);
      });

      // ── validatePassageBody — frontmatter shape errors ─────────────────

      await t.step("PUT with non-array tags → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/lore/global/t1.md", {
          frontmatter: { tags: "not-array", priority: 0, enabled: true },
          content: "x",
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body.detail as string).startsWith("Invalid tags"),
          true,
        );
      });

      await t.step("PUT with non-string tag entry → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/lore/global/t2.md", {
          frontmatter: { tags: [123], priority: 0, enabled: true },
          content: "x",
        });
        assertEquals(res.status, 400);
      });

      await t.step("PUT with comma in tag → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/lore/global/t3.md", {
          frontmatter: { tags: ["a,b"], priority: 0, enabled: true },
          content: "x",
        });
        assertEquals(res.status, 400);
      });

      await t.step("PUT with newline in tag → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/lore/global/t4.md", {
          frontmatter: { tags: ["a\nb"], priority: 0, enabled: true },
          content: "x",
        });
        assertEquals(res.status, 400);
      });

      await t.step("PUT with empty-string tag → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/lore/global/t5.md", {
          frontmatter: { tags: [""], priority: 0, enabled: true },
          content: "x",
        });
        assertEquals(res.status, 400);
      });

      await t.step("PUT with non-finite priority → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/lore/global/p1.md", {
          frontmatter: { tags: [], priority: "high", enabled: true },
          content: "x",
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body.detail as string).startsWith("Invalid priority"),
          true,
        );
      });

      await t.step("PUT with non-boolean enabled → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/lore/global/e1.md", {
          frontmatter: { tags: [], priority: 0, enabled: "yes" },
          content: "x",
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body.detail as string).startsWith("Invalid enabled"),
          true,
        );
      });

      // ── isValidPassagePath: empty/null path components ─────────────────

      await t.step("PUT with non-md extension → 400", async () => {
        const res = await makeRequest(
          app,
          "PUT",
          "/api/lore/global/notes.txt",
          okBody(),
        );
        assertEquals(res.status, 400);
      });

      // ── Series/story scope validation paths ────────────────────────────

      await t.step(
        "PUT story scope with valid params → 201 and creates dirs",
        async () => {
          const res = await makeRequest(
            app,
            "PUT",
            "/api/lore/story/seriesA/storyA/note.md",
            okBody({ tags: ["lore"] }, "story-level note"),
          );
          assertEquals(res.status, 201);
          const onDisk = await Deno.readTextFile(
            join(tmpDir, "seriesA", "storyA", "_lore", "note.md"),
          );
          assertEquals(onDisk.includes("story-level note"), true);
        },
      );

      await t.step("DELETE story scope happy path → 204", async () => {
        const res = await makeRequest(
          app,
          "DELETE",
          "/api/lore/story/seriesA/storyA/note.md",
        );
        assertEquals(res.status, 204);
      });

      // ── GET /api/lore/tags resilience: missing playground ──────────────

      await t.step(
        "GET /api/lore/tags when playground dir missing → 200 []",
        async () => {
          const ghost = await Deno.makeTempDir({ prefix: "lore-cov-ghost-" });
          await Deno.remove(ghost, { recursive: true });
          const ghostApp = buildApp(ghost);
          const res = await makeRequest(ghostApp, "GET", "/api/lore/tags");
          assertEquals(res.status, 200);
          assertEquals(Array.isArray(res.body), true);
        },
      );

      // ── GET /api/lore/tags with story scopes containing dotted/underscored siblings ─

      await t.step(
        "GET /api/lore/tags skips dotted/underscored series and story dirs",
        async () => {
          // Set up a series with dotted siblings to exercise filter branches
          const series = "agg-series";
          await Deno.mkdir(join(tmpDir, series, "_lore"), { recursive: true });
          await Deno.writeTextFile(
            join(tmpDir, series, "_lore", "s.md"),
            "---\ntags: [seriestag]\n---\nbody",
          );
          // dotted story (skipped)
          await Deno.mkdir(join(tmpDir, series, ".hidden"), {
            recursive: true,
          });
          // underscore story (skipped)
          await Deno.mkdir(join(tmpDir, series, "_archive"), {
            recursive: true,
          });
          // real story
          await Deno.mkdir(join(tmpDir, series, "real-story", "_lore"), {
            recursive: true,
          });
          await Deno.writeTextFile(
            join(tmpDir, series, "real-story", "_lore", "p.md"),
            "---\ntags: [storytag]\n---\nbody",
          );

          const res = await makeRequest(app, "GET", "/api/lore/tags");
          assertEquals(res.status, 200);
          const tags = res.body as unknown as string[];
          assertEquals(tags.includes("seriestag"), true);
          assertEquals(tags.includes("storytag"), true);
        },
      );

      // ── enabled=false survives round-trip and shows in list ────────────

      await t.step(
        "list passages includes disabled entries (no auto-filter)",
        async () => {
          await makeRequest(
            app,
            "PUT",
            "/api/lore/global/dis.md",
            okBody({ enabled: false, tags: ["status"] }, "off"),
          );
          const list = await makeRequest(app, "GET", "/api/lore/global");
          const rows = list.body as unknown as Array<Record<string, unknown>>;
          const dis = rows.find((r) => r.filename === "dis.md");
          assertEquals(dis?.enabled, false);
        },
      );

      // ── Malformed YAML frontmatter is tolerated by parseFrontmatter ────

      await t.step(
        "GET passage with malformed YAML frontmatter → 200",
        async () => {
          // Write a passage with broken YAML directly (parseFrontmatter is lenient)
          await Deno.mkdir(join(tmpDir, "_lore"), { recursive: true });
          await Deno.writeTextFile(
            join(tmpDir, "_lore", "broken.md"),
            "---\ntags: [unterminated\n---\nbody after broken yaml",
          );
          const res = await makeRequest(
            app,
            "GET",
            "/api/lore/global/broken.md",
          );
          // The route returns 200 — parser falls back to defaults on malformed YAML
          assertEquals(res.status, 200);
          assertEquals(typeof res.body.content, "string");
        },
      );

      // ── Per-passage route param validators on series/story scopes ──

      await t.step("GET series passage with bad series → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/lore/series/bad..s/p.md",
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Invalid parameter: series");
      });

      await t.step("GET story passage with bad series → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/lore/story/bad..s/ok/p.md",
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Invalid parameter: series");
      });

      await t.step("GET story passage with bad story → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/lore/story/ok/bad..s/p.md",
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Invalid parameter: story");
      });

      await t.step("PUT story passage with bad series → 400", async () => {
        const res = await makeRequest(
          app,
          "PUT",
          "/api/lore/story/bad..s/ok/p.md",
          { content: "x" },
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Invalid parameter: series");
      });

      await t.step("PUT story passage with bad story → 400", async () => {
        const res = await makeRequest(
          app,
          "PUT",
          "/api/lore/story/ok/bad..s/p.md",
          { content: "x" },
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Invalid parameter: story");
      });

      await t.step("DELETE story passage with bad series → 400", async () => {
        const res = await makeRequest(
          app,
          "DELETE",
          "/api/lore/story/bad..s/ok/p.md",
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Invalid parameter: series");
      });

      await t.step("DELETE story passage with bad story → 400", async () => {
        const res = await makeRequest(
          app,
          "DELETE",
          "/api/lore/story/ok/bad..s/p.md",
        );
        assertEquals(res.status, 400);
        assertEquals(res.body.detail, "Invalid parameter: story");
      });

      // ── 500 catch-alls via deterministic filesystem errors ──

      await t.step("GET passage when path is a directory → 500", async () => {
        const dir = join(tmpDir, "_lore");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.mkdir(join(dir, "locked.md"));
        const res = await makeRequest(
          app,
          "GET",
          "/api/lore/global/locked.md",
        );
        assertEquals(res.status, 500);
        assertEquals(res.body.detail, "Failed to read passage");
      });

      await t.step(
        "PUT passage when target path is a directory → 500",
        async () => {
          const dir = join(tmpDir, "_lore");
          await Deno.mkdir(dir, { recursive: true });
          await Deno.mkdir(join(dir, "wp.md"));
          const res = await makeRequest(
            app,
            "PUT",
            "/api/lore/global/wp.md",
            { frontmatter: {}, content: "x" },
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to write passage");
        },
      );

      await t.step(
        "DELETE passage when path is a non-empty directory → 500",
        async () => {
          const dir = join(tmpDir, "_lore");
          await Deno.mkdir(dir, { recursive: true });
          const path = join(dir, "delme.md");
          await Deno.mkdir(path);
          await Deno.writeTextFile(join(path, "child"), "x");
          const res = await makeRequest(
            app,
            "DELETE",
            "/api/lore/global/delme.md",
          );
          assertEquals(res.status, 500);
          assertEquals(res.body.detail, "Failed to delete passage");
        },
      );
    } finally {
      if (previousPassphrase === undefined) {
        Deno.env.delete("PASSPHRASE");
      } else {
        Deno.env.set("PASSPHRASE", previousPassphrase);
      }
      // Best-effort: ensure no chmod 000/555 dirs remain that would block cleanup
      try {
        for await (const entry of Deno.readDir(tmpDir)) {
          await Deno.chmod(join(tmpDir, entry.name), 0o755).catch(() => {});
        }
      } catch { /* ignore */ }
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});
