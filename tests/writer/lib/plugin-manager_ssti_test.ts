// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// BREAKING: SSTI enforcement on plugin promptFragments. A plugin whose
// fragment contains a forbidden Vento construct ({{> ... }}, {{ set }},
// {{ include }}, {{ import }}) is removed entirely at PluginManager.init()
// — no hooks, no settings, no parameters, no listing.

import { assert, assertEquals } from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";

async function writePlugin(
  dir: string,
  name: string,
  fragmentSource: string,
) {
  const pDir = join(dir, name);
  await Deno.mkdir(pDir, { recursive: true });
  await Deno.writeTextFile(
    join(pDir, "plugin.json"),
    JSON.stringify({
      name,
      displayName: name,
      version: "1.0.0",
      promptFragments: [{ file: "frag.md", variable: `${name}_frag` }],
    }),
  );
  await Deno.writeTextFile(join(pDir, "frag.md"), fragmentSource);
}

Deno.test("plugin with {{> expr }} fragment is rejected and absent from manager", async () => {
  const errorStub = stub(console, "error", () => {});
  const warnStub = stub(console, "warn", () => {});
  const infoStub = stub(console, "info", () => {});
  const tmpDir = await Deno.makeTempDir();
  try {
    // Bad plugin: fragment with arbitrary-expression include syntax.
    await writePlugin(tmpDir, "evil-plugin", "{{> 1 + 1 }}");
    // Clean sibling
    await writePlugin(tmpDir, "good-plugin", "Hello {{ user_input }}");

    const hd = new HookDispatcher();
    const pm = new PluginManager(tmpDir, undefined, hd, await Deno.makeTempDir());
    await pm.init();

    assertEquals(pm.hasPlugin("evil-plugin"), false);
    assertEquals(pm.hasPlugin("good-plugin"), true);

    // Error log must explain the rejection
    assert(
      errorStub.calls.some((c) =>
        String(c.args[0]).includes("SSTI") ||
        String(c.args[0]).includes("unsafe") ||
        String(c.args[0]).includes("fragment")
      ),
      "expected error log for SSTI rejection",
    );

    // Variables from evil-plugin must not appear in catalog
    const pv = await pm.getPromptVariables();
    assertEquals(
      pv.fragments.some((f) => f.includes("evil")),
      false,
    );
  } finally {
    errorStub.restore();
    warnStub.restore();
    infoStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("plugin with {{ set }} fragment is rejected", async () => {
  const errorStub = stub(console, "error", () => {});
  const warnStub = stub(console, "warn", () => {});
  const infoStub = stub(console, "info", () => {});
  const tmpDir = await Deno.makeTempDir();
  try {
    await writePlugin(tmpDir, "set-plugin", "{{ set foo = 'bar' }}{{ foo }}");
    const hd = new HookDispatcher();
    const pm = new PluginManager(tmpDir, undefined, hd, await Deno.makeTempDir());
    await pm.init();
    assertEquals(pm.hasPlugin("set-plugin"), false);
  } finally {
    errorStub.restore();
    warnStub.restore();
    infoStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("plugin with {{ include }} fragment is rejected", async () => {
  const errorStub = stub(console, "error", () => {});
  const warnStub = stub(console, "warn", () => {});
  const infoStub = stub(console, "info", () => {});
  const tmpDir = await Deno.makeTempDir();
  try {
    await writePlugin(tmpDir, "incl-plugin", "{{ include 'other.md' }}");
    const hd = new HookDispatcher();
    const pm = new PluginManager(tmpDir, undefined, hd, await Deno.makeTempDir());
    await pm.init();
    assertEquals(pm.hasPlugin("incl-plugin"), false);
  } finally {
    errorStub.restore();
    warnStub.restore();
    infoStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("render-time on-disk edit with SSTI is skipped, plugin retained", async () => {
  const errorStub = stub(console, "error", () => {});
  const warnStub = stub(console, "warn", () => {});
  const infoStub = stub(console, "info", () => {});
  const tmpDir = await Deno.makeTempDir();
  try {
    await writePlugin(tmpDir, "edit-plugin", "Hello {{ user_input }}");
    const hd = new HookDispatcher();
    const pm = new PluginManager(tmpDir, undefined, hd, await Deno.makeTempDir());
    await pm.init();
    assertEquals(pm.hasPlugin("edit-plugin"), true);

    // Now corrupt the on-disk file with an SSTI payload.
    await Deno.writeTextFile(
      join(tmpDir, "edit-plugin", "frag.md"),
      "{{> 1 + 1 }}",
    );

    const pv = await pm.getPromptVariables();
    // Defence in depth: the corrupted fragment is skipped during read.
    assertEquals(
      pv.fragments.some((f) => f.includes("1 + 1")),
      false,
    );
    // Plugin remains registered (init-time scan is the source of truth)
    assertEquals(pm.hasPlugin("edit-plugin"), true);
  } finally {
    errorStub.restore();
    warnStub.restore();
    infoStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});
