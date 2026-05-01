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

import { assert, assertEquals, assertRejects } from "@std/assert";
import { join } from "@std/path";
import { ChatError, executeChat } from "../../../writer/lib/chat-shared.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createSafePath } from "../../../writer/lib/middleware.ts";
import type {
  AppConfig,
  BuildPromptResult,
  LlmConfig,
  ReasoningEffort,
} from "../../../writer/types.ts";

interface ConfigOpts {
  reasoningEnabled?: boolean;
  reasoningEffort?: ReasoningEffort;
  reasoningOmit?: boolean;
}

function buildConfig(tmpDir: string, opts: ConfigOpts = {}): AppConfig {
  const {
    reasoningEnabled = true,
    reasoningEffort = "high",
    reasoningOmit = false,
  } = opts;
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
    reasoningEnabled,
    reasoningEffort,
    maxCompletionTokens: 4096,
  };
  return {
    ROOT_DIR: "/x",
    PLAYGROUND_DIR: tmpDir,
    READER_DIR: "/x",
    PLUGINS_DIR: "/x",
    PORT: 0,
    CERT_FILE: undefined,
    KEY_FILE: undefined,
    LLM_API_URL: "https://example.test/chat/completions",
    LLM_MODEL: "default-model",
    LLM_TEMPERATURE: 0.1,
    LLM_FREQUENCY_PENALTY: 0.13,
    LLM_PRESENCE_PENALTY: 0.52,
    LLM_TOP_K: 10,
    LLM_TOP_P: 0,
    LLM_REPETITION_PENALTY: 1.2,
    LLM_MIN_P: 0,
    LLM_TOP_A: 1,
    LLM_REASONING_ENABLED: reasoningEnabled,
    LLM_REASONING_EFFORT: reasoningEffort,
    LLM_REASONING_OMIT: reasoningOmit,
    LLM_MAX_COMPLETION_TOKENS: 4096,
    llmDefaults,
    BACKGROUND_IMAGE: "/bg",
    PROMPT_FILE: "x",
  } as unknown as AppConfig;
}

function captureUpstreamFetch(
  status: number = 200,
  errorBody: string | null = null,
): {
  restore: () => void;
  captured: { body: Record<string, unknown> | null };
} {
  const original = globalThis.fetch;
  const captured: { body: Record<string, unknown> | null } = { body: null };
  globalThis.fetch = ((url: string | URL | Request, opts?: RequestInit) => {
    if (typeof url === "string" && url.includes("chat/completions")) {
      if (opts?.body) captured.body = JSON.parse(String(opts.body));
      if (status >= 400) {
        return Promise.resolve(
          new Response(errorBody ?? "", { status }),
        );
      }
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(c) {
              const enc = new TextEncoder();
              c.enqueue(enc.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
              c.enqueue(enc.encode("data: [DONE]\n\n"));
              c.close();
            },
          }),
          { status: 200 },
        ),
      );
    }
    return original(url as string, opts);
  }) as typeof fetch;
  return { restore: () => { globalThis.fetch = original; }, captured };
}

const buildPromptStub = () =>
  Promise.resolve({
    prompt: "p",
    previousContext: [],
    isFirstRound: true,
    ventoError: null,
    chapterFiles: [],
    chapters: [],
  } as BuildPromptResult);

async function runOnce(
  tmpDir: string,
  config: AppConfig,
): Promise<void> {
  await executeChat({
    series: "s1",
    name: "n1",
    message: "Hi",
    config,
    safePath: createSafePath(tmpDir),
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: buildPromptStub,
  });
}

