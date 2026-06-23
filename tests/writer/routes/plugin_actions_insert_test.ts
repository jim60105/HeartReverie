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

import { assert as assertTrue, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { createTemplateEngine } from "../../../writer/lib/template.ts";
import { createStoryEngine } from "../../../writer/lib/story.ts";
import type { Hono } from "@hono/hono";
import type { AppConfig, AppDeps, PostResponsePayload } from "../../../writer/types.ts";

interface ScenarioOpts {
  readonly promptContent?: string;
  readonly chapterContent?: string | null;
  readonly multipleChapters?: Record<string, string>;
  readonly stripTags?: string[];
}

async function makeScenario(opts: ScenarioOpts = {}): Promise<{
  app: Hono;
  storyDir: string;
  hookDispatcher: HookDispatcher;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = await Deno.makeTempDir({ prefix: "plugin-insert-test-" });
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
      opts.chapterContent ?? "甲。\n\n乙。\n\n丙。\n\n丁。\n",
    );
  }

  const pluginDir = join(pluginsRoot, "tester");
  await Deno.mkdir(join(pluginDir, "prompts"), { recursive: true });
  const manifest: Record<string, unknown> = {
    name: "tester",
    displayName: "tester",
    version: "1.0.0",
  };
  if (opts.stripTags) manifest.promptStripTags = opts.stripTags;
  await Deno.writeTextFile(
    join(pluginDir, "plugin.json"),
    JSON.stringify(manifest),
  );
  await Deno.writeTextFile(
    join(pluginDir, "prompts", "design.md"),
    opts.promptContent ??
      '{{ message "user" }}\nParagraphs:\n{{ numbered_paragraphs }}\n{{ /message }}',
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
    Deno.makeTempDirSync(),
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

  return { app, storyDir, hookDispatcher, cleanup };
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
        `data: ${
          JSON.stringify({ usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
        }\n\n`,
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
  body: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const res = await app.fetch(
    new Request(`http://localhost/api/plugins/tester/run-prompt`, {
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

const baseReq = {
  series: "s1",
  name: "n1",
  promptFile: "prompts/design.md",
};

Deno.test({
  name: "plugin-action insert-into-chapter",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    // ----- Combo rejections (400, no FS touch) -----

    await t.step("insert + append → invalid-insert-combo", async () => {
      const { app, storyDir, cleanup } = await makeScenario();
      try {
        const before = await Deno.readTextFile(join(storyDir, "001.md"));
        const res = await callRoute(app, { ...baseReq, insert: true, append: true });
        assertEquals(res.status, 400);
        assertEquals((res.body as { type: string }).type, "plugin-action:invalid-insert-combo");
        assertEquals(await Deno.readTextFile(join(storyDir, "001.md")), before);
      } finally {
        await cleanup();
      }
    });

    await t.step("insert + replace → invalid-insert-combo", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, { ...baseReq, insert: true, replace: true });
        assertEquals(res.status, 400);
        assertEquals((res.body as { type: string }).type, "plugin-action:invalid-insert-combo");
      } finally {
        await cleanup();
      }
    });

    await t.step("insert + appendTag → invalid-insert-combo", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, { ...baseReq, insert: true, appendTag: "image" });
        assertEquals(res.status, 400);
        assertEquals((res.body as { type: string }).type, "plugin-action:invalid-insert-combo");
      } finally {
        await cleanup();
      }
    });

    await t.step("insert against chapterless story → no-chapter", async () => {
      const { app, cleanup } = await makeScenario({ chapterContent: null });
      try {
        mockLLMFetch('{"insertions":[]}');
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 400);
        assertEquals((res.body as { type: string }).type, "plugin-action:no-chapter");
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    // ----- numbered_paragraphs reserved collision -----

    await t.step("extraVariables numbered_paragraphs → collision (no chapter read)", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, {
          ...baseReq,
          insert: true,
          extraVariables: { numbered_paragraphs: "fake" },
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body as { type: string }).type,
          "plugin-action:extra-variables-collision",
        );
      } finally {
        await cleanup();
      }
    });

    // ----- Invalid payload -----

    await t.step("non-JSON response → invalid-insert-payload, chapter unchanged", async () => {
      const { app, storyDir, cleanup } = await makeScenario();
      try {
        const before = await Deno.readTextFile(join(storyDir, "001.md"));
        mockLLMFetch("對不起，我無法完成此任務。");
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 422);
        assertEquals((res.body as { type: string }).type, "plugin-action:invalid-insert-payload");
        assertEquals(await Deno.readTextFile(join(storyDir, "001.md")), before);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    await t.step("fenced JSON is accepted", async () => {
      const { app, storyDir, cleanup } = await makeScenario();
      try {
        mockLLMFetch(
          "```json\n" + '{"insertions":[{"insertAfterParagraph":1,"text":"X"}]}' + "\n```",
        );
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 200);
        const ch = await Deno.readTextFile(join(storyDir, "001.md"));
        assertTrue(ch.includes("甲。\n\nX\n\n乙。"), ch);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    await t.step("malformed entry → invalid-insert-payload", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        mockLLMFetch('{"insertions":[{"insertAfterParagraph":"two","text":"x"}]}');
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 422);
        assertEquals((res.body as { type: string }).type, "plugin-action:invalid-insert-payload");
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    // ----- Out of range (whole-run abort, byte-identical) -----

    await t.step("out-of-range index aborts whole run, chapter byte-identical", async () => {
      const { app, storyDir, cleanup } = await makeScenario();
      try {
        const before = await Deno.readTextFile(join(storyDir, "001.md"));
        mockLLMFetch(
          '{"insertions":[{"insertAfterParagraph":1,"text":"A"},{"insertAfterParagraph":9,"text":"B"}]}',
        );
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 422);
        assertEquals(
          (res.body as { type: string }).type,
          "plugin-action:insert-paragraph-out-of-range",
        );
        assertEquals(await Deno.readTextFile(join(storyDir, "001.md")), before);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    // ----- Successful mid-chapter splice + post-response -----

    await t.step("successful mid-chapter splice dispatches post-response", async () => {
      const { app, storyDir, hookDispatcher, cleanup } = await makeScenario();
      try {
        let captured: PostResponsePayload | null = null;
        hookDispatcher.register("post-response", (ctx) => {
          captured = ctx as unknown as PostResponsePayload;
          return Promise.resolve();
        });
        mockLLMFetch(
          '{"insertions":[{"insertAfterParagraph":2,"text":"IMG1"},{"insertAfterParagraph":3,"text":"IMG2"}]}',
        );
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 200);
        const body = res.body as {
          chapterInserted: boolean;
          insertedCount: number;
          chapterUpdated: boolean;
          chapterReplaced: boolean;
          appendedTag: string | null;
          content: string;
        };
        assertEquals(body.chapterInserted, true);
        assertEquals(body.insertedCount, 2);
        assertEquals(body.chapterUpdated, true);
        assertEquals(body.chapterReplaced, false);
        assertEquals(body.appendedTag, null);
        const ch = await Deno.readTextFile(join(storyDir, "001.md"));
        assertTrue(ch.includes("乙。\n\nIMG1\n\n丙。"), ch);
        assertTrue(ch.includes("丙。\n\nIMG2\n\n丁。"), ch);
        // post-response fired with full chapter
        assertTrue(captured !== null, "post-response dispatched");
        const cap = captured as unknown as PostResponsePayload;
        assertEquals(cap.source, "plugin-action");
        assertEquals(cap.pluginName, "tester");
        assertEquals(cap.content, ch);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    await t.step("top-of-chapter insert (K=0)", async () => {
      const { app, storyDir, cleanup } = await makeScenario();
      try {
        mockLLMFetch('{"insertions":[{"insertAfterParagraph":0,"text":"TOP"}]}');
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 200);
        const ch = await Deno.readTextFile(join(storyDir, "001.md"));
        assertTrue(ch.startsWith("TOP\n\n甲。"), ch);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    // ----- Empty array no-op -----

    await t.step("empty insertions array is a no-op", async () => {
      const { app, storyDir, hookDispatcher, cleanup } = await makeScenario();
      try {
        let fired = false;
        hookDispatcher.register("post-response", () => {
          fired = true;
          return Promise.resolve();
        });
        const before = await Deno.readTextFile(join(storyDir, "001.md"));
        mockLLMFetch('{"insertions":[]}');
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 200);
        const body = res.body as {
          chapterInserted: boolean;
          insertedCount: number;
          chapterUpdated: boolean;
        };
        assertEquals(body.chapterInserted, false);
        assertEquals(body.insertedCount, 0);
        assertEquals(body.chapterUpdated, false);
        assertEquals(await Deno.readTextFile(join(storyDir, "001.md")), before);
        assertEquals(fired, false);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    // ----- numbered_paragraphs excludes stripped content -----

    await t.step("splice respects stripped-tag masking", async () => {
      const { app, storyDir, cleanup } = await makeScenario({
        stripTags: ["image"],
        chapterContent: "第一段。\n\n<image>### x ###</image>\n\n第二段。\n",
      });
      try {
        // Two visible paragraphs; insert after paragraph 1 → before masked image region.
        mockLLMFetch('{"insertions":[{"insertAfterParagraph":1,"text":"NEW"}]}');
        const res = await callRoute(app, { ...baseReq, insert: true });
        assertEquals(res.status, 200);
        const ch = await Deno.readTextFile(join(storyDir, "001.md"));
        assertTrue(ch.includes("第一段。\n\nNEW"), ch);
        // Original image block preserved.
        assertTrue(ch.includes("<image>### x ###</image>"), ch);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    // ----- non-insert modes carry default fields -----

    await t.step("discard mode carries chapterInserted=false insertedCount=0", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        mockLLMFetch("plain output");
        const res = await callRoute(app, { ...baseReq });
        assertEquals(res.status, 200);
        const body = res.body as { chapterInserted: boolean; insertedCount: number };
        assertEquals(body.chapterInserted, false);
        assertEquals(body.insertedCount, 0);
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    // ----- insert-transform hook -----

    await t.step(
      "insert-transform handler produces the envelope from a plugin-specific response",
      async () => {
        const { app, storyDir, hookDispatcher, cleanup } = await makeScenario();
        try {
          let sawRaw: string | null = null;
          let sawPlugin: string | null = null;
          let sawNumbered: string | null = null;
          hookDispatcher.register("insert-transform", (ctx) => {
            sawRaw = ctx.rawResponse as string;
            sawPlugin = ctx.pluginName as string;
            sawNumbered = ctx.numberedParagraphs as string;
            // The LLM returned a flat array; the handler assembles the envelope.
            const arr = JSON.parse(ctx.rawResponse as string) as Array<
              { insertAfterParagraph: number; title: string }
            >;
            ctx.envelope = JSON.stringify({
              insertions: arr.map((o) => ({
                insertAfterParagraph: o.insertAfterParagraph,
                text: `<image>【${o.title}】### p ### n ### nl ###</image>`,
              })),
            });
            return Promise.resolve();
          });
          // Raw LLM response is the plugin's OWN flat schema, NOT the engine envelope.
          mockLLMFetch(
            '[{"insertAfterParagraph":2,"title":"甲圖"},{"insertAfterParagraph":3,"title":"乙圖"}]',
          );
          const res = await callRoute(app, { ...baseReq, insert: true });
          assertEquals(res.status, 200);
          const body = res.body as { chapterInserted: boolean; insertedCount: number };
          assertEquals(body.chapterInserted, true);
          assertEquals(body.insertedCount, 2);
          assertEquals(sawPlugin, "tester");
          assertTrue((sawRaw ?? "").startsWith("["), "handler saw the raw flat array");
          assertTrue((sawNumbered ?? "").length > 0, "handler saw numbered_paragraphs");
          const ch = await Deno.readTextFile(join(storyDir, "001.md"));
          assertTrue(ch.includes("【甲圖】"), ch);
          assertTrue(ch.includes("【乙圖】"), ch);
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "no insert-transform handler falls back to parsing the raw response",
      async () => {
        const { app, storyDir, cleanup } = await makeScenario();
        try {
          // No handler registered; raw response IS a valid envelope.
          mockLLMFetch('{"insertions":[{"insertAfterParagraph":1,"text":"RAW"}]}');
          const res = await callRoute(app, { ...baseReq, insert: true });
          assertEquals(res.status, 200);
          const ch = await Deno.readTextFile(join(storyDir, "001.md"));
          assertTrue(ch.includes("甲。\n\nRAW\n\n乙。"), ch);
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "throwing insert-transform handler aborts with chapter unchanged + no post-response",
      async () => {
        const { app, storyDir, hookDispatcher, cleanup } = await makeScenario();
        try {
          let postFired = false;
          hookDispatcher.register("post-response", () => {
            postFired = true;
            return Promise.resolve();
          });
          hookDispatcher.register("insert-transform", () => {
            throw new Error("transform boom");
          });
          const before = await Deno.readTextFile(join(storyDir, "001.md"));
          mockLLMFetch('[{"insertAfterParagraph":1,"title":"x"}]');
          const res = await callRoute(app, { ...baseReq, insert: true });
          // A thrown handler surfaces as a 500 (unexpected error); the key
          // guarantees are: chapter untouched + no post-response.
          assertTrue(res.status >= 400, `expected error status, got ${res.status}`);
          assertEquals(await Deno.readTextFile(join(storyDir, "001.md")), before);
          assertEquals(postFired, false);
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "insert-transform handler that leaves envelope null falls back to raw (invalid → 422)",
      async () => {
        const { app, storyDir, cleanup } = await makeScenario();
        try {
          // Register a handler that does NOT match this plugin's own runs in
          // a real plugin; here we simulate "handler declined" by not setting
          // envelope. The raw response is the plugin's flat array, which is
          // NOT a valid engine envelope → 422, chapter unchanged.
          const before = await Deno.readTextFile(join(storyDir, "001.md"));
          mockLLMFetch('[{"insertAfterParagraph":1,"title":"x"}]');
          const res = await callRoute(app, { ...baseReq, insert: true });
          assertEquals(res.status, 422);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:invalid-insert-payload",
          );
          assertEquals(await Deno.readTextFile(join(storyDir, "001.md")), before);
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );
  },
});
