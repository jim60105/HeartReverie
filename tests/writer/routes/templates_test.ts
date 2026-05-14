// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Integration tests for /api/templates endpoints (GET, POST lint, POST
// preview, PUT save). Covers auth, listing shape, lint rules, preview
// modes, PUT 403/422/400 paths, .bak rotation, and symlink rejection.

import { assert, assertEquals } from "@std/assert";
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
  try { parsed = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body: parsed as Record<string, unknown>, headers: Object.fromEntries(res.headers) };
}

async function buildApp() {
  const tmpDir = await Deno.makeTempDir({ prefix: "tpl-route-test-" });
  const pluginsDir = await Deno.makeTempDir();
  Deno.env.set("PASSPHRASE", "test-pass");
  const safePath = createSafePath(tmpDir);
  const promptFile = join(tmpDir, "_prompts", "system.md");
  await Deno.mkdir(join(tmpDir, "_prompts"), { recursive: true });
  await Deno.writeTextFile(promptFile, "You are a writer.");

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
    buildPromptFromStory: async () => ({
      messages: [{ role: "user" as const, content: "x" }],
      previousContext: [],
      isFirstRound: true,
      ventoError: null,
      chapterFiles: [],
      chapters: [],
    } as BuildPromptResult),
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

  return { app, tmpDir, pluginsDir, promptFile };
}