Deno.test({
  name: "chat-shared: reasoning block assembly",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("LLM_API_KEY", "k");

    await t.step("defaults yield reasoning { enabled: true, effort: 'high' }", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-reason-1-" });
      try {
        await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
        const cap = captureUpstreamFetch();
        try {
          await runOnce(tmpDir, buildConfig(tmpDir));
        } finally {
          cap.restore();
        }
        assertEquals(cap.captured.body!.reasoning, { enabled: true, effort: "high" });
        // max_completion_tokens always present and reflects llmDefaults
        assertEquals(cap.captured.body!.max_completion_tokens, 4096);
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("env-disabled yields { enabled: false } with no effort", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-reason-2-" });
      try {
        await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
        const cap = captureUpstreamFetch();
        try {
          await runOnce(tmpDir, buildConfig(tmpDir, { reasoningEnabled: false }));
        } finally {
          cap.restore();
        }
        assertEquals(cap.captured.body!.reasoning, { enabled: false });
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("per-story-override-effort overrides env default", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-reason-3-" });
      try {
        const storyDir = join(tmpDir, "s1", "n1");
        await Deno.mkdir(storyDir, { recursive: true });
        await Deno.writeTextFile(
          join(storyDir, "_config.json"),
          JSON.stringify({ reasoningEffort: "low" }),
        );
        const cap = captureUpstreamFetch();
        try {
          await runOnce(tmpDir, buildConfig(tmpDir));
        } finally {
          cap.restore();
        }
        assertEquals(cap.captured.body!.reasoning, { enabled: true, effort: "low" });
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("LLM_REASONING_OMIT=true yields no reasoning key", async () => {
      const tmpDir = await Deno.makeTempDir({ prefix: "chat-reason-4-" });
      try {
        await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
        const cap = captureUpstreamFetch();
        try {
          await runOnce(tmpDir, buildConfig(tmpDir, { reasoningOmit: true }));
        } finally {
          cap.restore();
        }
        assertEquals(
          Object.prototype.hasOwnProperty.call(cap.captured.body!, "reasoning"),
          false,
        );
      } finally {
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step(
      "per-story reasoningEnabled:true flips env default of false",
      async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-reason-5-" });
        try {
          const storyDir = join(tmpDir, "s1", "n1");
          await Deno.mkdir(storyDir, { recursive: true });
          await Deno.writeTextFile(
            join(storyDir, "_config.json"),
            JSON.stringify({ reasoningEnabled: true }),
          );
          const cap = captureUpstreamFetch();
          try {
            await runOnce(
              tmpDir,
              buildConfig(tmpDir, { reasoningEnabled: false }),
            );
          } finally {
            cap.restore();
          }
          assertEquals(cap.captured.body!.reasoning, {
            enabled: true,
            effort: "high",
          });
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      },
    );

    await t.step(
      "per-story reasoningEnabled:false flips env default of true",
      async () => {
        const tmpDir = await Deno.makeTempDir({ prefix: "chat-reason-6-" });
        try {
          const storyDir = join(tmpDir, "s1", "n1");
          await Deno.mkdir(storyDir, { recursive: true });
          await Deno.writeTextFile(
            join(storyDir, "_config.json"),
            JSON.stringify({ reasoningEnabled: false }),
          );
          const cap = captureUpstreamFetch();
          try {
            await runOnce(tmpDir, buildConfig(tmpDir));
          } finally {
            cap.restore();
          }
          assertEquals(cap.captured.body!.reasoning, { enabled: false });
        } finally {
          await Deno.remove(tmpDir, { recursive: true });
        }
      },
    );

    Deno.env.delete("LLM_API_KEY");
  },
});

Deno.test({
  name:
    "chat-shared: upstream 400 with body surfaces upstream body in ChatError detail",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    Deno.env.set("LLM_API_KEY", "k");
    const tmpDir = await Deno.makeTempDir({ prefix: "chat-reason-err-" });
    try {
      await Deno.mkdir(join(tmpDir, "s1", "n1"), { recursive: true });
      const upstreamBody = `{"error":"unknown field: reasoning"}`;
      const cap = captureUpstreamFetch(400, upstreamBody);
      try {
        const err = await assertRejects(
          () => runOnce(tmpDir, buildConfig(tmpDir)),
          ChatError,
        );
        assertEquals(err.code, "llm-api");
        assertEquals(err.httpStatus, 400);
        assert(
          err.message.includes(upstreamBody),
          `Expected ChatError message to contain upstream body. Got: ${err.message}`,
        );
        assert(err.message.startsWith("AI service request failed: "));
      } finally {
        cap.restore();
      }
    } finally {
      Deno.env.delete("LLM_API_KEY");
      await Deno.remove(tmpDir, { recursive: true });
    }
  },
});
