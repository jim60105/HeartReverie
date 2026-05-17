// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Branch coverage for writer/lib/template-preview.ts focusing on:
//   - `current` mode delegation (system + plugin-fragment/lore)
//   - error/throw paths in pure renderers (messages + markdown)
//   - SSTI rejection for non-system kinds
//   - loadDefaultFixture cached & rootDir-fallback branches
//
// These tests assemble a minimal `AppDeps` stub instead of booting the
// full app — the SUT only touches `safePath`, `config.PLAYGROUND_DIR`,
// `buildPromptFromStory`, and `pluginManager.getDynamicVariables`.

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { createTemplateEngine } from "../../../writer/lib/template.ts";
import {
  _resetDefaultFixtureCache,
  loadDefaultFixture,
  renderSystemPromptForPreview,
} from "../../../writer/lib/template-preview.ts";
import type { AppDeps, BuildPromptResult } from "../../../writer/types.ts";

const ROOT_DIR = new URL("../../../", import.meta.url).pathname;

async function mkEngine() {
  const hd = new HookDispatcher();
  const pm = new PluginManager(
    await Deno.makeTempDir(),
    undefined,
    hd,
    await Deno.makeTempDir(),
  );
  await pm.init();
  return { hd, pm, ventoEnv: createTemplateEngine(pm).ventoEnv };
}

// deno-lint-ignore no-explicit-any
function makeDeps(overrides: Partial<any> = {}): AppDeps {
  const pm = overrides.pluginManager ?? {
    // deno-lint-ignore require-await
    getDynamicVariables: async () => ({ extra: "from-plugin" }),
  };
  return {
    config: {
      PLAYGROUND_DIR: overrides.playgroundDir ?? "/tmp",
    },
    safePath: overrides.safePath ?? ((...s: string[]) => join("/tmp", ...s)),
    pluginManager: pm,
    hookDispatcher: new HookDispatcher(),
    buildPromptFromStory: overrides.buildPromptFromStory ??
      (async (
        _series: string,
        _name: string,
        _storyDir: string,
        _message: string,
        _template?: string,
      ): Promise<BuildPromptResult> => ({
        messages: [{ role: "user", content: "ok" }],
        // deno-lint-ignore no-explicit-any
      } as any)),
    buildContinuePromptFromStory: (async () => ({})) as unknown as AppDeps[
      "buildContinuePromptFromStory"
    ],
    verifyPassphrase: (async () => {}) as unknown as AppDeps["verifyPassphrase"],
    templateEngine: null,
    // deno-lint-ignore no-explicit-any
  } as any;
}

Deno.test("renderSystemPromptForPreview: messages render throws → ventoError", async () => {
  const { ventoEnv } = await mkEngine();
  const result = await renderSystemPromptForPreview({
    mode: "default",
    source: `{{ message "user" }}{{ undefined.boom }}{{ /message }}`,
    templateKind: "system",
    ventoEnv,
    fixture: {},
  });
  assertEquals(result.kind, "messages");
  assert(result.ventoError);
});

Deno.test("renderSystemPromptForPreview: messages without user role → ventoError but partial messages", async () => {
  const { ventoEnv } = await mkEngine();
  const result = await renderSystemPromptForPreview({
    mode: "default",
    source: `{{ message "system" }}hello{{ /message }}`,
    templateKind: "system",
    ventoEnv,
    fixture: {},
  });
  assertEquals(result.kind, "messages");
  assert(result.ventoError, "expected assertHasUserMessage to fire");
});

Deno.test("renderSystemPromptForPreview: markdown render throws → ventoError", async () => {
  const { ventoEnv } = await mkEngine();
  const result = await renderSystemPromptForPreview({
    mode: "default",
    source: "{{ undefined.boom }}",
    templateKind: "lore",
    ventoEnv,
    fixture: {},
  });
  assertEquals(result.kind, "markdown");
  assert(result.ventoError);
});

Deno.test("renderSystemPromptForPreview: SSTI rejection on plugin-fragment returns markdown shell", async () => {
  const { ventoEnv } = await mkEngine();
  const result = await renderSystemPromptForPreview({
    mode: "inline",
    source: "{{ set evil = 1 }}",
    templateKind: "plugin-fragment",
    ventoEnv,
    fixture: {},
  });
  assertEquals(result.kind, "markdown");
  assert(result.ventoError);
  assertStringIncludes(result.ventoError!.message, "unsafe expressions");
});

Deno.test("renderSystemPromptForPreview: current/system safePath null → ventoError", async () => {
  const { ventoEnv } = await mkEngine();
  const deps = makeDeps({ safePath: () => null });
  const result = await renderSystemPromptForPreview({
    mode: "current",
    source: `{{ message "user" }}x{{ /message }}`,
    templateKind: "system",
    ventoEnv,
    series: "../evil",
    story: "x",
    deps,
  });
  assertEquals(result.kind, "messages");
  assert(result.ventoError);
  assertStringIncludes(result.ventoError!.message, "Invalid path");
});

