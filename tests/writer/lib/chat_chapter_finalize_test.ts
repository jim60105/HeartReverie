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

/**
 * Unit coverage for the tagless plugin-action append finalisation
 * (`finalizeAppendToExisting` via `streamLlmAndPersist`):
 *
 *  - 4.1 tagless append (`appendTag: null`) appends EXACTLY
 *    `\n{trimmed content}\n` with NO wrapper element, preserving every
 *    `<image>` block, and dispatches `post-response` with `appendedTag: null`.
 *  - 4.2 tagless append does NOT strip a single leading/trailing `<image>`
 *    block (normalisation is skipped when `appendTag === null`).
 *  - 4.6 the widened `appendedTag?: string | null` carries `null` for a
 *    tagless append and the tagged append still carries the tag string.
 */

import { assert, assertEquals, assertStrictEquals } from "@std/assert";
import { join } from "@std/path";
import { streamLlmAndPersist } from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type { AppConfig, LlmConfig, PostResponsePayload } from "../../../writer/types.ts";

const ENDPOINT = "https://example.test/v1/chat/completions";

function buildConfig(tmpDir: string): AppConfig {
  const llmDefaults: LlmConfig = {
    model: "default-model",
    temperature: 0.1,
    frequencyPenalty: 0.13,
    presencePenalty: 0.52,
    topK: 10,
    topP: 0,
    repetitionPenalty: 1.2,
    minP: 0,
    topA: 1,
    reasoningEnabled: true,
    reasoningEffort: "high",
    maxCompletionTokens: 4096,
  };
  return {
    ROOT_DIR: "/x",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/x",
    PLUGINS_DIR: "/x",
    PORT: 0,
    LLM_API_URL: ENDPOINT,
    LLM_MODEL: "default-model",
    LLM_TEMPERATURE: 0.1,
    LLM_FREQUENCY_PENALTY: 0.13,
    LLM_PRESENCE_PENALTY: 0.52,
    LLM_TOP_K: 10,
    LLM_TOP_P: 0,
    LLM_REPETITION_PENALTY: 1.2,
    LLM_MIN_P: 0,
    LLM_TOP_A: 1,
    LLM_REASONING_ENABLED: true,
    LLM_REASONING_EFFORT: "high",
    LLM_REASONING_OMIT: false,
    LLM_MAX_COMPLETION_TOKENS: 4096,
    llmDefaults,
    THEME_DIR: "./themes/",
    PROMPT_FILE: "x",
  } as unknown as AppConfig;
}

type FetchFn = typeof fetch;

/**
 * Stub `fetch` so the LLM stream emits exactly the supplied `content` as a
 * single SSE content delta (plus a terminating [DONE]). Lets tests control
 * the verbatim model output that the tagless append must preserve.
 */
function stubFetchContent(content: string): () => void {
  const original: FetchFn = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, _opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      const payload = JSON.stringify({ choices: [{ delta: { content } }] });
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              const enc = new TextEncoder();
              c.enqueue(enc.encode(`data: ${payload}\n\n`));
              c.enqueue(enc.encode("data: [DONE]\n\n"));
              c.close();
            },
          }),
          { status: 200 },
        ),
      );
    }
    return original(url as string, _opts);
  }) as FetchFn;
  return () => {
    globalThis.fetch = original;
  };
}

function captureNextPostResponse(hd: HookDispatcher): { current: PostResponsePayload | undefined } {
  const captured: { current: PostResponsePayload | undefined } = { current: undefined };
  hd.register("post-response", (ctx) => {
    captured.current = ctx as unknown as PostResponsePayload;
    return Promise.resolve();
  });
  return captured;
}

