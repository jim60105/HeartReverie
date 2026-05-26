// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { assert, assertEquals } from "@std/assert";
import vento from "ventojs";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { lintTemplate, TEMPLATE_LINT_MAX_LENGTH } from "../../../writer/lib/template-lint.ts";

function mkEnv() {
  return vento();
}

async function mkPM() {
  const tmp = await Deno.makeTempDir();
  const hd = new HookDispatcher();
  const pm = new PluginManager(tmp, undefined, hd, await Deno.makeTempDir());
  await pm.init();
  return { pm, tmp };
}

Deno.test("lintTemplate: clean system template produces zero errors", async () => {
  const { pm, tmp } = await mkPM();
  try {
    const diagnostics = await lintTemplate({
      source: "Hello {{ user_input }} in {{ series_name }}",
      templatePath: "system.md",
      kind: "system",
      ventoEnv: mkEnv(),
      pluginManager: pm,
      playgroundDir: tmp,
    });
    const errors = diagnostics.filter((d) => d.severity === "error");
    assertEquals(errors.length, 0);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("lintTemplate: rejects unsafe set/include/import via vento.unsafe-expression", async () => {
  const { pm, tmp } = await mkPM();
  try {
    const samples = [
      "{{ set evil = 1 }}",
      "{{ include 'x.vto' }}",
      "{{> 1 + 1 }}",
    ];
    for (const source of samples) {
      const diagnostics = await lintTemplate({
        source,
        templatePath: "system.md",
        kind: "system",
        ventoEnv: mkEnv(),
        pluginManager: pm,
        playgroundDir: tmp,
      });
      assert(
        diagnostics.some((d) => d.ruleId === "vento.unsafe-expression"),
        `expected vento.unsafe-expression for ${source}; got ${JSON.stringify(diagnostics)}`,
      );
    }
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("lintTemplate: parse error surfaces as vento.parse-error", async () => {
  const { pm, tmp } = await mkPM();
  try {
    const diagnostics = await lintTemplate({
      source: "{{ if user_input }}\nunterminated",
      templatePath: "system.md",
      kind: "system",
      ventoEnv: mkEnv(),
      pluginManager: pm,
      playgroundDir: tmp,
    });
    assert(diagnostics.some((d) => d.ruleId.startsWith("vento.")));
    assert(diagnostics.some((d) => d.severity === "error"));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("lintTemplate: unknown variable produces warning, not error", async () => {
  const { pm, tmp } = await mkPM();
  try {
    const diagnostics = await lintTemplate({
      source: "Hello {{ unknown_var_xyz }}",
      templatePath: "system.md",
      kind: "system",
      ventoEnv: mkEnv(),
      pluginManager: pm,
      playgroundDir: tmp,
    });
    const warn = diagnostics.find((d) => d.ruleId === "vento.unknown-variable");
    assert(warn, "expected unknown-variable warning");
    assertEquals(warn!.severity, "warning");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("lintTemplate: refuses templates over max length", async () => {
  const { pm, tmp } = await mkPM();
  try {
    const big = "x".repeat(TEMPLATE_LINT_MAX_LENGTH + 1);
    const diagnostics = await lintTemplate({
      source: big,
      templatePath: "system.md",
      kind: "system",
      ventoEnv: mkEnv(),
      pluginManager: pm,
      playgroundDir: tmp,
    });
    assertEquals(diagnostics.length, 1);
    assertEquals(diagnostics[0]!.ruleId, "vento.long-template");
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
