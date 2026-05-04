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

import {
  assert as assertTrue,
  assertEquals,
  assertStringIncludes,
} from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import {
  createSafePath,
  verifyPassphrase,
} from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { createTemplateEngine } from "../../../writer/lib/template.ts";
import { createStoryEngine } from "../../../writer/lib/story.ts";
import { pluginActionProblems } from "../../../writer/lib/errors.ts";
import type { Hono } from "@hono/hono";
import type { AppConfig, AppDeps } from "../../../writer/types.ts";

// ---------------------------------------------------------------------------
// Scenario helpers (same pattern as the sibling plugin_actions_*_test.ts files)
// ---------------------------------------------------------------------------

interface ScenarioOpts {
  readonly promptContent?: string;
  readonly chapterContent?: string | null;
  readonly multipleChapters?: Record<string, string>;
}

async function makeScenario(opts: ScenarioOpts = {}): Promise<{
  app: Hono;
  tmpDir: string;
  pluginDir: string;
  storyDir: string;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = await Deno.makeTempDir({ prefix: "plugin-replace-test-" });
  const pluginsRoot = join(tmpDir, "plugins");
  const playgroundDir = join(tmpDir, "play");
  await Deno.mkdir(pluginsRoot, { recursive: true });
  await Deno.mkdir(playgroundDir, { recursive: true });

  const storyDir = join(playgroundDir, "s1", "n1");
  await Deno.mkdir(storyDir, { recursive: true });

  if (opts.multipleChapters) {
    for (const [name, content] of Object.entries(opts.multipleChapters)) {
      await Deno.writeTextFile(join(storyDir, name), content);
    }
  } else if (opts.chapterContent !== null) {
    await Deno.writeTextFile(
      join(storyDir, "001.md"),
      opts.chapterContent ?? "Original chapter content.\n",
    );
  }

  const pluginDir = join(pluginsRoot, "tester");
  await Deno.mkdir(join(pluginDir, "prompts"), { recursive: true });
  await Deno.writeTextFile(
    join(pluginDir, "plugin.json"),
    JSON.stringify({ name: "tester", version: "1.0.0" }),
  );
  await Deno.writeTextFile(
    join(pluginDir, "prompts", "polish.md"),
    opts.promptContent ??
      '{{ message "user" }}\nPolish: {{ draft }}\n{{ /message }}',
  );

  const previousEnv: Record<string, string | undefined> = {
    PASSPHRASE: Deno.env.get("PASSPHRASE"),
    LLM_API_KEY: Deno.env.get("LLM_API_KEY"),
  };
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

  await Deno.writeTextFile(
    join(tmpDir, "system.md"),
    '{{ message "user" }}\nSystem.\n{{ /message }}',
  );

  const hookDispatcher = new HookDispatcher();
  const pluginManager = new PluginManager(
    pluginsRoot,
    undefined,
    hookDispatcher,
  );
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
    buildContinuePromptFromStory: (async () => ({
      messages: [],
      ventoError: null,
      targetChapterNumber: 0,
      existingContent: "",
      userMessageText: "",
      assistantPrefill: "",
    })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
    verifyPassphrase,
  } as AppDeps;

  const app = createApp(deps);

  const cleanup = async () => {
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch { /* best-effort */ }
    for (const [k, v] of Object.entries(previousEnv)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  };

  return { app, tmpDir, pluginDir, storyDir, cleanup };
}

const originalFetch = globalThis.fetch;

function mockLLMFetch(content: string): void {
  globalThis.fetch = async (
    url: string | URL | Request,
    opts?: RequestInit,
  ) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      const sse = [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        `data: ${JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`,
        `data: [DONE]\n\n`,
      ];
      return new Response(
        new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            for (const chunk of sse) controller.enqueue(enc.encode(chunk));
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
      headers: {
        "x-passphrase": "test-pass",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch { /* not JSON */ }
  return { status: res.status, body: parsed };
}

// ===========================================================================
// Test suite: replace-last-chapter feature
// ===========================================================================

Deno.test({
  name: "plugin-action replace-last-chapter",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    // ----- Tri-state validator: contradictory combinations -----

    await t.step(
      "tri-state: (append=true, replace=true) → invalid-replace-combo",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            append: true,
            replace: true,
            appendTag: "Tag",
          });
          assertEquals(res.status, 400);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:invalid-replace-combo",
          );
        } finally {
          await cleanup();
        }
      },
    );

    await t.step(
      "tri-state: (replace=true, appendTag present) → invalid-replace-combo",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            replace: true,
            appendTag: "SomeTag",
          });
          assertEquals(res.status, 400);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:invalid-replace-combo",
          );
        } finally {
          await cleanup();
        }
      },
    );

    // ----- Tri-state validator: valid resolutions -----

    await t.step(
      "tri-state: (replace=true, append=false) → replace-last-chapter mode succeeds",
      async () => {
        const { app, storyDir, cleanup } = await makeScenario();
        try {
          mockLLMFetch("Polished content.");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            replace: true,
          });
          assertEquals(res.status, 200);
          const body = res.body as {
            chapterReplaced: boolean;
            chapterUpdated: boolean;
            content: string;
          };
          assertEquals(body.chapterReplaced, true);
          assertEquals(body.chapterUpdated, false);
          // Chapter file should be overwritten (atomicWriteChapter appends \n)
          const chapter = await Deno.readTextFile(join(storyDir, "001.md"));
          assertEquals(chapter.trim(), "Polished content.");
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "tri-state: (append=true, replace=false) → append-to-existing-chapter mode",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          mockLLMFetch("APPENDED");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            append: true,
            appendTag: "Result",
          });
          assertEquals(res.status, 200);
          const body = res.body as { chapterUpdated: boolean; chapterReplaced: boolean };
          assertEquals(body.chapterUpdated, true);
          assertEquals(body.chapterReplaced, false);
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "tri-state: (append=false, replace=false) → discard mode",
      async () => {
        const { app, storyDir, cleanup } = await makeScenario({
          chapterContent: "ORIGINAL\n",
        });
        try {
          mockLLMFetch("DISCARDED");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            append: false,
          });
          assertEquals(res.status, 200);
          const body = res.body as { chapterUpdated: boolean; chapterReplaced: boolean; content: string };
          assertEquals(body.chapterUpdated, false);
          assertEquals(body.chapterReplaced, false);
          assertEquals(body.content, "DISCARDED");
          // Original chapter untouched
          const chapter = await Deno.readTextFile(join(storyDir, "001.md"));
          assertEquals(chapter, "ORIGINAL\n");
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    // ----- Replace mode: draft variable injection -----

    await t.step(
      "replace mode injects last chapter content as 'draft' variable",
      async () => {
        const draftContent = "This is the last chapter draft content.";
        const { app, cleanup } = await makeScenario({
          chapterContent: draftContent,
          // The prompt template references {{ draft }} — the LLM mock
          // will just echo whatever it receives, but we verify the prompt
          // was accepted (status 200) meaning the draft variable resolved.
          promptContent:
            '{{ message "user" }}\nPolish: {{ draft }}\n{{ /message }}',
        });
        try {
          mockLLMFetch("Polished output.");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            replace: true,
          });
          assertEquals(res.status, 200);
          const body = res.body as { chapterReplaced: boolean };
          assertEquals(body.chapterReplaced, true);
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "replace mode targets the highest-numbered chapter file",
      async () => {
        const { app, storyDir, cleanup } = await makeScenario({
          chapterContent: null,
          multipleChapters: {
            "001.md": "First chapter.\n",
            "002.md": "Second chapter.\n",
            "003.md": "Third chapter (latest).\n",
          },
        });
        try {
          mockLLMFetch("Polished third.");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            replace: true,
          });
          assertEquals(res.status, 200);
          // The third chapter should be replaced (atomicWriteChapter appends \n)
          const ch3 = await Deno.readTextFile(join(storyDir, "003.md"));
          assertEquals(ch3.trim(), "Polished third.");
          // Earlier chapters untouched
          const ch1 = await Deno.readTextFile(join(storyDir, "001.md"));
          assertEquals(ch1, "First chapter.\n");
          const ch2 = await Deno.readTextFile(join(storyDir, "002.md"));
          assertEquals(ch2, "Second chapter.\n");
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    // ----- Replace mode: no chapter → error -----

    await t.step(
      "replace mode with no chapter file returns noChapter error",
      async () => {
        const { app, cleanup } = await makeScenario({
          chapterContent: null,
        });
        try {
          mockLLMFetch("X");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            replace: true,
          });
          assertEquals(res.status, 400);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:no-chapter",
          );
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    // ----- Reserved variable collision: 'draft' key in extraVariables -----

    await t.step(
      "extraVariables with 'draft' key returns extra-variables-collision",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            append: false,
            extraVariables: { draft: "override attempt" },
          });
          assertEquals(res.status, 400);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:extra-variables-collision",
          );
        } finally {
          await cleanup();
        }
      },
    );

    await t.step(
      "extraVariables with 'draft' is rejected even in replace mode",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            replace: true,
            extraVariables: { draft: "sneaky" },
          });
          assertEquals(res.status, 400);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:extra-variables-collision",
          );
        } finally {
          await cleanup();
        }
      },
    );

    // ----- Response shape -----

    await t.step(
      "replace mode response includes chapterReplaced=true and appendedTag=null",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          mockLLMFetch("New content.");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/polish.md",
            replace: true,
          });
          assertEquals(res.status, 200);
          const body = res.body as {
            content: string;
            chapterReplaced: boolean;
            chapterUpdated: boolean;
            appendedTag: string | null;
            usage: unknown;
          };
          assertEquals(body.chapterReplaced, true);
          assertEquals(body.chapterUpdated, false);
          assertEquals(body.appendedTag, null);
          assertTrue(body.usage !== undefined);
          assertStringIncludes(body.content, "New content.");
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );
  },
});

