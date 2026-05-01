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

import { assert, assertEquals } from "@std/assert";
import { createApp } from "../../../writer/app.ts";
import { createSafePath, verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { STORY_LLM_CONFIG_KEYS } from "../../../writer/lib/story-config.ts";
import type { Hono } from "@hono/hono";
import type { AppConfig, AppDeps, BuildPromptResult, LlmConfig } from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

const PASSPHRASE = "test-pass";

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

function createTestApp(): Hono {
  return createApp({
    config: {
      READER_DIR: "/nonexistent-reader",
      PLAYGROUND_DIR: "/nonexistent-playground",
      ROOT_DIR: "/nonexistent-root",
      BACKGROUND_IMAGE: "/bg",
      LLM_API_URL: "https://example.test/chat/completions",
      LLM_MODEL: llmDefaults.model,
      LLM_TEMPERATURE: llmDefaults.temperature,
      LLM_FREQUENCY_PENALTY: llmDefaults.frequencyPenalty,
      LLM_PRESENCE_PENALTY: llmDefaults.presencePenalty,
      LLM_TOP_K: llmDefaults.topK,
      LLM_TOP_P: llmDefaults.topP,
      LLM_REPETITION_PENALTY: llmDefaults.repetitionPenalty,
      LLM_MIN_P: llmDefaults.minP,
      LLM_TOP_A: llmDefaults.topA,
      LLM_REASONING_ENABLED: true,
      LLM_REASONING_EFFORT: "high",
      LLM_REASONING_OMIT: false,
      LLM_MAX_COMPLETION_TOKENS: 4096,
      llmDefaults,
    } as unknown as AppConfig,
    safePath: createSafePath("/nonexistent-playground"),
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
    verifyPassphrase,
  } as AppDeps);
}

Deno.test({
  name: "GET /api/llm-defaults requires auth",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    Deno.env.set("PASSPHRASE", PASSPHRASE);
    try {
      const app = createTestApp();
      const res = await app.fetch(new Request("http://localhost/api/llm-defaults"));
      assertEquals(res.status, 401);
      await res.body?.cancel();
    } finally {
      Deno.env.delete("PASSPHRASE");
    }
  },
});

Deno.test({
  name: "GET /api/llm-defaults returns whitelisted defaults with no-store cache header",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    Deno.env.set("PASSPHRASE", PASSPHRASE);
    try {
      const app = createTestApp();
      const res = await app.fetch(
        new Request("http://localhost/api/llm-defaults", {
          headers: { "x-passphrase": PASSPHRASE },
        }),
      );
      assertEquals(res.status, 200);
      assertEquals(res.headers.get("cache-control"), "no-store");
      const body = await res.json();
      // Lock-step: every whitelisted key must appear with the configured default
      for (const key of STORY_LLM_CONFIG_KEYS) {
        assert(key in body, `payload missing key '${key}'`);
        assertEquals(
          (body as Record<string, unknown>)[key],
          (llmDefaults as unknown as Record<string, unknown>)[key],
        );
      }
      // No extra keys
      assertEquals(Object.keys(body).sort(), [...STORY_LLM_CONFIG_KEYS].sort());
      // No secrets
      assert(!("LLM_API_URL" in body));
      assert(!("LLM_API_KEY" in body));
      assert(!("LLM_REASONING_OMIT" in body));
      assert(!("reasoningOmit" in body));
    } finally {
      Deno.env.delete("PASSPHRASE");
    }
  },
});
