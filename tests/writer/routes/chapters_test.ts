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
import type { AppConfig, AppDeps, BuildPromptResult } from "../../../writer/types.ts";
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

Deno.test({
  name: "chapter routes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
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
        getBuiltinDir: () => "/nonexistent-plugins",
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({
        messages: [],
        ventoError: null,
        targetChapterNumber: 0,
        existingContent: "",
        userMessageText: "",
        assistantPrefill: "",
      })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
      templateEngine: null,
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
        await Deno.writeTextFile(
          join(storyDir, "001-state-diff.yaml"),
          "entries:\n  - category: location\n    item: city\n    before: old\n    after: new\n",
        );
        const res = await makeRequest(
          app,
          "GET",
          "/api/stories/series1/story1/chapters/1",
        );
        assertEquals(res.status, 200);
        assertEquals(res.body.number, 1);
        assertEquals(res.body.content, "Chapter 1 content");
        assertEquals(Array.isArray(res.body.stateDiff.entries), true);
      });

      await t.step(
        "GET /api/stories/:series/:name/chapters/:number returns 404 for nonexistent",
        async () => {
          const res = await makeRequest(
            app,
            "GET",
            "/api/stories/series1/story1/chapters/99",
          );
          assertEquals(res.status, 404);
        },
      );

      await t.step(
        "GET /api/stories/:series/:name/chapters?include=content returns batch data",
        async () => {
          // Re-create chapter 2 (deleted in prior step)
          await Deno.writeTextFile(join(storyDir, "002.md"), "Chapter 2 restored");
          await Deno.writeTextFile(
            join(storyDir, "002-state-diff.yaml"),
            "entries:\n  - category: test\n    item: demo\n    before: old\n    after: new\n",
          );
          const res = await makeRequest(
            app,
            "GET",
            "/api/stories/series1/story1/chapters?include=content",
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.length, 2);
          assertEquals(res.body[0].number, 1);
          assertEquals(res.body[0].content, "Chapter 1 content");
          assertEquals(res.body[1].number, 2);
          assertEquals(res.body[1].content, "Chapter 2 restored");
          assertEquals(Array.isArray(res.body[1].stateDiff.entries), true);
        },
      );

      await t.step("GET chapters?include=unknown falls back to number[] format", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/stories/series1/story1/chapters?include=unknown",
        );
        assertEquals(res.status, 200);
        assertEquals(res.body, [1, 2]);
      });

      await t.step(
        "DELETE /api/stories/:series/:name/chapters/last deletes last chapter",
        async () => {
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
        },
      );

      await t.step("DELETE /chapters/last removes deleted chapter state artifacts", async () => {
        const cleanupDir = join(tmpDir, "cleanup-series", "cleanup-story");
        await Deno.mkdir(cleanupDir, { recursive: true });
        await Deno.writeTextFile(join(cleanupDir, "001.md"), "Chapter 1");
        await Deno.writeTextFile(join(cleanupDir, "002.md"), "Chapter 2");
        await Deno.writeTextFile(join(cleanupDir, "001-state.yaml"), "state: keep");
        await Deno.writeTextFile(join(cleanupDir, "002-state.yaml"), "state: remove");
        await Deno.writeTextFile(join(cleanupDir, "002-state-diff.yaml"), "diff: remove");
        await Deno.writeTextFile(join(cleanupDir, "current-status.yaml"), "status: remove");

        const res = await makeRequest(
          app,
          "DELETE",
          "/api/stories/cleanup-series/cleanup-story/chapters/last",
        );
        assertEquals(res.status, 200);
        assertEquals(res.body.deleted, 2);

        const entries: string[] = [];
        for await (const entry of Deno.readDir(cleanupDir)) {
          entries.push(entry.name);
        }
        entries.sort();
        assertEquals(entries.includes("001.md"), true);
        assertEquals(entries.includes("001-state.yaml"), true);
        assertEquals(entries.includes("002.md"), false);
        assertEquals(entries.includes("002-state.yaml"), false);
        assertEquals(entries.includes("002-state-diff.yaml"), false);
        assertEquals(entries.includes("current-status.yaml"), false);
      });
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "chapter routes – additional coverage",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
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
        getBuiltinDir: () => "/nonexistent-plugins",
        getPromptVariables: async () => ({ variables: {}, fragments: [] }),
        getStripTagPatterns: () => null,
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({
        messages: [],
        ventoError: null,
        targetChapterNumber: 0,
        existingContent: "",
        userMessageText: "",
        assistantPrefill: "",
      })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
      templateEngine: null,
      verifyPassphrase,
    } as AppDeps);

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

      // ── GET /chapters edge cases ────────────────────────────────────────

      await t.step("GET chapters returns 404 for nonexistent story", async () => {
        const res = await makeRequest(app, "GET", "/api/stories/no/such/chapters");
        assertEquals(res.status, 404);
      });

      await t.step("GET chapters?include=content returns 404 for nonexistent story", async () => {
        const res = await makeRequest(app, "GET", "/api/stories/no/such/chapters?include=content");
        assertEquals(res.status, 404);
      });

      await t.step(
        "GET chapters?include=content returns empty array for story with no chapters",
        async () => {
          // newseries/newstory was created by init step with only 001.md (empty file)
          // Create a fresh empty directory
          const emptyStory = join(tmpDir, "emptyseries", "emptystory");
          await Deno.mkdir(emptyStory, { recursive: true });
          const res = await makeRequest(
            app,
            "GET",
            "/api/stories/emptyseries/emptystory/chapters?include=content",
          );
          assertEquals(res.status, 200);
          assertEquals(res.body, []);
        },
      );

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

      await t.step("DELETE last chapter returns 409 when generation is active", async () => {
        const { markGenerationActive, clearGenerationActive } = await import(
          "../../../writer/lib/generation-registry.ts"
        );
        const guardDir = join(tmpDir, "del-guard", "story");
        await Deno.mkdir(guardDir, { recursive: true });
        await Deno.writeTextFile(join(guardDir, "001.md"), "ch1");
        await Deno.writeTextFile(join(guardDir, "002.md"), "ch2");
        markGenerationActive("del-guard", "story");
        try {
          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/del-guard/story/chapters/last",
          );
          assertEquals(res.status, 409);

          // No file may be removed while a generation is active.
          const left: string[] = [];
          for await (const entry of Deno.readDir(guardDir)) {
            if (/^\d+\.md$/.test(entry.name)) left.push(entry.name);
          }
          left.sort();
          assertEquals(left, ["001.md", "002.md"]);
        } finally {
          clearGenerationActive("del-guard", "story");
        }
      });

      await t.step(
        "DELETE last chapter prunes only the deleted chapter's usage record",
        async () => {
          const usageDir = join(tmpDir, "del-usage", "story");
          await Deno.mkdir(usageDir, { recursive: true });
          await Deno.writeTextFile(join(usageDir, "001.md"), "ch1");
          await Deno.writeTextFile(join(usageDir, "002.md"), "ch2");
          const records = [
            {
              chapter: 1,
              promptTokens: 10,
              completionTokens: 20,
              totalTokens: 30,
              model: "test-model",
              timestamp: "2026-01-01T00:00:00.000Z",
            },
            {
              chapter: 2,
              promptTokens: 40,
              completionTokens: 50,
              totalTokens: 90,
              model: "test-model",
              timestamp: "2026-01-02T00:00:00.000Z",
            },
          ];
          await Deno.writeTextFile(
            join(usageDir, "_usage.json"),
            `${JSON.stringify(records, null, 2)}\n`,
          );

          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/del-usage/story/chapters/last",
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.deleted, 2);

          const pruned = JSON.parse(await Deno.readTextFile(join(usageDir, "_usage.json")));
          assertEquals(pruned.length, 1);
          assertEquals(pruned[0].chapter, 1);
        },
      );

      // ── PUT /chapters/:number edit ──────────────────────────────────────

      await t.step("PUT chapter happy path updates file and returns content", async () => {
        const editDir = join(tmpDir, "edit", "story");
        await Deno.mkdir(editDir, { recursive: true });
        await Deno.writeTextFile(join(editDir, "001.md"), "original");

        const res = await makeRequest(
          app,
          "PUT",
          "/api/stories/edit/story/chapters/1",
          { content: "rewritten" },
        );
        assertEquals(res.status, 200);
        assertEquals(res.body.number, 1);
        assertEquals(res.body.content, "rewritten");
        const onDisk = await Deno.readTextFile(join(editDir, "001.md"));
        assertEquals(onDisk, "rewritten");
      });

      await t.step(
        "PUT chapter invalidates state cache artifacts from edited chapter onward",
        async () => {
          const editDir = join(tmpDir, "edit-cache", "story");
          await Deno.mkdir(editDir, { recursive: true });
          await Deno.writeTextFile(join(editDir, "001.md"), "ch1");
          await Deno.writeTextFile(join(editDir, "002.md"), "ch2");
          await Deno.writeTextFile(join(editDir, "003.md"), "ch3");
          await Deno.writeTextFile(join(editDir, "001-state.yaml"), "state: keep");
          await Deno.writeTextFile(join(editDir, "001-state-diff.yaml"), "diff: keep");
          await Deno.writeTextFile(join(editDir, "002-state.yaml"), "state: remove");
          await Deno.writeTextFile(join(editDir, "002-state-diff.yaml"), "diff: remove");
          await Deno.writeTextFile(join(editDir, "003-state.yaml"), "state: remove");
          await Deno.writeTextFile(join(editDir, "003-state-diff.yaml"), "diff: remove");
          await Deno.writeTextFile(join(editDir, "current-status.yaml"), "status: remove");

          const res = await makeRequest(
            app,
            "PUT",
            "/api/stories/edit-cache/story/chapters/2",
            { content: "chapter 2 edited" },
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.number, 2);
          assertEquals(res.body.content, "chapter 2 edited");

          const chapter2 = await Deno.readTextFile(join(editDir, "002.md"));
          assertEquals(chapter2, "chapter 2 edited");

          const entries: string[] = [];
          for await (const entry of Deno.readDir(editDir)) {
            entries.push(entry.name);
          }
          entries.sort();
          assertEquals(entries.includes("001-state.yaml"), true);
          assertEquals(entries.includes("001-state-diff.yaml"), true);
          assertEquals(entries.includes("002-state.yaml"), false);
          assertEquals(entries.includes("002-state-diff.yaml"), false);
          assertEquals(entries.includes("003-state.yaml"), false);
          assertEquals(entries.includes("003-state-diff.yaml"), false);
          assertEquals(entries.includes("current-status.yaml"), false);
        },
      );

      await t.step("PUT chapter returns 404 for non-existent chapter", async () => {
        const editDir = join(tmpDir, "edit2", "story2");
        await Deno.mkdir(editDir, { recursive: true });
        const res = await makeRequest(
          app,
          "PUT",
          "/api/stories/edit2/story2/chapters/5",
          { content: "x" },
        );
        assertEquals(res.status, 404);
      });

      await t.step("PUT chapter returns 400 for invalid number", async () => {
        const res = await makeRequest(
          app,
          "PUT",
          "/api/stories/edit/story/chapters/0",
          { content: "x" },
        );
        assertEquals(res.status, 400);
        const res2 = await makeRequest(
          app,
          "PUT",
          "/api/stories/edit/story/chapters/-1",
          { content: "x" },
        );
        assertEquals(res2.status, 400);
      });

      await t.step("PUT chapter returns 400 for non-string content", async () => {
        const editDir = join(tmpDir, "edit3", "story3");
        await Deno.mkdir(editDir, { recursive: true });
        await Deno.writeTextFile(join(editDir, "001.md"), "x");
        const res = await makeRequest(
          app,
          "PUT",
          "/api/stories/edit3/story3/chapters/1",
          { content: 123 } as unknown as Record<string, unknown>,
        );
        assertEquals(res.status, 400);
      });

      await t.step("PUT chapter returns 400 for malformed JSON body", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/stories/edit3/story3/chapters/1", {
            method: "PUT",
            headers: { "x-passphrase": "test-pass", "Content-Type": "application/json" },
            body: "{not json",
          }),
        );
        assertEquals(res.status, 400);
        assertEquals((await res.json()).detail, "Malformed JSON body");
      });

      await t.step("PUT chapter requires object body", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/stories/edit3/story3/chapters/1", {
            method: "PUT",
            headers: { "x-passphrase": "test-pass", "Content-Type": "application/json" },
            body: JSON.stringify("not-object"),
          }),
        );
        assertEquals(res.status, 400);
        assertEquals((await res.json()).detail, "Request body must be an object");
      });

      await t.step("PUT chapter returns 409 when generation is active", async () => {
        const { markGenerationActive, clearGenerationActive } = await import(
          "../../../writer/lib/generation-registry.ts"
        );
        const editDir = join(tmpDir, "edit4", "story4");
        await Deno.mkdir(editDir, { recursive: true });
        await Deno.writeTextFile(join(editDir, "001.md"), "x");
        markGenerationActive("edit4", "story4");
        try {
          const res = await makeRequest(
            app,
            "PUT",
            "/api/stories/edit4/story4/chapters/1",
            { content: "y" },
          );
          assertEquals(res.status, 409);
        } finally {
          clearGenerationActive("edit4", "story4");
        }
      });

      await t.step(
        "PUT chapter does not write while a generation lock is acquired mid-flight (TOCTOU window closed)",
        async () => {
          const { tryMarkGenerationActive, clearGenerationActive } = await import(
            "../../../writer/lib/generation-registry.ts"
          );
          const editDir = join(tmpDir, "toctou", "story");
          await Deno.mkdir(editDir, { recursive: true });
          // Seed with the original content; the race winner (a generation)
          // would stream into this same file.
          await Deno.writeTextFile(join(editDir, "001.md"), "ORIGINAL");

          // Build a PUT whose JSON body arrives only after the test releases
          // it, so the handler parks on `await c.req.json()` AFTER passing its
          // early `isGenerationActive` fast-fail. While parked, we acquire the
          // generation lock (simulating the chat path winning the race) before
          // letting the body finish. This is the exact TOCTOU interleaving:
          // check passed → lock acquired by someone else → write attempted.
          let releaseBody!: () => void;
          const bodyReleased = new Promise<void>((resolve) => {
            releaseBody = resolve;
          });
          let bodyStarted!: () => void;
          const bodyStartedPromise = new Promise<void>((resolve) => {
            bodyStarted = resolve;
          });
          const encoder = new TextEncoder();
          const slowBody = new ReadableStream<Uint8Array>({
            async pull(controller) {
              bodyStarted();
              await bodyReleased;
              controller.enqueue(encoder.encode(JSON.stringify({ content: "EDITED" })));
              controller.close();
            },
          });

          const reqPromise = app.fetch(
            new Request("http://localhost/api/stories/toctou/story/chapters/1", {
              method: "PUT",
              headers: { "x-passphrase": "test-pass", "Content-Type": "application/json" },
              body: slowBody,
              // @ts-expect-error duplex is required for a streaming request body
              duplex: "half",
            }),
          );

          // Wait until the handler is parked reading the body (it has already
          // cleared its early guard by now), then a competing generation wins
          // the lock.
          await bodyStartedPromise;
          const acquired = tryMarkGenerationActive("toctou", "story");
          assertEquals(acquired, true);

          try {
            // Let the parked PUT proceed to its write attempt.
            releaseBody();
            const res = await reqPromise;
            const status = res.status;
            await res.body?.cancel();

            // With the atomic guard the PUT must refuse (409) and the file must
            // stay untouched. Before the fix this returned 200 and overwrote
            // the file while the lock was held — silent data loss.
            assertEquals(status, 409);
            const onDisk = await Deno.readTextFile(join(editDir, "001.md"));
            assertEquals(onDisk, "ORIGINAL");
          } finally {
            clearGenerationActive("toctou", "story");
          }
        },
      );

      await t.step(
        "PUT-while-PUT: concurrent edits to the same story serialize (second gets 409)",
        async () => {
          const editDir = join(tmpDir, "concedit", "story");
          await Deno.mkdir(editDir, { recursive: true });
          await Deno.writeTextFile(join(editDir, "001.md"), "ORIGINAL");

          // First PUT parks on a slow body after acquiring the lock; the
          // second PUT (normal body) must see the lock held and return 409.
          let releaseFirst!: () => void;
          const firstReleased = new Promise<void>((resolve) => {
            releaseFirst = resolve;
          });
          let firstHoldsLock!: () => void;
          const firstHoldsLockPromise = new Promise<void>((resolve) => {
            firstHoldsLock = resolve;
          });
          const encoder = new TextEncoder();
          const slowBody = new ReadableStream<Uint8Array>({
            async pull(controller) {
              controller.enqueue(encoder.encode(JSON.stringify({ content: "FIRST" })));
              controller.close();
              // The first request has now delivered its body; give the handler
              // a microtask turn to acquire the lock and reach its write,
              // which we delay via the FS by parking here is not possible, so
              // instead we open the window after the body completes.
              firstHoldsLock();
              await firstReleased;
            },
          });

          const firstPromise = app.fetch(
            new Request("http://localhost/api/stories/concedit/story/chapters/1", {
              method: "PUT",
              headers: { "x-passphrase": "test-pass", "Content-Type": "application/json" },
              body: slowBody,
              // @ts-expect-error duplex is required for a streaming request body
              duplex: "half",
            }),
          );

          await firstHoldsLockPromise;
          // While the first PUT is parked holding the lock, fire the second.
          const second = await makeRequest(
            app,
            "PUT",
            "/api/stories/concedit/story/chapters/1",
            { content: "SECOND" },
          );
          releaseFirst();
          const firstRes = await firstPromise;
          await firstRes.body?.cancel();

          assertEquals(firstRes.status, 200);
          assertEquals(second.status, 409);
          // The first edit wins; the second never wrote.
          assertEquals(await Deno.readTextFile(join(editDir, "001.md")), "FIRST");
        },
      );

      await t.step(
        "PUT releases the lock on an early 404 return inside the locked block",
        async () => {
          const editDir = join(tmpDir, "lockrelease", "story");
          await Deno.mkdir(editDir, { recursive: true });
          await Deno.writeTextFile(join(editDir, "001.md"), "ORIGINAL");

          // PUT a non-existent chapter (5): acquires the lock, then `Deno.stat`
          // throws NotFound → 404 returned from inside the try. The `finally`
          // MUST release the lock so a subsequent valid edit can proceed.
          const missing = await makeRequest(
            app,
            "PUT",
            "/api/stories/lockrelease/story/chapters/5",
            { content: "x" },
          );
          assertEquals(missing.status, 404);

          // If the lock leaked, this would return 409. It must succeed.
          const ok = await makeRequest(
            app,
            "PUT",
            "/api/stories/lockrelease/story/chapters/1",
            { content: "EDITED" },
          );
          assertEquals(ok.status, 200);
          assertEquals(await Deno.readTextFile(join(editDir, "001.md")), "EDITED");
        },
      );

      // ── DELETE /chapters/after/:number rewind ────────────────────────────

      await t.step(
        "DELETE after happy path removes newer chapters in descending order",
        async () => {
          const dir = join(tmpDir, "rw", "story");
          await Deno.mkdir(dir, { recursive: true });
          for (const n of [1, 2, 3, 4, 5]) {
            const padded = String(n).padStart(3, "0");
            await Deno.writeTextFile(join(dir, `${padded}.md`), `ch${n}`);
          }
          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/rw/story/chapters/after/2",
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.deleted, [3, 4, 5]);

          const left: string[] = [];
          for await (const e of Deno.readDir(dir)) {
            if (/^\d+\.md$/.test(e.name)) left.push(e.name);
          }
          left.sort();
          assertEquals(left, ["001.md", "002.md"]);
        },
      );

      await t.step(
        "DELETE after removes rewound chapter state artifacts and current status",
        async () => {
          const dir = join(tmpDir, "rw-state", "story");
          await Deno.mkdir(dir, { recursive: true });
          for (const n of [1, 2, 3, 4]) {
            const padded = String(n).padStart(3, "0");
            await Deno.writeTextFile(join(dir, `${padded}.md`), `ch${n}`);
          }
          await Deno.writeTextFile(join(dir, "001-state.yaml"), "state: keep");
          await Deno.writeTextFile(join(dir, "001-state-diff.yaml"), "diff: keep");
          await Deno.writeTextFile(join(dir, "002-state.yaml"), "state: keep");
          await Deno.writeTextFile(join(dir, "002-state-diff.yaml"), "diff: keep");
          await Deno.writeTextFile(join(dir, "003-state.yaml"), "state: remove");
          await Deno.writeTextFile(join(dir, "003-state-diff.yaml"), "diff: remove");
          await Deno.writeTextFile(join(dir, "004-state.yaml"), "state: remove");
          await Deno.writeTextFile(join(dir, "004-state-diff.yaml"), "diff: remove");
          await Deno.writeTextFile(join(dir, "current-status.yaml"), "status: remove");

          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/rw-state/story/chapters/after/2",
          );
          assertEquals(res.status, 200);
          assertEquals(res.body.deleted, [3, 4]);

          const entries: string[] = [];
          for await (const entry of Deno.readDir(dir)) {
            entries.push(entry.name);
          }
          entries.sort();
          assertEquals(entries.includes("001-state.yaml"), true);
          assertEquals(entries.includes("001-state-diff.yaml"), true);
          assertEquals(entries.includes("002-state.yaml"), true);
          assertEquals(entries.includes("002-state-diff.yaml"), true);
          assertEquals(entries.includes("003-state.yaml"), false);
          assertEquals(entries.includes("003-state-diff.yaml"), false);
          assertEquals(entries.includes("004-state.yaml"), false);
          assertEquals(entries.includes("004-state-diff.yaml"), false);
          assertEquals(entries.includes("current-status.yaml"), false);
        },
      );

      await t.step("DELETE after 0 clears all chapters", async () => {
        const dir = join(tmpDir, "rw2", "story");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(join(dir, "001.md"), "a");
        await Deno.writeTextFile(join(dir, "002.md"), "b");

        const res = await makeRequest(
          app,
          "DELETE",
          "/api/stories/rw2/story/chapters/after/0",
        );
        assertEquals(res.status, 200);
        assertEquals(res.body.deleted, [1, 2]);
      });

      await t.step("DELETE after no-op when nothing to delete", async () => {
        const dir = join(tmpDir, "rw3", "story");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(join(dir, "001.md"), "a");
        const res = await makeRequest(
          app,
          "DELETE",
          "/api/stories/rw3/story/chapters/after/5",
        );
        assertEquals(res.status, 200);
        assertEquals(res.body.deleted, []);
      });

      await t.step("DELETE after invalid number returns 400", async () => {
        const res = await makeRequest(
          app,
          "DELETE",
          "/api/stories/rw/story/chapters/after/abc",
        );
        assertEquals(res.status, 400);
        const res2 = await makeRequest(
          app,
          "DELETE",
          "/api/stories/rw/story/chapters/after/-1",
        );
        assertEquals(res2.status, 400);
      });

      await t.step("DELETE after returns 409 when generation active", async () => {
        const { markGenerationActive, clearGenerationActive } = await import(
          "../../../writer/lib/generation-registry.ts"
        );
        const dir = join(tmpDir, "rw4", "story");
        await Deno.mkdir(dir, { recursive: true });
        await Deno.writeTextFile(join(dir, "001.md"), "a");
        markGenerationActive("rw4", "story");
        try {
          const res = await makeRequest(
            app,
            "DELETE",
            "/api/stories/rw4/story/chapters/after/0",
          );
          assertEquals(res.status, 409);
        } finally {
          clearGenerationActive("rw4", "story");
        }
      });

      await t.step("DELETE after returns 404 when story missing", async () => {
        const res = await makeRequest(
          app,
          "DELETE",
          "/api/stories/nope/story/chapters/after/0",
        );
        assertEquals(res.status, 404);
      });
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});