Deno.test({
  name: "tagless plugin-action append — finalisation",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    const previousKey = Deno.env.get("LLM_API_KEY");
    Deno.env.set("LLM_API_KEY", "k");
    try {
      // ───────────────────────────────────────────────────────────
      await t.step(
        "4.1 tagless append writes exactly \\n{trimmed}\\n with no wrapper; appendedTag=null",
        async () => {
          const tmpDir = await Deno.makeTempDir({ prefix: "tagless-append-" });
          try {
            const dir = join(tmpDir, "s1", "n1");
            await Deno.mkdir(dir, { recursive: true });
            const existing = "existing chapter body\n";
            await Deno.writeTextFile(join(dir, "001.md"), existing);

            // Model output: two <image> blocks interleaved with prose, with
            // leading/trailing whitespace that trim() must remove.
            const aiBody = "<image>one</image>\n\n中間敘述\n\n<image>two</image>";
            const aiContent = `   \n${aiBody}\n   `;

            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const config = buildConfig(tmpDir);
            const restore = stubFetchContent(aiContent);
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: {
                  kind: "append-to-existing-chapter",
                  appendTag: null,
                  pluginName: "sd-webui-image-gen",
                },
                hookDispatcher: hd,
                config,
                correlationId: "tagless-corr",
              });
            } finally {
              restore();
            }

            // Exact appended delta: one leading newline, trimmed body verbatim,
            // one trailing newline. NO wrapper element added.
            const after = await Deno.readTextFile(join(dir, "001.md"));
            const expectedDelta = `\n${aiBody.trim()}\n`;
            assertEquals(after, existing + expectedDelta);
            // No synthetic wrapper element was introduced around the payload.
            assert(
              !after.includes("<null>") && !after.includes("</null>"),
              "tagless append must not emit a <null> wrapper",
            );
            // Both <image> blocks survive intact.
            assertEquals((after.match(/<image>/g) ?? []).length, 2);
            assertEquals((after.match(/<\/image>/g) ?? []).length, 2);
            assert(after.includes("中間敘述"), "interleaved prose preserved");

            // post-response payload carries appendedTag: null and full chapter.
            const p = cap.current;
            assert(p, "post-response payload must be captured");
            assertEquals(p!.source, "plugin-action");
            assertEquals(p!.pluginName, "sd-webui-image-gen");
            assertStrictEquals(p!.appendedTag, null);
            assertEquals(p!.content, after);
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );

      // ───────────────────────────────────────────────────────────
      await t.step(
        "4.2 tagless append does NOT strip a single leading/trailing <image> block",
        async () => {
          const tmpDir = await Deno.makeTempDir({ prefix: "tagless-noStrip-" });
          try {
            const dir = join(tmpDir, "s1", "n1");
            await Deno.mkdir(dir, { recursive: true });
            const existing = "seed\n";
            await Deno.writeTextFile(join(dir, "001.md"), existing);

            // A single well-formed <image> block: the tagged path would strip
            // an outer wrapper, but the tagless path must NOT.
            const aiBody = "<image>solo block</image>";
            const aiContent = `\n${aiBody}\n`;

            const hd = new HookDispatcher();
            const config = buildConfig(tmpDir);
            const restore = stubFetchContent(aiContent);
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: {
                  kind: "append-to-existing-chapter",
                  appendTag: null,
                  pluginName: "sd-webui-image-gen",
                },
                hookDispatcher: hd,
                config,
                correlationId: "tagless-nostrip-corr",
              });
            } finally {
              restore();
            }

            const after = await Deno.readTextFile(join(dir, "001.md"));
            // The <image> tags are NOT stripped — block preserved verbatim.
            assertEquals(after, existing + `\n${aiBody}\n`);
            assert(after.includes("<image>solo block</image>"));
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );

      // ───────────────────────────────────────────────────────────
      await t.step(
        'tagless append with empty model output appends "\\n\\n" and still reports appendedTag:null + chapterUpdated',
        async () => {
          const tmpDir = await Deno.makeTempDir({ prefix: "tagless-empty-" });
          try {
            const dir = join(tmpDir, "s1", "n1");
            await Deno.mkdir(dir, { recursive: true });
            const existing = "seed\n";
            await Deno.writeTextFile(join(dir, "001.md"), existing);

            // Whitespace-only model output → trim() yields "".
            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const config = buildConfig(tmpDir);
            const restore = stubFetchContent("   \n  ");
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: {
                  kind: "append-to-existing-chapter",
                  appendTag: null,
                  pluginName: "sd-webui-image-gen",
                },
                hookDispatcher: hd,
                config,
                correlationId: "tagless-empty-corr",
              });
            } finally {
              restore();
            }

            const after = await Deno.readTextFile(join(dir, "001.md"));
            // Matches the tagged-append empty-output behavior: the wrapper
            // template collapses to "\n\n" around an empty body. No <null>.
            assertEquals(after, existing + "\n\n");
            const p = cap.current;
            assert(p);
            assertStrictEquals(p!.appendedTag, null);
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );

      // ───────────────────────────────────────────────────────────
      await t.step(
        "4.6 tagged append still reports the tag string (widened type carries both)",
        async () => {
          const tmpDir = await Deno.makeTempDir({ prefix: "tagged-append-" });
          try {
            const dir = join(tmpDir, "s1", "n1");
            await Deno.mkdir(dir, { recursive: true });
            await Deno.writeTextFile(join(dir, "001.md"), "existing\n");

            const hd = new HookDispatcher();
            const cap = captureNextPostResponse(hd);
            const config = buildConfig(tmpDir);
            const restore = stubFetchContent("payload body");
            try {
              await streamLlmAndPersist({
                messages: [{ role: "user", content: "p" }],
                llmConfig: config.llmDefaults,
                series: "s1",
                name: "n1",
                storyDir: dir,
                rootDir: config.ROOT_DIR,
                writeMode: {
                  kind: "append-to-existing-chapter",
                  appendTag: "UpdateVariable",
                  pluginName: "state",
                },
                hookDispatcher: hd,
                config,
                correlationId: "tagged-corr",
              });
            } finally {
              restore();
            }

            const after = await Deno.readTextFile(join(dir, "001.md"));
            assert(after.includes("<UpdateVariable>"));
            assert(after.includes("</UpdateVariable>"));
            const p = cap.current;
            assert(p);
            assertEquals(p!.appendedTag, "UpdateVariable");
          } finally {
            await Deno.remove(tmpDir, { recursive: true });
          }
        },
      );
    } finally {
      if (previousKey !== undefined) Deno.env.set("LLM_API_KEY", previousKey);
      else Deno.env.delete("LLM_API_KEY");
    }
  },
});
