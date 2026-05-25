// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Validation tests for the required `displayName` manifest field added by
// the `plugin-display-name` proposal. The loader MUST reject any manifest
// that omits `displayName`, supplies a non-string value, or supplies a
// value whose trim is empty.

import { assertEquals, assert as assertTrue } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";

interface WarnCall {
  readonly args: unknown[];
}

function captureWarn(): { restore: () => void; calls: WarnCall[] } {
  const calls: WarnCall[] = [];
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", (...args: unknown[]) => {
    calls.push({ args });
  });
  const errorStub = stub(console, "error", () => {});
  return {
    restore: () => {
      logStub.restore();
      warnStub.restore();
      errorStub.restore();
    },
    calls,
  };
}

async function writeManifest(
  parent: string,
  dirName: string,
  manifest: unknown,
): Promise<string> {
  const pDir = join(parent, dirName);
  await Deno.mkdir(pDir, { recursive: true });
  await Deno.writeTextFile(
    join(pDir, "plugin.json"),
    JSON.stringify(manifest),
  );
  return pDir;
}

function warnIncludes(calls: WarnCall[], needle: string): boolean {
  return calls.some((c) =>
    c.args.some((a) => typeof a === "string" && a.includes(needle))
  );
}

Deno.test("PluginManager: displayName manifest validation", async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "pm-display-" });

  await t.step("loads plugin when displayName is non-empty string", async () => {
    const w = captureWarn();
    try {
      const pluginsDir = join(tmpDir, "ok");
      await writeManifest(pluginsDir, "ok-plugin", {
        name: "ok-plugin",
        displayName: "OK 外掛",
        version: "1.0.0",
      });
      const pm = new PluginManager(
        pluginsDir,
        undefined,
        new HookDispatcher(),
        await Deno.makeTempDir(),
      );
      await pm.init();
      const list = pm.getPlugins();
      assertEquals(list.length, 1);
      assertEquals(list[0]!.displayName, "OK 外掛");
    } finally {
      w.restore();
    }
  });

  await t.step("rejects manifest missing displayName", async () => {
    const w = captureWarn();
    try {
      const pluginsDir = join(tmpDir, "missing");
      await writeManifest(pluginsDir, "no-display", {
        name: "no-display",
        version: "1.0.0",
      });
      const pm = new PluginManager(
        pluginsDir,
        undefined,
        new HookDispatcher(),
        await Deno.makeTempDir(),
      );
      await pm.init();
      assertEquals(pm.getPlugins().length, 0);
      assertTrue(warnIncludes(w.calls, "displayName"));
    } finally {
      w.restore();
    }
  });

  await t.step("rejects non-string displayName values", async () => {
    const bad: unknown[] = [123, null, ["X"], { "zh-TW": "X" }, true];
    for (const value of bad) {
      const w = captureWarn();
      try {
        const slug = `bad-${typeof value}-${Math.random().toString(36).slice(2, 6)}`;
        const pluginsDir = join(tmpDir, slug);
        await writeManifest(pluginsDir, slug, {
          name: slug,
          displayName: value,
          version: "1.0.0",
        });
        const pm = new PluginManager(
          pluginsDir,
          undefined,
          new HookDispatcher(),
          await Deno.makeTempDir(),
        );
        await pm.init();
        assertEquals(pm.getPlugins().length, 0);
        assertTrue(warnIncludes(w.calls, "displayName"));
      } finally {
        w.restore();
      }
    }
  });

  await t.step("rejects empty / whitespace-only displayName", async () => {
    for (const value of ["", "   ", "\t", "\n  "]) {
      const w = captureWarn();
      try {
        const slug = `ws-${Math.random().toString(36).slice(2, 6)}`;
        const pluginsDir = join(tmpDir, slug);
        await writeManifest(pluginsDir, slug, {
          name: slug,
          displayName: value,
          version: "1.0.0",
        });
        const pm = new PluginManager(
          pluginsDir,
          undefined,
          new HookDispatcher(),
          await Deno.makeTempDir(),
        );
        await pm.init();
        assertEquals(pm.getPlugins().length, 0);
        assertTrue(
          warnIncludes(w.calls, "displayName"),
          "expected a displayName-related warn for value " + JSON.stringify(value),
        );
      } finally {
        w.restore();
      }
    }
  });
});