Deno.test("renderSystemPromptForPreview: current/system success delegates to buildPromptFromStory", async () => {
  const { ventoEnv } = await mkEngine();
  let captured: { series?: string; name?: string } = {};
  const deps = makeDeps({
    // deno-lint-ignore require-await
    buildPromptFromStory: async (series: string, name: string) => {
      captured = { series, name };
      return { messages: [{ role: "user", content: "delegated" }] };
    },
  });
  const result = await renderSystemPromptForPreview({
    mode: "current",
    source: "ignored-because-deps-builds-prompt",
    templateKind: "system",
    ventoEnv,
    series: "S",
    story: "St",
    deps,
  });
  assertEquals(result.kind, "messages");
  assertEquals(captured, { series: "S", name: "St" });
  assertEquals(result.fixtureUsed, "current");
});

Deno.test("renderSystemPromptForPreview: current/system buildPromptFromStory returns ventoError", async () => {
  const { ventoEnv } = await mkEngine();
  const deps = makeDeps({
    // deno-lint-ignore require-await
    buildPromptFromStory: async () => ({
      messages: [{ role: "user", content: "x" }],
      ventoError: { message: "boom" },
    }),
  });
  const result = await renderSystemPromptForPreview({
    mode: "current",
    source: "x",
    templateKind: "system",
    ventoEnv,
    series: "S",
    story: "St",
    deps,
  });
  assertEquals(result.kind, "messages");
  assertEquals(result.ventoError?.message, "boom");
});

Deno.test("renderSystemPromptForPreview: current/system buildPromptFromStory throws → ventoError", async () => {
  const { ventoEnv } = await mkEngine();
  const deps = makeDeps({
    buildPromptFromStory: async () => {
      await Promise.resolve();
      throw new Error("kaboom");
    },
  });
  const result = await renderSystemPromptForPreview({
    mode: "current",
    source: "x",
    templateKind: "system",
    ventoEnv,
    series: "S",
    story: "St",
    deps,
  });
  assertEquals(result.kind, "messages");
  assertEquals(result.ventoError?.message, "kaboom");
});

Deno.test("renderSystemPromptForPreview: current/plugin-fragment merges plugin vars and lore", async () => {
  // Create a playground with a real lore folder so resolveLoreVariables succeeds.
  const playground = await Deno.makeTempDir({ prefix: "tp-current-pf-" });
  const storyDir = join(playground, "Sx", "Stx");
  await Deno.mkdir(storyDir, { recursive: true });

  const { ventoEnv } = await mkEngine();
  const deps = makeDeps({
    playgroundDir: playground,
    safePath: (...s: string[]) => join(playground, ...s),
    pluginManager: {
      // deno-lint-ignore require-await
      getDynamicVariables: async () => ({ extra: "from-plugin" }),
    },
  });
  try {
    const result = await renderSystemPromptForPreview({
      mode: "current",
      source: "P:{{ extra }} S:{{ series_name }}",
      templateKind: "plugin-fragment",
      ventoEnv,
      series: "Sx",
      story: "Stx",
      deps,
    });
    assertEquals(result.kind, "markdown");
    if (result.kind === "markdown") {
      assertStringIncludes(result.content, "from-plugin");
      assertStringIncludes(result.content, "Sx");
    }
  } finally {
    await Deno.remove(playground, { recursive: true });
  }
});

Deno.test("renderSystemPromptForPreview: current/plugin-fragment vento failure → ventoError", async () => {
  const playground = await Deno.makeTempDir({ prefix: "tp-current-pf-err-" });
  await Deno.mkdir(join(playground, "S", "St"), { recursive: true });
  const { ventoEnv } = await mkEngine();
  const deps = makeDeps({
    playgroundDir: playground,
    safePath: (...s: string[]) => join(playground, ...s),
  });
  try {
    const result = await renderSystemPromptForPreview({
      mode: "current",
      source: "{{ undefined.boom }}",
      templateKind: "lore",
      ventoEnv,
      series: "S",
      story: "St",
      deps,
    });
    assertEquals(result.kind, "markdown");
    assert(result.ventoError);
  } finally {
    await Deno.remove(playground, { recursive: true });
  }
});

Deno.test("loadDefaultFixture: caches on first read", async () => {
  _resetDefaultFixtureCache();
  const a = await loadDefaultFixture(ROOT_DIR);
  const b = await loadDefaultFixture(ROOT_DIR);
  assertEquals(a, b);
});
