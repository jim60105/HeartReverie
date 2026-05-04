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

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps, AppConfig, BuildPromptResult, StoryExportJson } from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

interface ResEnvelope {
  status: number;
  text: string;
  headers: Record<string, string>;
}

async function makeRequest(
  app: Hono,
  urlPath: string,
  headers?: Record<string, string>,
): Promise<ResEnvelope> {
  const init: RequestInit = {
    method: "GET",
    headers: { "x-passphrase": "test-pass", ...headers },
  };
  const res = await app.fetch(new Request(`http://localhost${urlPath}`, init));
  const text = await res.text();
  return { status: res.status, text, headers: Object.fromEntries(res.headers) };
}

async function setupApp(
  storyContents: Record<string, string>,
  combinedStripRegex: RegExp | null = null,
): Promise<{ app: Hono; tmpDir: string }> {
  const tmpDir = await Deno.makeTempDir({ prefix: "export-test-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  // Create story with chapters
  const storyDir = join(tmpDir, "SeriesA", "StoryA");
  await Deno.mkdir(storyDir, { recursive: true });
  for (const [filename, content] of Object.entries(storyContents)) {
    await Deno.writeTextFile(join(storyDir, filename), content);
  }
  // Add a system-reserved _lore/ dir to confirm it is ignored.
  await Deno.mkdir(join(storyDir, "_lore"), { recursive: true });
  await Deno.writeTextFile(join(storyDir, "_lore", "001.md"), "LORE DO NOT EXPORT");

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
      getCombinedStripTagPatterns: () => combinedStripRegex,
    } as unknown as PluginManager,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
    buildContinuePromptFromStory: (async () => ({ messages: [], ventoError: null, targetChapterNumber: 0, existingContent: "", userMessageText: "", assistantPrefill: "" })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
    verifyPassphrase,
  } as AppDeps);

  return { app, tmpDir };
}

