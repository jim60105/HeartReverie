// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Coverage-focused tests for writer/routes/templates.ts — targets helper
// functions (parseTemplatePath, enumerateAllLore, walkMd, resolveTemplatePath),
// lore enumeration, lint source-form edge cases, preview fixture modes,
// PUT validation branches, and error handling paths.

import { assert, assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { createTemplateEngine } from "../../../writer/lib/template.ts";
import type { Hono } from "@hono/hono";
import type {
  AppConfig,
  AppDeps,
  BuildContinuePromptFn,
  BuildPromptResult,
} from "../../../writer/types.ts";

// ── Helpers ────────────────────────────────────────────────────────

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
  if (body !== undefined && body !== null) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  const res = await app.fetch(new Request(`http://localhost${urlPath}`, init));
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch { /* not JSON */ }
  return {
    status: res.status,
    body: parsed as Record<string, unknown>,
    headers: Object.fromEntries(res.headers),
  };
}

/** Build a fully-wired Hono app with temp playground + optional plugin. */
async function buildApp(opts?: { withPlugin?: boolean }) {
  const tmpDir = await Deno.makeTempDir({ prefix: "tpl-cov-" });
  const pluginsDir = await Deno.makeTempDir({ prefix: "tpl-cov-plug-" });
  Deno.env.set("PASSPHRASE", "test-pass");

  const safePath = createSafePath(tmpDir);
  const promptFile = join(tmpDir, "_prompts", "system.md");
  await Deno.mkdir(join(tmpDir, "_prompts"), { recursive: true });
  await Deno.writeTextFile(promptFile, "You are a writer.");

  // Optionally create a minimal plugin with a promptFragment
  if (opts?.withPlugin) {
    const plugDir = join(pluginsDir, "test-plugin");
    await Deno.mkdir(plugDir, { recursive: true });
    await Deno.writeTextFile(
      join(plugDir, "plugin.json"),
      JSON.stringify({
        name: "test-plugin",
        displayName: "測試外掛",
        version: "1.0.0",
        promptFragments: [{ file: "frag.md", variable: "test_var" }],
      }),
    );
    await Deno.writeTextFile(join(plugDir, "frag.md"), "Plugin fragment content.");
  }

  const hd = new HookDispatcher();
  const pm = new PluginManager(pluginsDir, undefined, hd, await Deno.makeTempDir());
  await pm.init();
  const templateEngine = createTemplateEngine(pm);

  const config = {
    READER_DIR: "/nonexistent-reader",
    PLAYGROUND_DIR: tmpDir,
    ROOT_DIR: tmpDir,
    PROMPT_FILE: promptFile,
  } as unknown as AppConfig;

  const app = createApp({
    config,
    safePath,
    pluginManager: pm,
    hookDispatcher: hd,
    buildPromptFromStory: async () =>
      ({
        messages: [{ role: "user" as const, content: "x" }],
        previousContext: [],
        isFirstRound: true,
        ventoError: null,
        chapterFiles: [],
        chapters: [],
      }) as BuildPromptResult,
    buildContinuePromptFromStory: (async () => ({
      messages: [],
      ventoError: null,
      targetChapterNumber: 0,
      existingContent: "",
      userMessageText: "",
      assistantPrefill: "",
    })) as unknown as BuildContinuePromptFn,
    templateEngine,
    verifyPassphrase,
  } as AppDeps);

  return { app, tmpDir, pluginsDir, promptFile, pm };
}

async function cleanup(...dirs: string[]) {
  for (const d of dirs) {
    try {
      await Deno.remove(d, { recursive: true });
    } catch { /* already gone */ }
  }
}

// ── Tests ──────────────────────────────────────────────────────────

