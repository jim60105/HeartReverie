// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { assert, assertEquals } from "@std/assert";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { createTemplateEngine } from "../../../writer/lib/template.ts";
import {
  fixtureToContext,
  loadDefaultFixture,
  renderSystemPromptForPreview,
  _resetDefaultFixtureCache,
} from "../../../writer/lib/template-preview.ts";

async function mkEngine() {
  const hd = new HookDispatcher();
  const pm = new PluginManager(
    await Deno.makeTempDir(),
    undefined,
    hd,
    await Deno.makeTempDir(),
  );
  await pm.init();
  return createTemplateEngine(pm).ventoEnv;
}

const ROOT_DIR = new URL("../../../", import.meta.url).pathname;

Deno.test("fixtureToContext: injects missing defaults", () => {
  const { context, injected } = fixtureToContext({});
  assert(injected.includes("series_name"));
  assert(injected.includes("user_input"));
  assertEquals(context.previous_context, []);
});

Deno.test("loadDefaultFixture: loads bundled JSON", async () => {
  _resetDefaultFixtureCache();
  const fixture = await loadDefaultFixture(ROOT_DIR);
  assert("series_name" in fixture);
});

Deno.test("renderSystemPromptForPreview: default mode renders messages without IO", async () => {
  const env = await mkEngine();
  const result = await renderSystemPromptForPreview({
    mode: "default",
    source: `{{ message "user" }}{{ user_input }}{{ /message }}`,
    templateKind: "system",
    ventoEnv: env,
    fixture: { user_input: "hello" },
  });
  assertEquals(result.kind, "messages");
  if (result.kind === "messages") {
    assert(result.messages.length >= 1);
  }
});

Deno.test("renderSystemPromptForPreview: inline override controls fixture", async () => {
  const env = await mkEngine();
  const result = await renderSystemPromptForPreview({
    mode: "inline",
    source: `{{ message "user" }}{{ series_name }}{{ /message }}`,
    templateKind: "system",
    ventoEnv: env,
    fixture: { series_name: "Override Series" },
  });
  if (result.kind === "messages") {
    const msg = result.messages.find((m) =>
      typeof m.content === "string" && m.content.includes("Override Series")
    );
    assert(msg, `expected message with override series; got ${JSON.stringify(result.messages)}`);
  } else {
    throw new Error("expected messages kind");
  }
});

Deno.test("renderSystemPromptForPreview: plugin-fragment kind returns markdown", async () => {
  const env = await mkEngine();
  const result = await renderSystemPromptForPreview({
    mode: "default",
    source: "Hello {{ user_input }}",
    templateKind: "plugin-fragment",
    ventoEnv: env,
    fixture: { user_input: "world" },
  });
  assertEquals(result.kind, "markdown");
  if (result.kind === "markdown") {
    assert(result.content.includes("world"));
  }
});

Deno.test("renderSystemPromptForPreview: SSTI rejection short-circuits with error", async () => {
  const env = await mkEngine();
  const result = await renderSystemPromptForPreview({
    mode: "default",
    source: "{{ set evil = 1 }}",
    templateKind: "system",
    ventoEnv: env,
    fixture: {},
  });
  assert(result.ventoError);
});
