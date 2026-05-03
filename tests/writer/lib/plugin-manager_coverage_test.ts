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
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import {
  isValidPluginName,
  PluginManager,
} from "../../../writer/lib/plugin-manager.ts";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";

// Companion coverage tests for plugin-manager.ts targeting branches not
// reached by the primary tests/writer/lib/plugin-manager_test.ts. Each step
// uses ephemeral tmp dirs to keep test data fully isolated.

Deno.test("PluginManager – uncovered branches", async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "pm-cov-" });
  const logStub = stub(console, "log", () => {});
  const warnStub = stub(console, "warn", () => {});
  const errorStub = stub(console, "error", () => {});

  try {
    await t.step("isValidPluginName rejects invalid inputs", () => {
      assertEquals(isValidPluginName(""), false);
      assertEquals(isValidPluginName(undefined), false);
      assertEquals(isValidPluginName(123), false);
      assertEquals(isValidPluginName("../escape"), false);
      assertEquals(isValidPluginName("foo/bar"), false);
      assertEquals(isValidPluginName("foo\\bar"), false);
      assertEquals(isValidPluginName("foo\x00bar"), false);
      assertEquals(isValidPluginName("ok-name"), true);
    });

    await t.step("dot-prefixed directory entries are skipped", async () => {
      const pluginDir = join(tmpDir, "scan-dot");
      const dotDir = join(pluginDir, ".hidden");
      await Deno.mkdir(dotDir, { recursive: true });
      await Deno.writeTextFile(
        join(dotDir, "plugin.json"),
        JSON.stringify({ name: ".hidden", version: "1.0.0" }),
      );
      const pm = new PluginManager(pluginDir, undefined, new HookDispatcher());
      await pm.init();
      assertEquals(pm.getPlugins().length, 0);
    });

    await t.step(
      "non-directory entries inside plugin dir are skipped",
      async () => {
        const pluginDir = join(tmpDir, "scan-file");
        await Deno.mkdir(pluginDir, { recursive: true });
        await Deno.writeTextFile(join(pluginDir, "stray.txt"), "not a plugin");
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        assertEquals(pm.getPlugins().length, 0);
      },
    );

    await t.step(
      "directory without plugin.json is skipped silently",
      async () => {
        const pluginDir = join(tmpDir, "scan-no-manifest");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(pDir, { recursive: true });
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        assertEquals(pm.getPlugins().length, 0);
      },
    );

    await t.step("manifest that is JSON null is rejected", async () => {
      const pluginDir = join(tmpDir, "manifest-null");
      const pDir = join(pluginDir, "p");
      await Deno.mkdir(pDir, { recursive: true });
      await Deno.writeTextFile(join(pDir, "plugin.json"), "null");
      const pm = new PluginManager(pluginDir, undefined, new HookDispatcher());
      await pm.init();
      assertEquals(pm.getPlugins().length, 0);
      assert(
        warnStub.calls.some((c) => String(c.args[0]).includes("not an object")),
      );
    });

    await t.step(
      "manifest with non-string name field is rejected",
      async () => {
        const pluginDir = join(tmpDir, "manifest-bad-name");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({ name: 123, version: "1.0.0" }),
        );
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        assertEquals(pm.getPlugins().length, 0);
      },
    );

    await t.step(
      "readDir on non-readable path emits warn (not silent)",
      async () => {
        // Triggers the catch-all branch in #scanDir that handles errors other
        // than NotFound. We point at a regular file, so readDir throws NotADirectory.
        const filePath = join(tmpDir, "not-a-dir-sentinel");
        await Deno.writeTextFile(filePath, "hi");
        warnStub.calls.length = 0;
        const pm = new PluginManager(filePath, undefined, new HookDispatcher());
        await pm.init();
        assertEquals(pm.getPlugins().length, 0);
        assert(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("Failed to read plugin directory")
          ),
        );
      },
    );

    await t.step(
      "actionButtons non-array is ignored with warning",
      async () => {
        const pluginDir = join(tmpDir, "ab-nonarray");
        const pDir = join(pluginDir, "abna");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "abna",
            version: "1.0.0",
            actionButtons: "nope",
          }),
        );
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        assertEquals(pm.getPluginActionButtons("abna"), []);
      },
    );

    await t.step(
      "actionButtons drops non-object entries, non-string label, oversize label, non-string icon, invalid tooltip, non-finite priority",
      async () => {
        const pluginDir = join(tmpDir, "ab-validate-each");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "p",
            version: "1.0.0",
            actionButtons: [
              null, // non-object
              "string-entry", // non-object
              { id: "no-label", label: 42 }, // non-string label
              { id: "empty-label", label: "   " }, // trims to empty (length<1)
              { id: "huge-label", label: "x".repeat(41) }, // length>40
              { id: "bad-icon", label: "ok", icon: 99 }, // non-string icon
              { id: "bad-tt-type", label: "ok", tooltip: 1 }, // non-string tooltip
              { id: "bad-tt-len", label: "ok", tooltip: "x".repeat(201) }, // tooltip too long
              { id: "bad-prio", label: "ok", priority: Number.NaN }, // non-finite
              { id: "bad-prio-2", label: "ok", priority: "high" }, // non-number priority
              // Survivor with all optional fields:
              {
                id: "all-good",
                label: " keep ",
                icon: "🌟",
                tooltip: "tip",
                priority: 7,
                visibleWhen: "backend-only",
              },
            ],
          }),
        );
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        const buttons = pm.getPluginActionButtons("p");
        assertEquals(buttons.length, 1);
        assertEquals(buttons[0]?.id, "all-good");
        assertEquals(buttons[0]?.label, "keep"); // trimmed
        assertEquals(buttons[0]?.icon, "🌟");
        assertEquals(buttons[0]?.tooltip, "tip");
        assertEquals(buttons[0]?.priority, 7);
        assertEquals(buttons[0]?.visibleWhen, "backend-only");
      },
    );

    await t.step(
      "frontendStyles invalid entries: non-string, empty, non-css ext, absolute, '..' segment, backslash/url-hostile chars",
      async () => {
        const pluginDir = join(tmpDir, "fs-invalid");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(join(pDir, "ok.css"), "/* ok */");
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "p",
            version: "1.0.0",
            frontendStyles: [
              42, // non-string
              "", // empty string
              "no-ext", // not .css
              "/abs.css", // absolute path
              "../escape.css", // path traversal
              "evil\\style.css", // backslash
              "with#fragment.css", // fragment char
              "with?query.css", // query char
              "with%encoded.css", // percent char
              "ok.css", // survivor
            ],
          }),
        );
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        assertEquals(pm.getPluginStyles("p"), ["ok.css"]);
      },
    );

    await t.step(
      "frontendStyles entry pointing to a directory is rejected",
      async () => {
        const pluginDir = join(tmpDir, "fs-dir");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(join(pDir, "stylesDir.css"), { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "p",
            version: "1.0.0",
            frontendStyles: ["stylesDir.css"],
          }),
        );
        warnStub.calls.length = 0;
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        assertEquals(pm.getPluginStyles("p"), []);
        assert(
          warnStub.calls.some((c) => String(c.args[0]).includes("not a file")),
        );
      },
    );

    await t.step(
      "frontendStyles symlink to outside plugin dir is rejected",
      async () => {
        const outerDir = await Deno.makeTempDir({
          prefix: "pm-cov-symlink-outside-",
        });
        try {
          const outerCss = join(outerDir, "outside.css");
          await Deno.writeTextFile(outerCss, "/* external */");

          const pluginDir = join(tmpDir, "fs-symlink");
          const pDir = join(pluginDir, "p");
          await Deno.mkdir(pDir, { recursive: true });
          const linkPath = join(pDir, "linked.css");
          try {
            await Deno.symlink(outerCss, linkPath);
          } catch {
            // Skip on platforms without symlink permission
            return;
          }
          await Deno.writeTextFile(
            join(pDir, "plugin.json"),
            JSON.stringify({
              name: "p",
              version: "1.0.0",
              frontendStyles: ["linked.css"],
            }),
          );

          warnStub.calls.length = 0;
          const pm = new PluginManager(
            pluginDir,
            undefined,
            new HookDispatcher(),
          );
          await pm.init();
          assertEquals(pm.getPluginStyles("p"), []);
          assert(
            warnStub.calls.some((c) =>
              String(c.args[0]).includes("resolves outside plugin directory")
            ),
          );
        } finally {
          await Deno.remove(outerDir, { recursive: true });
        }
      },
    );

    await t.step(
      "getStripTagPatterns: non-string and zero-length entries skipped",
      async () => {
        const pluginDir = join(tmpDir, "strip-junk");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "p",
            version: "1.0.0",
            promptStripTags: [42, "", "real_tag"],
          }),
        );
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        const re = pm.getStripTagPatterns();
        assert(re instanceof RegExp);
        assert(re.test("<real_tag>x</real_tag>"));
      },
    );

    await t.step(
      "getStripTagPatterns: regex with single leading slash is rejected",
      async () => {
        const pluginDir = join(tmpDir, "strip-bad-slash");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "p",
            version: "1.0.0",
            // "/foo" — only one slash; lastSlash <= 0 → reject
            promptStripTags: ["/foo"],
          }),
        );
        warnStub.calls.length = 0;
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        assertEquals(pm.getStripTagPatterns(), null);
        assert(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("invalid regex stripTag")
          ),
        );
      },
    );

    await t.step(
      "getCombinedStripTagPatterns: non-string entries inside arrays are skipped",
      async () => {
        const pluginDir = join(tmpDir, "combined-non-string");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "p",
            version: "1.0.0",
            promptStripTags: [123, "alpha"],
            displayStripTags: [{}, "beta"],
          }),
        );
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        const re = pm.getCombinedStripTagPatterns();
        assert(re instanceof RegExp);
        // Use replaceAll because re has the `g` flag and test() is stateful.
        const scrubbed = "<alpha>x</alpha> <beta>y</beta>".replaceAll(re, "_");
        assertEquals(scrubbed, "_ _");
      },
    );

    await t.step(
      "getPromptVariables: skips fragments missing the file field",
      async () => {
        const pluginDir = join(tmpDir, "frag-nofile");
        const pDir = join(pluginDir, "p");
        await Deno.mkdir(pDir, { recursive: true });
        await Deno.writeTextFile(
          join(pDir, "plugin.json"),
          JSON.stringify({
            name: "p",
            version: "1.0.0",
            promptFragments: [{ variable: "v" }, {}],
          }),
        );
        const pm = new PluginManager(
          pluginDir,
          undefined,
          new HookDispatcher(),
        );
        await pm.init();
        const pv = await pm.getPromptVariables();
        assertEquals(pv.fragments.length, 0);
        assertEquals(Object.keys(pv.variables).length, 0);
      },
    );

    await t.step(
      "getDynamicVariables: provider returning non-object skipped, core var rejected, conflicts kept first, throws caught",
      async () => {
        // Plugin scan order is filesystem-dependent (Deno.readDir is unordered),
        // so we drive a deterministic load order by spreading plugins across
        // builtin (loaded first) and external (loaded second) directories.
        const builtinDir = join(tmpDir, "dynvars-builtin");
        const externalDir = join(tmpDir, "dynvars-external");

        // Plugin "first" — first scanned (builtin), seeds `shared` and tries to
        // overwrite a core var (must be ignored).
        const pFirst = join(builtinDir, "first");
        await Deno.mkdir(pFirst, { recursive: true });
        await Deno.writeTextFile(
          join(pFirst, "plugin.json"),
          JSON.stringify({
            name: "first",
            version: "1.0.0",
            backendModule: "i.js",
          }),
        );
        await Deno.writeTextFile(
          join(pFirst, "i.js"),
          `export function getDynamicVariables() {
           return { shared: "from-first", user_input: "evil" };
         }`,
        );

        // Plugins loaded after "first" all live in external dir; readDir ordering
        // among them doesn't matter for the assertions we make below.
        const pNullish = join(externalDir, "nullish");
        await Deno.mkdir(pNullish, { recursive: true });
        await Deno.writeTextFile(
          join(pNullish, "plugin.json"),
          JSON.stringify({
            name: "nullish",
            version: "1.0.0",
            backendModule: "i.js",
          }),
        );
        await Deno.writeTextFile(
          join(pNullish, "i.js"),
          `export function getDynamicVariables() { return null; }`,
        );

        const pConflict = join(externalDir, "conflict");
        await Deno.mkdir(pConflict, { recursive: true });
        await Deno.writeTextFile(
          join(pConflict, "plugin.json"),
          JSON.stringify({
            name: "conflict",
            version: "1.0.0",
            backendModule: "i.js",
          }),
        );
        await Deno.writeTextFile(
          join(pConflict, "i.js"),
          `export function getDynamicVariables() { return { shared: "from-conflict", unique_c: 1 }; }`,
        );

        const pThrower = join(externalDir, "thrower");
        await Deno.mkdir(pThrower, { recursive: true });
        await Deno.writeTextFile(
          join(pThrower, "plugin.json"),
          JSON.stringify({
            name: "thrower",
            version: "1.0.0",
            backendModule: "i.js",
          }),
        );
        await Deno.writeTextFile(
          join(pThrower, "i.js"),
          `export function getDynamicVariables() { throw new Error("boom"); }`,
        );

        warnStub.calls.length = 0;
        const pm = new PluginManager(
          builtinDir,
          externalDir,
          new HookDispatcher(),
        );
        await pm.init();

        const ctx = {
          series: "s",
          name: "n",
          storyDir: "/x",
          userInput: "",
          chapterNumber: 0,
          previousContent: "",
          isFirstRound: true,
          chapterCount: 0,
        };
        const vars = await pm.getDynamicVariables(ctx);
        // "first" runs before "conflict" because its dir is in the builtin scan.
        assertEquals(vars.shared, "from-first");
        assertEquals(vars.unique_c, 1);
        // Core var must not be overwritten:
        assert(!("user_input" in vars));
        assert(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("core variable")
          ),
        );
        assert(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("conflicts with earlier plugin")
          ),
        );
        assert(
          warnStub.calls.some((c) =>
            String(c.args[0]).includes("getDynamicVariables() failed")
          ),
        );
      },
    );

    await t.step("getBuiltinDir returns constructor argument", async () => {
      const pluginDir = join(tmpDir, "builtin-dir-prop");
      await Deno.mkdir(pluginDir, { recursive: true });
      const pm = new PluginManager(pluginDir, undefined, new HookDispatcher());
      await pm.init();
      assertEquals(pm.getBuiltinDir(), pluginDir);
    });
  } finally {
    logStub.restore();
    warnStub.restore();
    errorStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});
