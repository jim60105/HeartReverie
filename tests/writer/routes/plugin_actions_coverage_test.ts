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
import {
  createSafePath,
  verifyPassphrase,
} from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { createTemplateEngine } from "../../../writer/lib/template.ts";
import { createStoryEngine } from "../../../writer/lib/story.ts";
import { runPluginActionWithDeps } from "../../../writer/routes/plugin-actions.ts";
import type { Hono } from "@hono/hono";
import type {
  AppConfig,
  AppDeps,
  BuildPromptResult,
} from "../../../writer/types.ts";

interface ScenarioOpts {
  readonly promptContent?: string;
  readonly chapterContent?: string | null;
  readonly storyConfig?: string;
}

interface Scenario {
  app: Hono;
  tmpDir: string;
  pluginDir: string;
  storyDir: string;
  deps: AppDeps;
  cleanup: () => Promise<void>;
}

async function makeScenario(opts: ScenarioOpts = {}): Promise<Scenario> {
  const tmpDir = await Deno.makeTempDir({ prefix: "plugin-action-cov-" });
  const pluginsRoot = join(tmpDir, "plugins");
  const playgroundDir = join(tmpDir, "play");
  await Deno.mkdir(pluginsRoot, { recursive: true });
  await Deno.mkdir(playgroundDir, { recursive: true });

  const storyDir = join(playgroundDir, "s1", "n1");
  await Deno.mkdir(storyDir, { recursive: true });
  if (opts.chapterContent !== null) {
    await Deno.writeTextFile(
      join(storyDir, "001.md"),
      opts.chapterContent ?? "Existing chapter content.\n",
    );
  }
  if (opts.storyConfig !== undefined) {
    await Deno.writeTextFile(join(storyDir, "_config.json"), opts.storyConfig);
  }

  const pluginDir = join(pluginsRoot, "tester");
  await Deno.mkdir(join(pluginDir, "prompts"), { recursive: true });
  await Deno.writeTextFile(
    join(pluginDir, "plugin.json"),
    JSON.stringify({ name: "tester", version: "1.0.0" }),
  );
  await Deno.writeTextFile(
    join(pluginDir, "prompts", "summary.md"),
    opts.promptContent ?? '{{ message "user" }}\nSummarise.\n{{ /message }}',
  );

  // Capture original env values so cleanup() restores them — no Deno.env.set
  // may leak past a thrown assertion.
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
    LLM_API_URL: "https://openrouter.example/api/v1/chat/completions",
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
    verifyPassphrase,
  } as AppDeps;

  const app = createApp(deps);

  const cleanup = async () => {
    try {
      await Deno.remove(tmpDir, { recursive: true });
    } catch {
      // best-effort
    }
    for (const [k, v] of Object.entries(previousEnv)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  };

  return { app, tmpDir, pluginDir, storyDir, deps, cleanup };
}

const originalFetch = globalThis.fetch;