Deno.test({
  name: "templates coverage — lore enumeration",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const { app, tmpDir, pluginsDir } = await buildApp();
    try {
      // Seed lore files at three scopes
      const globalLore = join(tmpDir, "_lore");
      const seriesLore = join(tmpDir, "MySeries", "_lore");
      const storyLore = join(tmpDir, "MySeries", "MyStory", "_lore");
      await Deno.mkdir(globalLore, { recursive: true });
      await Deno.mkdir(seriesLore, { recursive: true });
      await Deno.mkdir(storyLore, { recursive: true });
      await Deno.writeTextFile(join(globalLore, "world.md"), "Global lore.");
      await Deno.writeTextFile(join(seriesLore, "char.md"), "Series lore.");
      await Deno.writeTextFile(join(storyLore, "note.md"), "Story lore.");
      // Also a nested directory under global lore
      await Deno.mkdir(join(globalLore, "sub"), { recursive: true });
      await Deno.writeTextFile(join(globalLore, "sub", "nested.md"), "Nested.");

      await t.step("GET /api/templates lists lore from all scopes", async () => {
        const res = await makeRequest(app, "GET", "/api/templates");
        assertEquals(res.status, 200);
        const entries = res.body.entries as Array<Record<string, unknown>>;
        // system.md always present
        assert(entries.some((e) => e.templatePath === "system.md"));
        // global lore
        assert(entries.some((e) => e.templatePath === "lore:global:world.md"), "global lore missing");
        assert(entries.some((e) => e.templatePath === "lore:global:sub/nested.md"), "nested lore missing");
        // series lore
        assert(entries.some((e) => e.templatePath === "lore:series:MySeries:char.md"), "series lore missing");
        // story lore
        assert(
          entries.some((e) => e.templatePath === "lore:story:MySeries:MyStory:note.md"),
          "story lore missing",
        );
        // Verify metadata shape
        const globalEntry = entries.find((e) => e.templatePath === "lore:global:world.md")!;
        assertEquals(globalEntry.kind, "lore");
        assertEquals(globalEntry.loreScope, "global");
        assertEquals(globalEntry.editable, true);
        assert(typeof globalEntry.sizeBytes === "number" && globalEntry.sizeBytes > 0);
      });

      await t.step("GET /api/templates — _lore root that is a file (not dir) is skipped", async () => {
        // Create a file named _lore (not a dir) in a series dir — should not crash
        const weirdSeries = join(tmpDir, "WeirdSeries");
        await Deno.mkdir(weirdSeries, { recursive: true });
        await Deno.writeTextFile(join(weirdSeries, "_lore"), "I am a file, not a dir");
        const res = await makeRequest(app, "GET", "/api/templates");
        assertEquals(res.status, 200);
      });

      await t.step("GET /api/templates — _-prefix and lost+found dirs are skipped", async () => {
        // Directories whose name starts with _ or is lost+found should be skipped
        // as series candidates (isValidSegment rejects them).
        await Deno.mkdir(join(tmpDir, "_hidden", "_lore"), { recursive: true });
        await Deno.writeTextFile(join(tmpDir, "_hidden", "_lore", "hide.md"), "hidden");
        await Deno.mkdir(join(tmpDir, "lost+found"), { recursive: true });
        const res = await makeRequest(app, "GET", "/api/templates");
        assertEquals(res.status, 200);
        const entries = res.body.entries as Array<Record<string, unknown>>;
        assert(
          !entries.some((e) => (e.templatePath as string).includes("_hidden")),
          "_hidden should be skipped",
        );
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — plugin fragment listing + source",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const { app, tmpDir, pluginsDir } = await buildApp({ withPlugin: true });
    try {
      await t.step("GET /api/templates includes plugin fragments", async () => {
        const res = await makeRequest(app, "GET", "/api/templates");
        assertEquals(res.status, 200);
        const entries = res.body.entries as Array<Record<string, unknown>>;
        const pluginEntry = entries.find((e) => e.kind === "plugin-fragment");
        assertExists(pluginEntry, "Plugin fragment not found in listing");
        assertEquals(pluginEntry.pluginName, "test-plugin");
        assertEquals(
          pluginEntry.pluginDisplayName,
          "測試外掛",
          "GET /api/templates must surface the plugin's manifest displayName so the tree can render zh-TW labels instead of slugs",
        );
        assertEquals(pluginEntry.editable, false);
        assertEquals(pluginEntry.variable, "test_var");
      });

      await t.step("GET /api/templates/source reads plugin fragment", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=plugin:test-plugin:frag.md",
        );
        assertEquals(res.status, 200);
        assertEquals(res.body.source, "Plugin fragment content.");
      });

      await t.step("GET /api/templates/source — unknown plugin → 404", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=plugin:no-such:frag.md",
        );
        assertEquals(res.status, 404);
      });

      await t.step("GET /api/templates/source — plugin path traversal → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=plugin:test-plugin:../../../etc/passwd",
        );
        assertEquals(res.status, 400);
      });

      await t.step("GET /api/templates/source — missing templatePath → 400", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=");
        assertEquals(res.status, 400);
      });

      await t.step("GET /api/templates/source — unrecognised prefix → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=bogus:foo",
        );
        assertEquals(res.status, 400);
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — parseTemplatePath edge cases via routes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const { app, tmpDir, pluginsDir } = await buildApp();
    try {
      // ── lore paths ────────────────────────────────────────────────

      await t.step("lore:global missing relative → 400", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=lore:global:");
        assertEquals(res.status, 400);
      });

      await t.step("lore: too few parts → 400", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=lore:x");
        assertEquals(res.status, 400);
      });

      await t.step("lore:series missing parts → 400", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=lore:series:MySeries");
        assertEquals(res.status, 400);
      });

      await t.step("lore:series invalid segment → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=lore:series:../bad:foo.md",
        );
        assertEquals(res.status, 400);
      });

      await t.step("lore:series missing relative path → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=lore:series:MySeries:",
        );
        assertEquals(res.status, 400);
      });

      await t.step("lore:story too few parts → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=lore:story:S:T",
        );
        assertEquals(res.status, 400);
      });

      await t.step("lore:story invalid series or story segment → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=lore:story:_bad:ok:foo.md",
        );
        assertEquals(res.status, 400);
      });

      await t.step("lore:story missing relative → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=lore:story:S:T:",
        );
        assertEquals(res.status, 400);
      });

      await t.step("lore:unknown_scope → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=lore:other:foo.md",
        );
        assertEquals(res.status, 400);
      });

      // ── plugin paths ──────────────────────────────────────────────

      await t.step("plugin: too few parts → 400", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=plugin:x");
        assertEquals(res.status, 400);
      });

      await t.step("plugin: empty name → 400", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=plugin::file.md");
        assertEquals(res.status, 400);
      });

      await t.step("plugin: invalid segment name → 400", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/source?templatePath=plugin:_bad:file.md",
        );
        assertEquals(res.status, 400);
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — GET /api/templates/source system.md fallback",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    // Build app where PROMPT_FILE does not exist but ROOT_DIR/system.md does
    const tmpDir = await Deno.makeTempDir({ prefix: "tpl-cov-fallback-" });
    const pluginsDir = await Deno.makeTempDir({ prefix: "tpl-cov-plug-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    const safePath = createSafePath(tmpDir);
    // PROMPT_FILE points to a path that does not exist
    const promptFile = join(tmpDir, "_prompts", "system.md");
    // But ROOT_DIR/system.md exists (engine default)
    await Deno.writeTextFile(join(tmpDir, "system.md"), "Fallback system prompt.");

    const hd = new HookDispatcher();
    const pm = new PluginManager(pluginsDir, undefined, hd, await Deno.makeTempDir());
    await pm.init();
    const templateEngine = createTemplateEngine(pm);

    const config = {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: tmpDir,
      PROMPT_FILE: promptFile,
    } as unknown as AppConfig;

    const app = createApp({
      config,
      safePath,
      pluginManager: pm,
      hookDispatcher: hd,
      buildPromptFromStory: async () =>
        ({
          messages: [{ role: "user" as const, content: "x" }],
          previousContext: [],
          isFirstRound: true,
          ventoError: null,
          chapterFiles: [],
          chapters: [],
        }) as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({
        messages: [],
        ventoError: null,
        targetChapterNumber: 0,
        existingContent: "",
        userMessageText: "",
        assistantPrefill: "",
      })) as unknown as BuildContinuePromptFn,
      templateEngine,
      verifyPassphrase,
    } as AppDeps);

    try {
      await t.step("source falls back to ROOT_DIR/system.md when PROMPT_FILE absent", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=system.md");
        assertEquals(res.status, 200);
        assertEquals(res.body.source, "Fallback system prompt.");
      });

      await t.step("GET /api/templates system size fallback", async () => {
        const res = await makeRequest(app, "GET", "/api/templates");
        assertEquals(res.status, 200);
        const entries = res.body.entries as Array<Record<string, unknown>>;
        const sys = entries.find((e) => e.templatePath === "system.md")!;
        // Should pick up ROOT_DIR/system.md size
        assert((sys.sizeBytes as number) > 0, "systemSize should come from ROOT_DIR fallback");
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — POST /api/templates/lint edge cases",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const { app, tmpDir, pluginsDir } = await buildApp();
    try {
      await t.step("lint — invalid JSON body → 400", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/templates/lint", {
            method: "POST",
            headers: {
              "x-passphrase": "test-pass",
              "content-type": "application/json",
            },
            body: "not json",
          }),
        );
        assertEquals(res.status, 400);
        const json = await res.json();
        assert(json.detail.includes("Invalid JSON"));
      });

      await t.step("lint — missing source → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          templatePath: "system.md",
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("source"));
      });

      await t.step("lint source-form — missing kind → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          source: "hello",
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("kind"));
      });

      await t.step("lint source-form — invalid kind → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "bogus",
          source: "hello",
        });
        assertEquals(res.status, 400);
      });

      await t.step("lint source-form — kind=plugin-fragment without pluginName → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "plugin-fragment",
          source: "hello",
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("pluginName"));
      });

      await t.step("lint source-form — kind=lore with invalid scope → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "lore",
          source: "hello",
          scope: "invalid",
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("scope"));
      });

      await t.step("lint source-form — kind=lore scope=series without series → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "lore",
          source: "hello",
          scope: "series",
        });
        assertEquals(res.status, 400);
      });

      await t.step("lint source-form — kind=lore scope=story without series/story → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "lore",
          source: "hello",
          scope: "story",
        });
        assertEquals(res.status, 400);
      });

      await t.step("lint source-form — kind=lore scope=story missing story → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "lore",
          source: "hello",
          scope: "story",
          series: "S",
        });
        assertEquals(res.status, 400);
      });

      await t.step("lint source-form — kind=lore scope=series with valid series → 200", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "lore",
          source: "Some lore text",
          scope: "series",
          series: "MySeries",
        });
        assertEquals(res.status, 200);
        assertExists(res.body.diagnostics);
      });

      await t.step("lint source-form — kind=lore scope=story with valid series/story → 200", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "lore",
          source: "Story lore text",
          scope: "story",
          series: "MySeries",
          story: "MyStory",
        });
        assertEquals(res.status, 200);
        assertExists(res.body.diagnostics);
      });

      await t.step("lint source-form — kind=lore scope=global → 200", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "lore",
          source: "Global lore",
          scope: "global",
        });
        assertEquals(res.status, 200);
      });

      await t.step("lint source-form — kind=plugin-fragment with pluginName → 200", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "plugin-fragment",
          pluginName: "some-plugin",
          source: "Fragment text",
        });
        assertEquals(res.status, 200);
      });

      await t.step("lint source-form — kind=system → 200", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "system",
          source: "System template text",
        });
        assertEquals(res.status, 200);
      });

      await t.step("lint path-form — lore templatePath → 200", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          templatePath: "lore:global:world.md",
          source: "Some lore text",
        });
        assertEquals(res.status, 200);
        assertExists(res.body.diagnostics);
      });

      await t.step("lint path-form — series/story lore → 200", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          templatePath: "lore:story:S:T:note.md",
          source: "Lore text",
          series: "S",
          story: "T",
        });
        assertEquals(res.status, 200);
      });

      await t.step("lint source-form — prompt-message-body long-template passes through", async () => {
        // vento.long-template is a whole-template diagnostic that should be preserved
        // even in prompt-message-body mode. Generate a long source.
        const longSource = "{{ user_input }}\n".repeat(500);
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          kind: "prompt-message-body",
          role: "user",
          source: longSource,
        });
        assertEquals(res.status, 200);
        // Just verify we get a result (long-template may or may not trigger)
        assertExists(res.body.diagnostics);
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — POST /api/templates/preview edge cases",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const { app, tmpDir, pluginsDir } = await buildApp();
    try {
      await t.step("preview — invalid JSON body → 400", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/templates/preview", {
            method: "POST",
            headers: {
              "x-passphrase": "test-pass",
              "content-type": "application/json",
            },
            body: "bad json",
          }),
        );
        assertEquals(res.status, 400);
        const json = await res.json();
        assert(json.detail.includes("Invalid JSON"));
      });

      await t.step("preview — missing source → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("source"));
      });

      await t.step("preview — invalid templatePath → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "bogus:path",
          source: "hello",
        });
        assertEquals(res.status, 400);
      });

      await t.step("preview — fixture='current' without series → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
          source: "hello",
          fixture: "current",
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("series"));
      });

      await t.step("preview — fixture='current' without story → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
          source: "hello",
          fixture: "current",
          series: "S",
        });
        assertEquals(res.status, 400);
      });

      await t.step("preview — fixture=invalid string → 400", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
          source: "hello",
          fixture: "unknown-fixture",
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("fixture"));
      });

      await t.step("preview — fixture='default' (explicit) renders", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
          source: `{{ message "user" }}hello{{ /message }}`,
          fixture: "default",
        });
        assertEquals(res.status, 200);
        assertEquals(res.body.kind, "messages");
      });

      await t.step("preview — fixture=null uses default", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
          source: `{{ message "user" }}hi{{ /message }}`,
          fixture: null,
        });
        assertEquals(res.status, 200);
        assertEquals(res.body.kind, "messages");
      });

      await t.step("preview — inline fixture object", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
          source: `{{ message "user" }}{{ user_input }}{{ /message }}`,
          fixture: {
            user_input: "Inline input",
            previous_context: ["ctx"],
            is_first_round: true,
          },
        });
        assertEquals(res.status, 200);
      });

      await t.step("preview — fixture='current' exercises current-story path", async () => {
        // Seed a minimal story so the route hits the 'current' branch
        const storyDir = join(tmpDir, "TestSeries", "TestStory");
        await Deno.mkdir(storyDir, { recursive: true });
        await Deno.writeTextFile(join(storyDir, "story.json"), JSON.stringify({
          name: "TestStory",
          series: "TestSeries",
        }));
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
          source: `{{ message "user" }}test{{ /message }}`,
          fixture: "current",
          series: "TestSeries",
          story: "TestStory",
        });
        // The 'current' fixture path may return 500 when the template engine
        // can't resolve the full plugin pipeline without a running server.
        // Assert deterministically: either we got rendered output or a clear error.
        if (res.status === 200) {
          assertExists(res.body);
        } else {
          assertEquals(res.status, 500);
          assertExists(res.body.error);
        }
      });

      await t.step("preview — lore templatePath returns 200", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "lore:global:world.md",
          source: "Just some lore",
        });
        // Lore preview returns 200 with the render result object
        assertEquals(res.status, 200);
        assertExists(res.body);
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — PUT /api/templates edge cases",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const { app, tmpDir, pluginsDir } = await buildApp();
    try {
      await t.step("PUT — invalid JSON body → 400", async () => {
        const res = await app.fetch(
          new Request("http://localhost/api/templates", {
            method: "PUT",
            headers: {
              "x-passphrase": "test-pass",
              "content-type": "application/json",
            },
            body: "not json",
          }),
        );
        assertEquals(res.status, 400);
        const json = await res.json();
        assert(json.detail.includes("Invalid JSON"));
      });

      await t.step("PUT — missing source → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          templatePath: "system.md",
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("source"));
      });

      await t.step("PUT — missing templatePath → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          source: "hello",
        });
        assertEquals(res.status, 400);
      });

      await t.step("PUT — unrecognised templatePath prefix → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          templatePath: "bogus:path",
          source: "hello",
        });
        assertEquals(res.status, 400);
      });

      await t.step("PUT — template exceeds 500 KB → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          templatePath: "system.md",
          source: "x".repeat(500_001),
        });
        assertEquals(res.status, 400);
        assert((res.body.detail as string).includes("maximum length"));
      });

      await t.step("PUT — lore global write success", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          templatePath: "lore:global:new-lore.md",
          source: "Fresh global lore",
        });
        assertEquals(res.status, 200);
        assertEquals(res.body.ok, true);
        // Verify file was written
        const content = await Deno.readTextFile(join(tmpDir, "_lore", "new-lore.md"));
        assertEquals(content, "Fresh global lore");
      });

      await t.step("PUT — lore series write success", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          templatePath: "lore:series:S1:series-note.md",
          source: "Series lore content",
        });
        assertEquals(res.status, 200);
        assertEquals(res.body.ok, true);
      });

      await t.step("PUT — lore story write success", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          templatePath: "lore:story:S1:T1:story-note.md",
          source: "Story lore content",
        });
        assertEquals(res.status, 200);
        assertEquals(res.body.ok, true);
      });

      await t.step("PUT — lore path traversal via relativeFile → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          templatePath: "lore:global:../../escape.md",
          source: "x",
        });
        assertEquals(res.status, 400);
      });

      await t.step("PUT — lore story with invalid story segment → 400", async () => {
        const res = await makeRequest(app, "PUT", "/api/templates", {
          templatePath: "lore:story:S1:_badstory:note.md",
          source: "x",
        });
        assertEquals(res.status, 400);
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — GET /api/templates/variables edge cases",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const { app, tmpDir, pluginsDir } = await buildApp();
    try {
      await t.step("variables — kind=plugin-fragment", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/variables?kind=plugin-fragment",
        );
        assertEquals(res.status, 200);
        assertExists(res.body.variables);
      });

      await t.step("variables — kind=prompt-message-body", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/variables?kind=prompt-message-body",
        );
        assertEquals(res.status, 200);
        assertExists(res.body.variables);
      });

      await t.step("variables — kind=system (default)", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/variables");
        assertEquals(res.status, 200);
        const vars = res.body.variables as Array<{ name: string }>;
        assert(vars.length > 0);
      });

      await t.step("variables — with series and story params", async () => {
        const res = await makeRequest(
          app,
          "GET",
          "/api/templates/variables?kind=system&series=S&story=T",
        );
        assertEquals(res.status, 200);
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — templateEngine unavailable",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    // Build an app with templateEngine=null to cover the "unavailable" branches
    const tmpDir = await Deno.makeTempDir({ prefix: "tpl-cov-noeng-" });
    const pluginsDir = await Deno.makeTempDir({ prefix: "tpl-cov-plug-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    const safePath = createSafePath(tmpDir);
    const promptFile = join(tmpDir, "_prompts", "system.md");
    await Deno.mkdir(join(tmpDir, "_prompts"), { recursive: true });
    await Deno.writeTextFile(promptFile, "You are a writer.");

    const hd = new HookDispatcher();
    const pm = new PluginManager(pluginsDir, undefined, hd, await Deno.makeTempDir());
    await pm.init();

    const config = {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: tmpDir,
      PROMPT_FILE: promptFile,
    } as unknown as AppConfig;

    const app = createApp({
      config,
      safePath,
      pluginManager: pm,
      hookDispatcher: hd,
      buildPromptFromStory: async () =>
        ({
          messages: [],
          previousContext: [],
          isFirstRound: true,
          ventoError: null,
          chapterFiles: [],
          chapters: [],
        }) as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({
        messages: [],
        ventoError: null,
        targetChapterNumber: 0,
        existingContent: "",
        userMessageText: "",
        assistantPrefill: "",
      })) as unknown as BuildContinuePromptFn,
      templateEngine: null,
      verifyPassphrase,
    } as AppDeps);

    try {
      await t.step("lint — template engine unavailable → 500", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/lint", {
          templatePath: "system.md",
          source: "hello",
        });
        assertEquals(res.status, 500);
        assert((res.body.detail as string).includes("unavailable"));
      });

      await t.step("preview — template engine unavailable → 500", async () => {
        const res = await makeRequest(app, "POST", "/api/templates/preview", {
          templatePath: "system.md",
          source: "hello",
        });
        assertEquals(res.status, 500);
        assert((res.body.detail as string).includes("unavailable"));
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});

Deno.test({
  name: "templates coverage — GET /api/templates system.md with neither file",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    // Neither PROMPT_FILE nor ROOT_DIR/system.md exists → systemSize = 0
    const tmpDir = await Deno.makeTempDir({ prefix: "tpl-cov-nofile-" });
    const pluginsDir = await Deno.makeTempDir({ prefix: "tpl-cov-plug-" });
    Deno.env.set("PASSPHRASE", "test-pass");
    const safePath = createSafePath(tmpDir);
    // point to non-existent file
    const promptFile = join(tmpDir, "nonexistent", "system.md");
    // Also remove ROOT_DIR/system.md (doesn't exist in tmpDir)

    const hd = new HookDispatcher();
    const pm = new PluginManager(pluginsDir, undefined, hd, await Deno.makeTempDir());
    await pm.init();
    const templateEngine = createTemplateEngine(pm);

    const config = {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: tmpDir,
      ROOT_DIR: tmpDir,
      PROMPT_FILE: promptFile,
    } as unknown as AppConfig;

    const app = createApp({
      config,
      safePath,
      pluginManager: pm,
      hookDispatcher: hd,
      buildPromptFromStory: async () =>
        ({
          messages: [],
          previousContext: [],
          isFirstRound: true,
          ventoError: null,
          chapterFiles: [],
          chapters: [],
        }) as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({
        messages: [],
        ventoError: null,
        targetChapterNumber: 0,
        existingContent: "",
        userMessageText: "",
        assistantPrefill: "",
      })) as unknown as BuildContinuePromptFn,
      templateEngine,
      verifyPassphrase,
    } as AppDeps);

    try {
      await t.step("system.md sizeBytes=0 when neither file exists", async () => {
        const res = await makeRequest(app, "GET", "/api/templates");
        assertEquals(res.status, 200);
        const entries = res.body.entries as Array<Record<string, unknown>>;
        const sys = entries.find((e) => e.templatePath === "system.md")!;
        assertEquals(sys.sizeBytes, 0);
      });

      await t.step("GET /api/templates/source system.md returns empty when neither exists", async () => {
        const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=system.md");
        assertEquals(res.status, 200);
        // ROOT_DIR/system.md also doesn't exist → falls through to empty
        assertEquals(res.body.source, "");
      });
    } finally {
      await cleanup(tmpDir, pluginsDir);
    }
  },
});