Deno.test({ name: "templates routes", sanitizeOps: false, sanitizeResources: false, fn: async (t) => {
  const { app, tmpDir, promptFile } = await buildApp();
  try {
    await t.step("401 without passphrase", async () => {
      const res = await app.fetch(new Request("http://localhost/api/templates"));
      assertEquals(res.status, 401);
    });

    await t.step("GET /api/templates lists system.md", async () => {
      const res = await makeRequest(app, "GET", "/api/templates");
      assertEquals(res.status, 200);
      const entries = res.body.entries as Array<Record<string, unknown>>;
      assert(entries.some((e) => e.templatePath === "system.md"));
    });

    await t.step("GET /api/templates/variables returns catalog", async () => {
      const res = await makeRequest(app, "GET", "/api/templates/variables");
      assertEquals(res.status, 200);
      const vars = res.body.variables as Array<{ name: string }>;
      assert(vars.some((v) => v.name === "user_input"));
    });

    await t.step("POST /api/templates/lint surfaces SSTI", async () => {
      const res = await makeRequest(app, "POST", "/api/templates/lint", {
        templatePath: "system.md",
        source: "{{ set evil = 1 }}",
      });
      assertEquals(res.status, 200);
      const diagnostics = res.body.diagnostics as Array<{ ruleId: string }>;
      assert(diagnostics.some((d) => d.ruleId === "vento.unsafe-expression"));
    });

    await t.step("POST /api/templates/preview default fixture", async () => {
      const res = await makeRequest(app, "POST", "/api/templates/preview", {
        templatePath: "system.md",
        source: `{{ message "user" }}{{ user_input }}{{ /message }}`,
      });
      assertEquals(res.status, 200);
      assertEquals(res.body.kind, "messages");
    });

    await t.step("GET /api/templates/source returns existing system.md content", async () => {
      // Read existing seeded system.md content without mutating it.
      const res = await makeRequest(app, "GET", "/api/templates/source?templatePath=system.md");
      assertEquals(res.status, 200);
      assertEquals(typeof res.body.source, "string");
      assertEquals(res.body.templatePath, "system.md");
    });

    await t.step("GET /api/templates/source returns empty source for missing file", async () => {
      const res = await makeRequest(
        app,
        "GET",
        "/api/templates/source?templatePath=lore:global:does-not-exist.md",
      );
      assertEquals(res.status, 200);
      assertEquals(res.body.source, "");
    });

    await t.step("GET /api/templates/source rejects path traversal", async () => {
      const res = await makeRequest(
        app,
        "GET",
        "/api/templates/source?templatePath=lore:global:../../etc/passwd",
      );
      assertEquals(res.status, 400);
    });

    await t.step("POST /api/templates/lint does NOT flag string-literal contents", async () => {
      const res = await makeRequest(app, "POST", "/api/templates/lint", {
        templatePath: "system.md",
        source: `{{ message "user" }}{{ user_input }}{{ /message }}`,
      });
      assertEquals(res.status, 200);
      const diagnostics = res.body.diagnostics as Array<{ ruleId: string; message: string }>;
      // "user" inside the message tag's string literal must not produce an unknown-variable warning
      assert(!diagnostics.some((d) =>
        d.ruleId === "vento.unknown-variable" && d.message.includes("user")
      ));
    });

    await t.step("PUT plugin: → 403", async () => {
      const res = await makeRequest(app, "PUT", "/api/templates", {
        templatePath: "plugin:any:frag.md",
        source: "hi",
      });
      assertEquals(res.status, 403);
    });

    await t.step("PUT SSTI → 422", async () => {
      const res = await makeRequest(app, "PUT", "/api/templates", {
        templatePath: "system.md",
        source: "{{ set evil = 1 }}",
      });
      assertEquals(res.status, 422);
      assert(Array.isArray(res.body.expressions));
    });

    await t.step("PUT system.md success + .bak rotation", async () => {
      const res = await makeRequest(app, "PUT", "/api/templates", {
        templatePath: "system.md",
        source: "Revision A",
      });
      assertEquals(res.status, 200);
      assertEquals(await Deno.readTextFile(promptFile), "Revision A");
      assertEquals(await Deno.readTextFile(promptFile + ".bak"), "You are a writer.");

      const res2 = await makeRequest(app, "PUT", "/api/templates", {
        templatePath: "system.md",
        source: "Revision B",
      });
      assertEquals(res2.status, 200);
      assertEquals(await Deno.readTextFile(promptFile), "Revision B");
      // .bak should now hold Revision A, with a timestamped older backup beside it
      assertEquals(await Deno.readTextFile(promptFile + ".bak"), "Revision A");
    });

    await t.step("PUT lore with .. → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/templates", {
        templatePath: "lore:global:../escape.md",
        source: "x",
      });
      assertEquals(res.status, 400);
    });

    await t.step("PUT lore with invalid series segment → 400", async () => {
      const res = await makeRequest(app, "PUT", "/api/templates", {
        templatePath: "lore:series:bad..series:foo.md",
        source: "x",
      });
      assertEquals(res.status, 400);
    });

    await t.step("PUT symlink target → 400", async () => {
      const realFile = join(tmpDir, "_prompts", "real.md");
      const link = join(tmpDir, "_prompts", "link.md");
      await Deno.writeTextFile(realFile, "original");
      try { await Deno.remove(link); } catch { /* noop */ }
      await Deno.symlink(realFile, link);
      // The system.md path is fixed by config; instead, try to write a lore entry that we'll symlink.
      const loreDir = join(tmpDir, "_lore");
      await Deno.mkdir(loreDir, { recursive: true });
      const realLore = join(loreDir, "real.md");
      const linkLore = join(loreDir, "link.md");
      await Deno.writeTextFile(realLore, "orig");
      try { await Deno.remove(linkLore); } catch { /* noop */ }
      await Deno.symlink(realLore, linkLore);

      const res = await makeRequest(app, "PUT", "/api/templates", {
        templatePath: "lore:global:link.md",
        source: "new",
      });
      assertEquals(res.status, 400);
    });

    await t.step("GET /api/templates/variables honors kind=lore", async () => {
      const res = await makeRequest(app, "GET", "/api/templates/variables?kind=lore");
      assertEquals(res.status, 200);
      const vars = res.body.variables as Array<{ name: string }>;
      // lore catalog excludes engine runtime vars like user_input
      assert(!vars.some((v) => v.name === "user_input"));
    });

    await t.step("GET /api/templates/variables rejects invalid kind", async () => {
      const res = await makeRequest(app, "GET", "/api/templates/variables?kind=bogus");
      assertEquals(res.status, 400);
    });

    await t.step("POST /api/templates/lint source-form prompt-message-body", async () => {
      // body lints clean
      const ok = await makeRequest(app, "POST", "/api/templates/lint", {
        kind: "prompt-message-body",
        role: "user",
        source: "{{ user_input }}",
      });
      assertEquals(ok.status, 200);
      assertEquals((ok.body.diagnostics as unknown[]).length, 0);

      // nested message produces vento.message-nested at user-line 1
      const nested = await makeRequest(app, "POST", "/api/templates/lint", {
        kind: "prompt-message-body",
        role: "user",
        source: `{{ message "user" }}hi{{ /message }}`,
      });
      assertEquals(nested.status, 200);
      const ndiags = nested.body.diagnostics as Array<{ ruleId: string; line: number }>;
      assert(ndiags.some((d) => d.ruleId === "vento.message-nested"));
      // diagnostic must point to user-source line (>=1), not the synthetic wrapper line 0
      assert(ndiags.every((d) => d.line >= 1));
    });

    await t.step("POST /api/templates/lint source-form prompt-message-body missing role", async () => {
      const res = await makeRequest(app, "POST", "/api/templates/lint", {
        kind: "prompt-message-body",
        source: "hi",
      });
      assertEquals(res.status, 400);
    });

    await t.step("POST /api/templates/lint source-form kind=lore", async () => {
      const res = await makeRequest(app, "POST", "/api/templates/lint", {
        kind: "lore",
        source: "{{ user_input }}",
      });
      assertEquals(res.status, 200);
      // user_input is NOT in lore catalog → unknown-variable warning expected
      const diags = res.body.diagnostics as Array<{ ruleId: string }>;
      assert(diags.some((d) => d.ruleId === "vento.unknown-variable"));
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
}});
