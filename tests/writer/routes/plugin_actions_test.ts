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

import { assertEquals, assert as assertTrue, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { createTemplateEngine } from "../../../writer/lib/template.ts";
import { createStoryEngine } from "../../../writer/lib/story.ts";
import type { Hono } from "@hono/hono";
import type { AppDeps, AppConfig } from "../../../writer/types.ts";

interface ScenarioOpts {
  readonly promptContent?: string;
  readonly chapterContent?: string | null;
  readonly actionButtons?: unknown;
  readonly extraPluginFiles?: Record<string, string>;
}

async function makeScenario(opts: ScenarioOpts = {}): Promise<{
  app: Hono;
  tmpDir: string;
  pluginDir: string;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = await Deno.makeTempDir({ prefix: "plugin-action-test-" });
  const pluginsRoot = join(tmpDir, "plugins");
  const playgroundDir = join(tmpDir, "play");
  await Deno.mkdir(pluginsRoot, { recursive: true });
  await Deno.mkdir(playgroundDir, { recursive: true });

  // Pre-create story dir + chapter (when requested).
  const storyDir = join(playgroundDir, "s1", "n1");
  await Deno.mkdir(storyDir, { recursive: true });
  if (opts.chapterContent !== null) {
    await Deno.writeTextFile(join(storyDir, "001.md"), opts.chapterContent ?? "Existing chapter content.\n");
  }

  // Build a real plugin directory.
  const pluginDir = join(pluginsRoot, "tester");
  await Deno.mkdir(join(pluginDir, "prompts"), { recursive: true });
  const manifest: Record<string, unknown> = {
    name: "tester",
    version: "1.0.0",
  };
  if (opts.actionButtons !== undefined) {
    manifest.actionButtons = opts.actionButtons;
  }
  await Deno.writeTextFile(join(pluginDir, "plugin.json"), JSON.stringify(manifest));
  await Deno.writeTextFile(
    join(pluginDir, "prompts", "summary.md"),
    opts.promptContent ?? "{{ message \"user\" }}\nSummarise.\n{{ /message }}",
  );
  if (opts.extraPluginFiles) {
    for (const [rel, content] of Object.entries(opts.extraPluginFiles)) {
      const fullPath = join(pluginDir, rel);
      await Deno.mkdir(join(fullPath, ".."), { recursive: true });
      await Deno.writeTextFile(fullPath, content);
    }
  }

  Deno.env.set("PASSPHRASE", "test-pass");
  Deno.env.set("LLM_API_KEY", "test-key");

  const safePath = createSafePath(playgroundDir);
  const config: AppConfig = {
    READER_DIR: "/nonexistent-reader",
    PLAYGROUND_DIR: playgroundDir,
    ROOT_DIR: tmpDir,
    LLM_API_URL: "https://openrouter.ai/api/v1/chat/completions",
    LLM_MODEL: "test-model",
    LLM_REASONING_OMIT: true,
    llmDefaults: {
      model: "test-model",
      temperature: 0.1,
      frequencyPenalty: 0,
      presencePenalty: 0,
      topK: 0,
      topP: 1,
      repetitionPenalty: 1,
      minP: 0,
      topA: 0,
      reasoningEnabled: false,
      reasoningEffort: "high",
      maxCompletionTokens: 4096,
    },
  } as unknown as AppConfig;

  // Provide a system.md so renderSystemPrompt has a fallback (we override
  // per-call, but the existence check is still cheap).
  await Deno.writeTextFile(join(tmpDir, "system.md"), "{{ message \"user\" }}\nSystem.\n{{ /message }}");

  const hookDispatcher = new HookDispatcher();
  const pluginManager = new PluginManager(pluginsRoot, undefined, hookDispatcher);
  await pluginManager.init();

  const templateEngine = createTemplateEngine(pluginManager);
  const storyEngine = createStoryEngine(
    pluginManager,
    safePath,
    templateEngine.renderSystemPrompt,
    hookDispatcher,
  );

  const deps: AppDeps = {
    config,
    safePath,
    pluginManager,
    hookDispatcher,
    buildPromptFromStory: storyEngine.buildPromptFromStory,
    buildContinuePromptFromStory: (async () => ({ messages: [], ventoError: null, targetChapterNumber: 0, existingContent: "", userMessageText: "", assistantPrefill: "" })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
    verifyPassphrase,
  } as AppDeps;

  const app = createApp(deps);

  const cleanup = async () => {
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch {
      // best-effort
    }
  };

  return { app, tmpDir, pluginDir, cleanup };
}

const originalFetch = globalThis.fetch;

function mockLLMFetch(content: string) {
  globalThis.fetch = async (url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      const sse = [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
        `data: [DONE]\n\n`,
      ];
      return new Response(
        new ReadableStream({
          start(controller) {
            const encoder = new TextEncoder();
            for (const chunk of sse) controller.enqueue(encoder.encode(chunk));
            controller.close();
          },
        }),
        { status: 200 },
      );
    }
    return originalFetch(url, opts);
  };
}

async function callRoute(
  app: Hono,
  pluginName: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await app.fetch(
    new Request(`http://localhost/api/plugins/${pluginName}/run-prompt`, {
      method: "POST",
      headers: { "x-passphrase": "test-pass", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    // not JSON
  }
  return { status: res.status, body: parsed };
}

Deno.test({
  name: "plugin-action route",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await t.step("happy path append: appends wrapped content to last chapter", async () => {
      const { app, tmpDir, cleanup } = await makeScenario();
      try {
        mockLLMFetch("STATE_PATCH");
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: true,
          appendTag: "UpdateVariable",
        });
        assertEquals(res.status, 200);
        const body = res.body as { content: string; chapterUpdated: boolean; appendedTag: string };
        assertEquals(body.chapterUpdated, true);
        assertEquals(body.appendedTag, "UpdateVariable");
        const chapter = await Deno.readTextFile(join(tmpDir, "play", "s1", "n1", "001.md"));
        assertStringIncludes(chapter, "<UpdateVariable>\nSTATE_PATCH\n</UpdateVariable>");
        // Verify exactly ONE wrapper layer present.
        const matches = chapter.match(/<UpdateVariable>/g) ?? [];
        assertEquals(matches.length, 1);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    await t.step("happy path discard: chapter is NOT mutated", async () => {
      const { app, tmpDir, cleanup } = await makeScenario({ chapterContent: "ORIGINAL\n" });
      try {
        mockLLMFetch("RESPONSE");
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
        });
        assertEquals(res.status, 200);
        const body = res.body as { content: string; chapterUpdated: boolean; appendedTag: string | null };
        assertEquals(body.chapterUpdated, false);
        assertEquals(body.appendedTag, null);
        assertEquals(body.content, "RESPONSE");
        const chapter = await Deno.readTextFile(join(tmpDir, "play", "s1", "n1", "001.md"));
        assertEquals(chapter, "ORIGINAL\n");
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    await t.step("missing story directory returns 404", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "does-not-exist",
          promptFile: "prompts/summary.md",
          append: false,
        });
        assertEquals(res.status, 404);
      } finally {
        await cleanup();
      }
    });

    await t.step("path traversal in promptFile is rejected with 400", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "../../etc/passwd",
          append: false,
        });
        assertTrue(res.status === 400);
        const body = res.body as { type: string };
        assertTrue(body.type === "plugin-action:invalid-prompt-path" || body.type === "plugin-action:non-md-prompt");
      } finally {
        await cleanup();
      }
    });

    await t.step("symlink escape is rejected via realPath", async () => {
      const { app, pluginDir, cleanup } = await makeScenario();
      try {
        // Create a target file outside the plugin dir, then symlink it inside.
        const outside = await Deno.makeTempFile({ prefix: "outside-", suffix: ".md" });
        await Deno.writeTextFile(outside, "evil");
        const linkPath = join(pluginDir, "prompts", "evil.md");
        try {
          await Deno.symlink(outside, linkPath);
        } catch {
          // Symlinks may not be supported on this platform; mark test as skipped.
          await Deno.remove(outside);
          return;
        }
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/evil.md",
          append: false,
        });
        assertEquals(res.status, 400);
        const body = res.body as { type: string };
        assertEquals(body.type, "plugin-action:invalid-prompt-path");
        await Deno.remove(outside);
      } finally {
        await cleanup();
      }
    });

    await t.step("non-md prompt extension is rejected with 400", async () => {
      const { app, cleanup } = await makeScenario({
        extraPluginFiles: { "prompts/x.txt": "not markdown" },
      });
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/x.txt",
          append: false,
        });
        assertEquals(res.status, 400);
        const body = res.body as { type: string };
        assertEquals(body.type, "plugin-action:non-md-prompt");
      } finally {
        await cleanup();
      }
    });

    await t.step("unknown plugin returns 404", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "ghost", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
        });
        assertEquals(res.status, 404);
        const body = res.body as { type: string };
        assertEquals(body.type, "plugin-action:unknown-plugin");
      } finally {
        await cleanup();
      }
    });

    await t.step("invalid plugin name returns 400", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "evil..name", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
        });
        assertEquals(res.status, 400);
        const body = res.body as { type: string };
        assertEquals(body.type, "plugin-action:invalid-plugin-name");
      } finally {
        await cleanup();
      }
    });

    await t.step("missing appendTag in append mode returns 400", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: true,
        });
        assertEquals(res.status, 400);
        const body = res.body as { type: string };
        assertEquals(body.type, "plugin-action:invalid-append-tag");
      } finally {
        await cleanup();
      }
    });

    await t.step("invalid appendTag pattern returns 400", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: true,
          appendTag: "9bad!",
        });
        assertEquals(res.status, 400);
        const body = res.body as { type: string };
        assertEquals(body.type, "plugin-action:invalid-append-tag");
      } finally {
        await cleanup();
      }
    });

    await t.step("non-scalar extraVariables returns 400", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
          extraVariables: { foo: { nested: 1 } },
        });
        assertEquals(res.status, 400);
        const body = res.body as { type: string };
        assertEquals(body.type, "plugin-action:invalid-extra-variables");
      } finally {
        await cleanup();
      }
    });

    await t.step("extraVariables key collision returns 400", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
          extraVariables: { previousContext: "evil" },
        });
        assertEquals(res.status, 400);
        const body = res.body as { type: string };
        assertEquals(body.type, "plugin-action:extra-variables-collision");
      } finally {
        await cleanup();
      }
    });

    await t.step("prompt missing user message returns 422 with multi-message slug", async () => {
      const { app, cleanup } = await makeScenario({
        promptContent: "no message tag here",
      });
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
        });
        assertEquals(res.status, 422);
        const body = res.body as { type: string };
        assertEquals(body.type, "multi-message:no-user-message");
      } finally {
        await cleanup();
      }
    });

    await t.step("concurrent generation returns 409", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const { markGenerationActive, clearGenerationActive } = await import(
          "../../../writer/lib/generation-registry.ts"
        );
        markGenerationActive("s1", "n1");
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: false,
          });
          assertEquals(res.status, 409);
          const body = res.body as { type: string };
          assertEquals(body.type, "plugin-action:concurrent-generation");
        } finally {
          clearGenerationActive("s1", "n1");
        }
      } finally {
        await cleanup();
      }
    });

    await t.step("append wrapper normalisation strips ONE outer layer", async () => {
      const { app, tmpDir, cleanup } = await makeScenario();
      try {
        // LLM emits its own outer wrapper; normalisation should strip it.
        mockLLMFetch("<UpdateVariable>\n  inner content\n</UpdateVariable>");
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: true,
          appendTag: "UpdateVariable",
        });
        assertEquals(res.status, 200);
        const chapter = await Deno.readTextFile(join(tmpDir, "play", "s1", "n1", "001.md"));
        const matches = chapter.match(/<UpdateVariable>/g) ?? [];
        assertEquals(matches.length, 1, "Outer wrapper should be normalised to a single layer");
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    await t.step("append wrapper normalisation preserves nested same-name elements", async () => {
      const { app, tmpDir, cleanup } = await makeScenario();
      try {
        // Double wrap → only the OUTER layer is stripped, inner layer is kept.
        mockLLMFetch("<UpdateVariable>\n<UpdateVariable>nested</UpdateVariable>\n</UpdateVariable>");
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: true,
          appendTag: "UpdateVariable",
        });
        assertEquals(res.status, 200);
        const chapter = await Deno.readTextFile(join(tmpDir, "play", "s1", "n1", "001.md"));
        const matches = chapter.match(/<UpdateVariable>/g) ?? [];
        assertEquals(matches.length, 2);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    await t.step("append on story with no chapter file returns 400", async () => {
      const { app, cleanup } = await makeScenario({ chapterContent: null });
      try {
        mockLLMFetch("X");
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: true,
          appendTag: "tag",
        });
        assertEquals(res.status, 400);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });
  },
});