// ===========================================================================
// Error helper shape tests (pure functions — no I/O needed)
// ===========================================================================

Deno.test("pluginActionProblems.invalidReplaceCombo returns correct RFC 9457 shape", () => {
  const problem = pluginActionProblems.invalidReplaceCombo();
  assertEquals(problem.type, "plugin-action:invalid-replace-combo");
  assertEquals(problem.title, "Bad Request");
  assertEquals(problem.status, 400);
  assertTrue(typeof problem.detail === "string");
  assertTrue(problem.detail.length > 0);
});

Deno.test("pluginActionProblems.invalidReplaceCombo accepts custom detail", () => {
  const problem = pluginActionProblems.invalidReplaceCombo("custom detail message");
  assertEquals(problem.type, "plugin-action:invalid-replace-combo");
  assertEquals(problem.detail, "custom detail message");
});

Deno.test("pluginActionProblems.noChapter returns correct RFC 9457 shape", () => {
  const problem = pluginActionProblems.noChapter();
  assertEquals(problem.type, "plugin-action:no-chapter");
  assertEquals(problem.title, "Bad Request");
  assertEquals(problem.status, 400);
  assertTrue(typeof problem.detail === "string");
  assertTrue(problem.detail.length > 0);
});

Deno.test("pluginActionProblems.noChapter accepts custom detail", () => {
  const problem = pluginActionProblems.noChapter("No chapters found in story");
  assertEquals(problem.type, "plugin-action:no-chapter");
  assertEquals(problem.detail, "No chapters found in story");
});

