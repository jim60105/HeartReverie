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
import { verifyPassphrase } from "../../../writer/lib/middleware.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import type {
  AppConfig,
  AppDeps,
  BuildPromptResult,
} from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";

Deno.test({
  name: "plugin-introspect route",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    Deno.env.set("PASSPHRASE", "test-pass");

    const hookDispatcher = new HookDispatcher();
    hookDispatcher.register("post-response", async () => {}, 100, "demo-plugin");

    const pluginManager = {
      getPlugins: () => [{ name: "demo-plugin", version: "1.0.0" }],
      getStripTagDeclarations: () => [
        { plugin: "demo-plugin", scope: "prompt", patterns: ["foo"] },
      ],
      getPluginHookDeclarations: () => [
        { plugin: "demo-plugin", hooks: [{ stage: "post-response" }] },
      ],
      getParameters: () => [],
      getPluginDir: () => null,
      getBuiltinDir: () => "/nonexistent-plugins",
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getStripTagPatterns: () => null,
      getPluginStyles: () => [],
      getPluginActionButtons: () => [],
    } as unknown as PluginManager;

    const app = createApp({
      config: {
        READER_DIR: "/nonexistent-reader",
        PLAYGROUND_DIR: "/nonexistent-playground",
        ROOT_DIR: "/nonexistent-root",
      } as unknown as AppConfig,
      safePath: () => null,
      pluginManager,
      hookDispatcher,
      buildPromptFromStory: async () => ({}) as unknown as BuildPromptResult,
      buildContinuePromptFromStory: (async () => ({
        messages: [],
        ventoError: null,
        targetChapterNumber: 0,
        existingContent: "",
        userMessageText: "",
        assistantPrefill: "",
      })) as unknown as import("../../../writer/types.ts").BuildContinuePromptFn,
      verifyPassphrase,
    } as AppDeps);

    await t.step("401 without X-Passphrase header", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugin-introspection/hooks"),
      );
      assertEquals(res.status, 401);
    });

    await t.step("200 with required keys", async () => {
      const res = await app.fetch(
        new Request("http://localhost/api/plugin-introspection/hooks", {
          headers: { "x-passphrase": "test-pass" },
        }),
      );
      assertEquals(res.status, 200);
      const body = await res.json();
      for (const k of [
        "backend",
        "manifestDeclarations",
        "stripTags",
        "pipelineFields",
        "generatedAt",
      ]) {
        assert(k in body, `missing key '${k}'`);
      }
      // backend snapshot contains the registered handler
      const backend = body.backend as Record<
        string,
        Array<{ plugin: string; priority: number; errorCount: number }>
      >;
      assertEquals(backend["post-response"]?.[0]?.plugin, "demo-plugin");
      assertEquals(backend["post-response"]?.[0]?.errorCount, 0);
      // pipelineFields is the engine-owned list
      assert(Array.isArray(body.pipelineFields));
      assert(
        (body.pipelineFields as Array<{ stage: string; field: string }>)
          .some((p) => p.stage === "response-stream" && p.field === "chunk"),
      );
    });

    await t.step("route does not shadow plugin name routes", async () => {
      // namespace is /api/plugin-introspection/* — distinct from /api/plugins/*
      const res = await app.fetch(
        new Request(
          "http://localhost/api/plugin-introspection",
          { headers: { "x-passphrase": "test-pass" } },
        ),
      );
      // not a defined route by itself — should 404, NOT collide with plugin handlers
      assert(res.status === 404 || res.status === 405);
    });
  },
});