function mockLLMSuccess(content: string): void {
  globalThis.fetch = async (
    url: string | URL | Request,
    opts?: RequestInit,
  ) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      const sse = [
        `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`,
        `data: ${
          JSON.stringify({
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
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

function mockLLMStatus(status: number, body = "broken"): void {
  globalThis.fetch = async (
    url: string | URL | Request,
    opts?: RequestInit,
  ) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      return new Response(body, { status });
    }
    return originalFetch(url, opts);
  };
}

function mockLLMHangThenAbort(): void {
  globalThis.fetch = (url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      const sig = opts?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        const onAbort = () =>
          reject(sig?.reason ?? new DOMException("aborted", "AbortError"));
        if (sig?.aborted) onAbort();
        else sig?.addEventListener("abort", onAbort, { once: true });
      });
    }
    return originalFetch(url as string, opts);
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

Deno.test({
  name: "plugin-action route — extra coverage",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await t.step(
      "empty promptFile string is rejected as invalid-prompt-path",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "",
            append: false,
          });
          assertEquals(res.status, 400);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:invalid-prompt-path",
          );
        } finally {
          await cleanup();
        }
      },
    );

    await t.step("promptFile containing NUL byte is rejected", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/sum\x00mary.md",
          append: false,
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body as { type: string }).type,
          "plugin-action:invalid-prompt-path",
        );
      } finally {
        await cleanup();
      }
    });

    await t.step("non-string promptFile is rejected", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: 123,
          append: false,
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body as { type: string }).type,
          "plugin-action:invalid-prompt-path",
        );
      } finally {
        await cleanup();
      }
    });

    await t.step("missing promptFile (undefined) is rejected", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          append: false,
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body as { type: string }).type,
          "plugin-action:invalid-prompt-path",
        );
      } finally {
        await cleanup();
      }
    });

    await t.step(
      "promptFile pointing to a directory is rejected as not-found",
      async () => {
        const { app, pluginDir, cleanup } = await makeScenario();
        try {
          await Deno.mkdir(join(pluginDir, "prompts", "subdir"), {
            recursive: true,
          });
          // Subdir exists, ends with .md so passes the extension check, then
          // resolvePromptPath stat detects it's not a regular file.
          const dirAsMd = join(pluginDir, "prompts", "actually-a-dir.md");
          await Deno.mkdir(dirAsMd, { recursive: true });
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/actually-a-dir.md",
            append: false,
          });
          assertEquals(res.status, 400);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:prompt-file-not-found",
          );
        } finally {
          await cleanup();
        }
      },
    );

    await t.step(
      "non-existent promptFile inside plugin returns prompt-file-not-found",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/missing.md",
            append: false,
          });
          assertEquals(res.status, 400);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:prompt-file-not-found",
          );
        } finally {
          await cleanup();
        }
      },
    );

    await t.step(
      "plugin directory deleted from disk surfaces unknown-plugin",
      async () => {
        const { app, pluginDir, cleanup } = await makeScenario();
        try {
          await Deno.remove(pluginDir, { recursive: true });
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: false,
          });
          assertEquals(res.status, 404);
          assertEquals(
            (res.body as { type: string }).type,
            "plugin-action:unknown-plugin",
          );
        } finally {
          await cleanup();
        }
      },
    );

    await t.step(
      "invalid series (path traversal) is rejected with 400",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          const res = await callRoute(app, "tester", {
            series: "../etc",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: false,
          });
          assertEquals(res.status, 400);
        } finally {
          await cleanup();
        }
      },
    );

    await t.step("non-string series rejected with 400", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: 42,
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
        });
        assertEquals(res.status, 400);
      } finally {
        await cleanup();
      }
    });

    await t.step("extraVariables as array is rejected", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
          extraVariables: [1, 2, 3],
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body as { type: string }).type,
          "plugin-action:invalid-extra-variables",
        );
      } finally {
        await cleanup();
      }
    });

    await t.step(
      "extraVariables with lore_-prefixed key collides with reserved variable",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: false,
            extraVariables: { lore_evil: "x" },
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

    await t.step("missing LLM_API_KEY returns 500", async () => {
      const { app, cleanup } = await makeScenario();
      const previous = Deno.env.get("LLM_API_KEY");
      try {
        Deno.env.delete("LLM_API_KEY");
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
        });
        assertEquals(res.status, 500);
        const body = res.body as { detail: string };
        assertTrue(body.detail.includes("LLM_API_KEY"));
      } finally {
        if (previous !== undefined) Deno.env.set("LLM_API_KEY", previous);
        await cleanup();
      }
    });

    await t.step(
      "malformed _config.json returns 422 StoryConfigValidationError",
      async () => {
        const { app, cleanup } = await makeScenario({
          storyConfig: JSON.stringify({ temperature: "not a number" }),
        });
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: false,
          });
          assertEquals(res.status, 422);
          const body = res.body as { detail: string };
          assertTrue(body.detail.includes("_config.json"));
        } finally {
          await cleanup();
        }
      },
    );

    await t.step(
      "upstream LLM 503 surfaces as Bad Gateway via ChatError",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          mockLLMStatus(503, "upstream offline");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: false,
          });
          assertEquals(res.status, 503);
          const body = res.body as { title: string };
          assertEquals(body.title, "Bad Gateway");
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "vento template error (non no-user-message) returns generic 422",
      async () => {
        // Use an undefined variable to trigger a Vento render error that is
        // not the multi-message:no-user-message slug.
        const { app, cleanup } = await makeScenario({
          promptContent:
            '{{ message "user" }}{{ undefined_variable_xyz }}{{ /message }}',
        });
        try {
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: false,
          });
          assertEquals(res.status, 422);
          const body = res.body as { type: string; title: string };
          assertEquals(body.type, "about:blank");
          assertEquals(body.title, "Unprocessable Entity");
        } finally {
          await cleanup();
        }
      },
    );

    await t.step(
      "HTTP request abort via signal yields 499 problem response",
      async () => {
        const { app, cleanup } = await makeScenario();
        try {
          mockLLMHangThenAbort();
          const ctrl = new AbortController();
          const reqPromise = app.fetch(
            new Request("http://localhost/api/plugins/tester/run-prompt", {
              method: "POST",
              headers: {
                "x-passphrase": "test-pass",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                series: "s1",
                name: "n1",
                promptFile: "prompts/summary.md",
                append: false,
              }),
              signal: ctrl.signal,
            }),
          );
          // Give the handler a tick to wire up the abort listener and start the
          // upstream fetch.
          await new Promise((r) => setTimeout(r, 50));
          ctrl.abort();
          const res = await Promise.resolve(reqPromise).catch((err: unknown) =>
            err as Error
          );
          if (res instanceof Error) {
            // Some Hono/Deno versions reject app.fetch when the request signal
            // fires. Either behaviour is acceptable per the spec — the key
            // invariant is that no chapter mutation occurred.
            assertTrue(
              res.name === "AbortError" || res.message.includes("aborted"),
              `unexpected error: ${res.message}`,
            );
          } else {
            assertEquals(res.status, 499);
            const body = await res.json();
            assertTrue((body as { detail: string }).detail.includes("aborted"));
          }
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step("invalid mode value (direct call) returns 400", async () => {
      const { deps, cleanup } = await makeScenario();
      try {
        const outcome = await runPluginActionWithDeps(
          {
            pluginName: "tester",
            series: "s1",
            story: "n1",
            promptPath: "prompts/summary.md",
            mode: "totally-bogus-mode",
          },
          deps,
        );
        assertTrue(!outcome.ok && !outcome.aborted);
        if (!outcome.ok && !outcome.aborted) {
          assertEquals(outcome.status, 400);
          assertTrue(outcome.problem.detail.includes("mode must be"));
        }
      } finally {
        await cleanup();
      }
    });

    await t.step(
      "buildPromptFromStory returning empty messages surfaces 500",
      async () => {
        const { deps, cleanup } = await makeScenario();
        try {
          // Inject a fake builder that returns zero messages with no vento error
          // — the runner must surface a 500 "Failed to generate prompt".
          const fakeBuilder = async () =>
            ({
              messages: [],
              ventoError: null,
              chapterFiles: [],
              chapters: [],
              previousContext: [],
              isFirstRound: true,
            }) as unknown as BuildPromptResult;
          const outcome = await runPluginActionWithDeps(
            {
              pluginName: "tester",
              series: "s1",
              story: "n1",
              promptPath: "prompts/summary.md",
              mode: "discard",
            },
            { ...deps, buildPromptFromStory: fakeBuilder },
          );
          assertTrue(!outcome.ok && !outcome.aborted);
          if (!outcome.ok && !outcome.aborted) {
            assertEquals(outcome.status, 500);
            assertTrue(
              outcome.problem.detail.includes("Failed to generate prompt"),
            );
          }
        } finally {
          await cleanup();
        }
      },
    );

    await t.step("non-object extraVariables (string) is rejected", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        const res = await callRoute(app, "tester", {
          series: "s1",
          name: "n1",
          promptFile: "prompts/summary.md",
          append: false,
          extraVariables: "not-an-object",
        });
        assertEquals(res.status, 400);
        assertEquals(
          (res.body as { type: string }).type,
          "plugin-action:invalid-extra-variables",
        );
      } finally {
        await cleanup();
      }
    });

    await t.step(
      "post-response hook fires with source 'plugin-action' on append success",
      async () => {
        const { app, deps, cleanup } = await makeScenario();
        const seen: Array<
          { source?: unknown; series?: unknown; name?: unknown }
        > = [];
        deps.hookDispatcher.register(
          "post-response",
          (ctx: Record<string, unknown>) => {
            seen.push({
              source: ctx.source,
              series: ctx.series,
              name: ctx.name,
            });
            return Promise.resolve();
          },
          100,
          "test-observer",
        );
        try {
          mockLLMSuccess("CONTENT");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: true,
            appendTag: "Marker",
          });
          assertEquals(res.status, 200);
          assertTrue(seen.length >= 1);
          assertEquals(seen[0]!.source, "plugin-action");
          assertEquals(seen[0]!.series, "s1");
          assertEquals(seen[0]!.name, "n1");
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "valid scalar extraVariables flow through validation",
      async () => {
        const { app, cleanup } = await makeScenario({
          promptContent:
            '{{ message "user" }}\n{{ flag }} {{ count }}\n{{ /message }}',
        });
        try {
          mockLLMSuccess("OK");
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n1",
            promptFile: "prompts/summary.md",
            append: false,
            extraVariables: { flag: true, count: 3, label: "go" },
          });
          assertEquals(res.status, 200);
        } finally {
          globalThis.fetch = originalFetch;
          await cleanup();
        }
      },
    );

    await t.step(
      "story path occupied by a regular file returns 404 not-directory",
      async () => {
        const { app, cleanup, tmpDir } = await makeScenario();
        try {
          // Replace the dir at play/s1/n2 with a plain file so stat.isDirectory
          // is false for that path.
          await Deno.writeTextFile(
            join(tmpDir, "play", "s1", "n2"),
            "not a dir",
          );
          const res = await callRoute(app, "tester", {
            series: "s1",
            name: "n2",
            promptFile: "prompts/summary.md",
            append: false,
          });
          assertEquals(res.status, 404);
          assertTrue(
            (res.body as { detail: string }).detail.includes("Story directory"),
          );
        } finally {
          await cleanup();
        }
      },
    );

    await t.step(
      "getPluginDir returning null surfaces unknown-plugin",
      async () => {
        const { deps, cleanup } = await makeScenario();
        try {
          // Wrap pluginManager so hasPlugin is true but getPluginDir returns null.
          const stubManager = {
            ...deps.pluginManager,
            hasPlugin: () => true,
            getPluginDir: () => null,
          } as unknown as typeof deps.pluginManager;
          const outcome = await runPluginActionWithDeps(
            {
              pluginName: "tester",
              series: "s1",
              story: "n1",
              promptPath: "prompts/summary.md",
              mode: "discard",
            },
            { ...deps, pluginManager: stubManager },
          );
          assertTrue(!outcome.ok && !outcome.aborted);
          if (!outcome.ok && !outcome.aborted) {
            assertEquals(outcome.status, 404);
            assertEquals(outcome.problem.type, "plugin-action:unknown-plugin");
          }
        } finally {
          await cleanup();
        }
      },
    );

    await t.step("pre-aborted request signal resolves as 499", async () => {
      const { app, cleanup } = await makeScenario();
      try {
        mockLLMHangThenAbort();
        const ctrl = new AbortController();
        ctrl.abort(); // pre-abort BEFORE app.fetch runs
        const result = await Promise.resolve(
          app.fetch(
            new Request("http://localhost/api/plugins/tester/run-prompt", {
              method: "POST",
              headers: {
                "x-passphrase": "test-pass",
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                series: "s1",
                name: "n1",
                promptFile: "prompts/summary.md",
                append: false,
              }),
              signal: ctrl.signal,
            }),
          ),
        ).catch((err: unknown) => err as Error);
        if (result instanceof Response) {
          assertEquals(result.status, 499);
        } else {
          // Some runtimes reject app.fetch outright on pre-aborted signal; in
          // that case the abort path was reached during route entry.
          assertTrue(
            result.name === "AbortError" || result.message.includes("abort"),
          );
        }
      } finally {
        globalThis.fetch = originalFetch;
        await cleanup();
      }
    });

    await t.step(
      "resolveStoryLlmConfig non-validation error surfaces 500",
      async () => {
        const { deps, cleanup, tmpDir } = await makeScenario();
        try {
          // Replace _config.json with a directory so Deno.readTextFile throws
          // an IsADirectory error — neither NotFound (treated as missing) nor
          // StoryConfigValidationError (which would map to 422). The route's
          // generic catch must surface this as 500.
          const cfgPath = join(tmpDir, "play", "s1", "n1", "_config.json");
          await Deno.mkdir(cfgPath, { recursive: true });
          const outcome = await runPluginActionWithDeps(
            {
              pluginName: "tester",
              series: "s1",
              story: "n1",
              promptPath: "prompts/summary.md",
              mode: "discard",
            },
            deps,
          );
          assertEquals(outcome.ok, false);
          if (outcome.ok === false && outcome.aborted === false) {
            assertEquals(outcome.status, 500);
          } else {
            throw new Error("expected non-aborted failure outcome");
          }
        } finally {
          await cleanup();
        }
      },
    );
  },
});