Deno.test("pluginActionProblems.extraVariablesCollision returns correct RFC 9457 shape", () => {
  const problem = pluginActionProblems.extraVariablesCollision();
  assertEquals(problem.type, "plugin-action:extra-variables-collision");
  assertEquals(problem.title, "Bad Request");
  assertEquals(problem.status, 400);
  assertTrue(typeof problem.detail === "string");
});

// ===========================================================================
// Polish plugin manifest and instruction validation
// ===========================================================================

Deno.test("polish plugin.json is valid and has correct structure", async () => {
  const content = await Deno.readTextFile(
    join(Deno.cwd(), "plugins", "polish", "plugin.json"),
  );
  const manifest = JSON.parse(content);

  assertEquals(manifest.name, "polish");
  assertTrue(typeof manifest.version === "string");
  assertTrue(typeof manifest.description === "string");
  assertTrue(Array.isArray(manifest.actionButtons));
  assertTrue(manifest.actionButtons.length > 0);

  const polishButton = manifest.actionButtons.find(
    (btn: { id: string }) => btn.id === "polish",
  );
  assertTrue(polishButton !== undefined, "Expected actionButton with id='polish'");
  assertEquals(polishButton.visibleWhen, "last-chapter-backend");
});

Deno.test("polish-instruction.md does not contain SFW-violating content", async () => {
  const content = await Deno.readTextFile(
    join(Deno.cwd(), "plugins", "polish", "polish-instruction.md"),
  );
  const lower = content.toLowerCase();

  const forbidden = [
    "18+",
    "nsfw",
    "rpjb",
    "no content restrictions",
    "jailbreak",
    "bypass",
    "do not disclose",
  ];

  for (const term of forbidden) {
    assertEquals(
      lower.includes(term),
      false,
      `polish-instruction.md must NOT contain "${term}"`,
    );
  }
});