Deno.test({ name: "export routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  await t.step("default markdown export orders chapters and sets headers", async () => {
    const { app } = await setupApp({
      "001.md": "Opening line",
      "002.md": "Second chapter body",
      "003.md": "Third chapter body",
      "notes.md": "Should not be exported",
    });

    const res = await makeRequest(app, "/api/stories/SeriesA/StoryA/export");
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers["content-type"] ?? "", "text/markdown");
    assertStringIncludes(res.headers["content-disposition"] ?? "", "attachment");
    assertStringIncludes(res.headers["content-disposition"] ?? "", "filename=");
    assertStringIncludes(res.headers["content-disposition"] ?? "", "filename*=UTF-8''");

    const body = res.text;
    assertStringIncludes(body, "# SeriesA / StoryA");
    assertStringIncludes(body, "## Chapter 1");
    assertStringIncludes(body, "## Chapter 2");
    assertStringIncludes(body, "## Chapter 3");
    assert(body.indexOf("Chapter 1") < body.indexOf("Chapter 2"));
    assert(body.indexOf("Chapter 2") < body.indexOf("Chapter 3"));
    assert(!body.includes("Should not be exported"));
    assert(!body.includes("LORE DO NOT EXPORT"));
  });

  await t.step("json export matches StoryExportJson shape sorted ascending", async () => {
    const { app } = await setupApp({
      "003.md": "third",
      "001.md": "first",
      "002.md": "second",
    });

    const res = await makeRequest(app, "/api/stories/SeriesA/StoryA/export?format=json");
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers["content-type"] ?? "", "application/json");

    const parsed = JSON.parse(res.text) as StoryExportJson;
    assertEquals(parsed.series, "SeriesA");
    assertEquals(parsed.name, "StoryA");
    assert(typeof parsed.exportedAt === "string" && parsed.exportedAt.length > 0);
    assertEquals(parsed.chapters.map((c) => c.number), [1, 2, 3]);
    assertEquals(parsed.chapters[0]!.content, "first");
  });

  await t.step("txt export strips markdown syntax", async () => {
    const { app } = await setupApp({
      "001.md": "# Heading\n\n**bold** and *italic* and `code` and [link](https://example.com)\n\n```js\nconst x = 1;\n```",
    });

    const res = await makeRequest(app, "/api/stories/SeriesA/StoryA/export?format=txt");
    assertEquals(res.status, 200);
    assertStringIncludes(res.headers["content-type"] ?? "", "text/plain");

    const body = res.text;
    assert(!body.includes("# Heading"));
    assert(!body.includes("**bold**"));
    assert(!body.includes("`code`"));
    assert(!body.includes("```"));
    assert(!body.match(/\[link\]\(/));
    assertStringIncludes(body, "Heading");
    assertStringIncludes(body, "bold");
    assertStringIncludes(body, "italic");
    assertStringIncludes(body, "link");
    assertStringIncludes(body, "const x = 1;");
  });

  await t.step("unsupported format returns 400 problem details", async () => {
    const { app } = await setupApp({ "001.md": "body" });
    const res = await makeRequest(app, "/api/stories/SeriesA/StoryA/export?format=pdf");
    assertEquals(res.status, 400);
    const parsed = JSON.parse(res.text) as { title: string; status: number; detail: string };
    assertEquals(parsed.status, 400);
    assertStringIncludes(parsed.detail, "Unsupported format");
  });

  await t.step("combined strip patterns remove both prompt and display tags", async () => {
    // Simulate patterns collected from promptStripTags (<user_message>) and
    // displayStripTags (<imgthink>) plus a regex-form entry.
    const combined = new RegExp(
      [
        "<user_message>[\\s\\S]*?</user_message>",
        "<imgthink>[\\s\\S]*?</imgthink>",
        "<secret-\\d+>[\\s\\S]*?</secret-\\d+>",
      ].join("|"),
      "gi",
    );
    const { app } = await setupApp(
      {
        "001.md": "visible <user_message>hidden prompt tag</user_message> stays",
        "002.md": "<imgthink>display tag</imgthink>kept",
        "003.md": "<secret-42>regex driven</secret-42>end",
      },
      combined,
    );

    for (const format of ["md", "json", "txt"] as const) {
      const res = await makeRequest(app, `/api/stories/SeriesA/StoryA/export?format=${format}`);
      assertEquals(res.status, 200);
      const body = res.text;
      assert(!body.includes("hidden prompt tag"), `${format}: prompt tag leaked`);
      assert(!body.includes("display tag"), `${format}: display tag leaked`);
      assert(!body.includes("regex driven"), `${format}: regex tag leaked`);
      assert(!body.includes("<user_message>"), `${format}: user_message element leaked`);
      assertStringIncludes(body, "visible");
      assertStringIncludes(body, "kept");
      assertStringIncludes(body, "end");
    }
  });

  await t.step("empty chapters and _lore/ directory are excluded", async () => {
    const combined = new RegExp("<strip>[\\s\\S]*?</strip>", "gi");
    const { app } = await setupApp(
      {
        "001.md": "first chapter",
        "002.md": "   \n  ", // whitespace only → omitted
        "003.md": "<strip>only strip</strip>", // empty after strip → omitted
        "004.md": "final chapter",
      },
      combined,
    );

    const res = await makeRequest(app, "/api/stories/SeriesA/StoryA/export?format=json");
    assertEquals(res.status, 200);
    const parsed = JSON.parse(res.text) as StoryExportJson;
    assertEquals(parsed.chapters.map((c) => c.number), [1, 4]);
    assert(!res.text.includes("LORE DO NOT EXPORT"));
  });

  await t.step("missing story returns 404", async () => {
    const { app } = await setupApp({ "001.md": "body" });
    const res = await makeRequest(app, "/api/stories/SeriesA/Nonexistent/export");
    assertEquals(res.status, 404);
  });

  await t.step("path traversal returns 400", async () => {
    const { app } = await setupApp({ "001.md": "body" });
    const res = await makeRequest(app, "/api/stories/SeriesA/..%2Fescape/export");
    assertEquals(res.status, 400);
  });

  await t.step("reserved underscore name returns 400", async () => {
    const { app } = await setupApp({ "001.md": "body" });
    const res = await makeRequest(app, "/api/stories/SeriesA/_lore/export");
    assertEquals(res.status, 400);
  });

  await t.step("missing passphrase returns 401", async () => {
    const { app } = await setupApp({ "001.md": "body" });
    const res = await app.fetch(
      new Request("http://localhost/api/stories/SeriesA/StoryA/export", { method: "GET" }),
    );
    assertEquals(res.status, 401);
  });

  await t.step("Content-Disposition encodes non-ASCII names with RFC 5987", async () => {
    const tmpDir = await Deno.makeTempDir({ prefix: "export-i18n-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    const storyDir = join(tmpDir, "系列", "故事");
    await Deno.mkdir(storyDir, { recursive: true });
    await Deno.writeTextFile(join(storyDir, "001.md"), "內容");
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
        getCombinedStripTagPatterns: () => null,
      } as unknown as PluginManager,
      hookDispatcher: new HookDispatcher(),
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({ messages: [], ventoError: null, targetChapterNumber: 0, existingContent: "", userMessageText: "", assistantPrefill: "" })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
      verifyPassphrase,
    } as AppDeps);

    const res = await app.fetch(
      new Request(
        `http://localhost/api/stories/${encodeURIComponent("系列")}/${encodeURIComponent("故事")}/export?format=md`,
        { method: "GET", headers: { "x-passphrase": "test-pass" } },
      ),
    );
    assertEquals(res.status, 200);
    const disp = res.headers.get("content-disposition") ?? "";
    // ASCII fallback (non-ASCII replaced with underscores).
    assert(/filename="[^"]+"/.test(disp), `ASCII filename missing: ${disp}`);
    // RFC 5987 param with UTF-8 and percent-encoded multibyte sequences.
    assertStringIncludes(disp, "filename*=UTF-8''");
    assert(/filename\*=UTF-8''[%A-Za-z0-9.\-_]+/.test(disp), `RFC5987 filename missing: ${disp}`);
    // The encoded form must contain percent-encoding of non-ASCII bytes.
    assert(disp.includes("%E7%B3%BB") || disp.includes("%E6%95%85"), `expected percent-encoded UTF-8 in: ${disp}`);
    await res.body?.cancel();
  });
}});
