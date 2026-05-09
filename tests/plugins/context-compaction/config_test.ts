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

import { assertEquals } from "@std/assert";
import { DEFAULTS, loadCompactionConfig } from "../../../plugins/context-compaction/config.ts";
import { join } from "@std/path";

async function writePluginSettings(
  playgroundDir: string,
  contents: string,
): Promise<void> {
  const dir = join(playgroundDir, "_plugins", "context-compaction");
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, "config.json"), contents);
}

Deno.test("loadCompactionConfig", async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "compaction-config-test-" });

  await t.step("returns defaults when no config exists", async () => {
    const storyDir = join(tmpDir, "no-exist-series", "no-exist-story");
    const config = await loadCompactionConfig(storyDir, "no-exist-series", tmpDir);
    assertEquals(config.recentChapters, 3);
    assertEquals(config.enabled, true);
  });

  await t.step("reads series-level config", async () => {
    const seriesDir = join(tmpDir, "test-series");
    await Deno.mkdir(seriesDir, { recursive: true });
    await Deno.writeTextFile(
      join(seriesDir, "compaction-config.yaml"),
      "recentChapters: 5\nenabled: true\n",
    );

    const storyDir = join(seriesDir, "some-story");
    const config = await loadCompactionConfig(storyDir, "test-series", tmpDir);
    assertEquals(config.recentChapters, 5);
    assertEquals(config.enabled, true);
  });

  await t.step("story-level overrides series-level", async () => {
    const seriesDir = join(tmpDir, "override-series");
    const storyDir = join(seriesDir, "override-story");
    await Deno.mkdir(storyDir, { recursive: true });
    await Deno.writeTextFile(
      join(seriesDir, "compaction-config.yaml"),
      "recentChapters: 5\nenabled: true\n",
    );
    await Deno.writeTextFile(
      join(storyDir, "compaction-config.yaml"),
      "recentChapters: 10\nenabled: false\n",
    );

    const config = await loadCompactionConfig(storyDir, "override-series", tmpDir);
    assertEquals(config.recentChapters, 10);
    assertEquals(config.enabled, false);
  });

  await t.step("invalid recentChapters falls back to default", async () => {
    const seriesDir = join(tmpDir, "invalid-series");
    await Deno.mkdir(seriesDir, { recursive: true });
    await Deno.writeTextFile(
      join(seriesDir, "compaction-config.yaml"),
      "recentChapters: -1\n",
    );

    const storyDir = join(seriesDir, "some-story");
    const config = await loadCompactionConfig(storyDir, "invalid-series", tmpDir);
    assertEquals(config.recentChapters, 3);
  });

  await t.step("disabled flag respected", async () => {
    const seriesDir = join(tmpDir, "disabled-series");
    await Deno.mkdir(seriesDir, { recursive: true });
    await Deno.writeTextFile(
      join(seriesDir, "compaction-config.yaml"),
      "enabled: false\n",
    );

    const storyDir = join(seriesDir, "some-story");
    const config = await loadCompactionConfig(storyDir, "disabled-series", tmpDir);
    assertEquals(config.enabled, false);
    assertEquals(config.recentChapters, 3);
  });

  // Cleanup
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("loadCompactionConfig — plugin-settings layer (UI)", async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "compaction-settings-test-" });

  await t.step("plugin settings apply when no YAML exists", async () => {
    await writePluginSettings(tmpDir, JSON.stringify({ recentChapters: 5, enabled: true }));
    const storyDir = join(tmpDir, "ui-only-series", "ui-only-story");
    const config = await loadCompactionConfig(storyDir, "ui-only-series", tmpDir);
    assertEquals(config.recentChapters, 5);
    assertEquals(config.enabled, true);
    await Deno.remove(join(tmpDir, "_plugins"), { recursive: true });
  });

  await t.step("story YAML overrides plugin settings", async () => {
    await writePluginSettings(tmpDir, JSON.stringify({ recentChapters: 7, enabled: true }));
    const seriesDir = join(tmpDir, "story-overrides-ui");
    const storyDir = join(seriesDir, "the-story");
    await Deno.mkdir(storyDir, { recursive: true });
    await Deno.writeTextFile(
      join(storyDir, "compaction-config.yaml"),
      "recentChapters: 2\n",
    );
    const config = await loadCompactionConfig(storyDir, "story-overrides-ui", tmpDir);
    assertEquals(config.recentChapters, 2); // story wins
    // story YAML didn't specify `enabled` → plugin-settings value (true) wins, defaults match anyway
    assertEquals(config.enabled, true);
    await Deno.remove(join(tmpDir, "_plugins"), { recursive: true });
  });

  await t.step("series YAML overrides plugin settings (no story YAML)", async () => {
    await writePluginSettings(tmpDir, JSON.stringify({ recentChapters: 7, enabled: true }));
    const seriesDir = join(tmpDir, "series-overrides-ui");
    await Deno.mkdir(seriesDir, { recursive: true });
    await Deno.writeTextFile(
      join(seriesDir, "compaction-config.yaml"),
      "recentChapters: 4\n",
    );
    const storyDir = join(seriesDir, "no-story-yaml");
    const config = await loadCompactionConfig(storyDir, "series-overrides-ui", tmpDir);
    assertEquals(config.recentChapters, 4);
    assertEquals(config.enabled, true);
    await Deno.remove(join(tmpDir, "_plugins"), { recursive: true });
  });

  await t.step("plugin settings fill in fields YAML omits", async () => {
    // story YAML sets only recentChapters; plugin settings sets enabled=false.
    // Per precedence: chosen YAML (story) wins for fields it specifies; plugin settings fills the gap.
    await writePluginSettings(tmpDir, JSON.stringify({ recentChapters: 999, enabled: false }));
    const seriesDir = join(tmpDir, "yaml-omits-fields");
    const storyDir = join(seriesDir, "the-story");
    await Deno.mkdir(storyDir, { recursive: true });
    await Deno.writeTextFile(
      join(storyDir, "compaction-config.yaml"),
      "recentChapters: 5\n",
    );
    const config = await loadCompactionConfig(storyDir, "yaml-omits-fields", tmpDir);
    assertEquals(config.recentChapters, 5); // from YAML
    assertEquals(config.enabled, false); // from plugin settings (YAML didn't set it)
    await Deno.remove(join(tmpDir, "_plugins"), { recursive: true });
  });

  await t.step("story YAML present → series YAML completely ignored", async () => {
    // Critical: story XOR series. Even if series YAML sets enabled:false and story YAML omits enabled,
    // the effective `enabled` MUST NOT come from series YAML (it must fall through to plugin settings or default).
    const seriesDir = join(tmpDir, "xor-series");
    const storyDir = join(seriesDir, "xor-story");
    await Deno.mkdir(storyDir, { recursive: true });
    await Deno.writeTextFile(
      join(seriesDir, "compaction-config.yaml"),
      "enabled: false\nrecentChapters: 99\n",
    );
    await Deno.writeTextFile(
      join(storyDir, "compaction-config.yaml"),
      "recentChapters: 5\n",
    );
    const config = await loadCompactionConfig(storyDir, "xor-series", tmpDir);
    assertEquals(config.recentChapters, 5); // story wins
    assertEquals(config.enabled, true); // default — series YAML must NOT contribute
  });

  await t.step("disabled via plugin settings (no YAML)", async () => {
    await writePluginSettings(tmpDir, JSON.stringify({ enabled: false }));
    const storyDir = join(tmpDir, "ui-disable-series", "ui-disable-story");
    const config = await loadCompactionConfig(storyDir, "ui-disable-series", tmpDir);
    assertEquals(config.enabled, false);
    assertEquals(config.recentChapters, 3); // default
    await Deno.remove(join(tmpDir, "_plugins"), { recursive: true });
  });

  await t.step("malformed JSON in plugin settings → empty layer + warn", async () => {
    await writePluginSettings(tmpDir, "not-json{{");
    let warned = 0;
    const storyDir = join(tmpDir, "bad-json-series", "bad-json-story");
    const config = await loadCompactionConfig(storyDir, "bad-json-series", tmpDir, {
      onWarn: () => warned++,
    });
    assertEquals(config.recentChapters, 3);
    assertEquals(config.enabled, true);
    assertEquals(warned, 1);
    await Deno.remove(join(tmpDir, "_plugins"), { recursive: true });
  });

  await t.step("out-of-range recentChapters in config.json sanitised at read time", async () => {
    await writePluginSettings(tmpDir, JSON.stringify({ recentChapters: 0, enabled: true }));
    const storyDir = join(tmpDir, "sanitise-series", "sanitise-story");
    const config = await loadCompactionConfig(storyDir, "sanitise-series", tmpDir);
    assertEquals(config.recentChapters, 3); // dropped → default
    assertEquals(config.enabled, true);
    await Deno.remove(join(tmpDir, "_plugins"), { recursive: true });
  });

  await t.step("fractional recentChapters in config.json sanitised at read time", async () => {
    await writePluginSettings(tmpDir, JSON.stringify({ recentChapters: 0.5, enabled: true }));
    const storyDir = join(tmpDir, "frac-series", "frac-story");
    const config = await loadCompactionConfig(storyDir, "frac-series", tmpDir);
    assertEquals(config.recentChapters, 3); // dropped (non-integer) → default
    assertEquals(config.enabled, true);
    await Deno.remove(join(tmpDir, "_plugins"), { recursive: true });
  });

  await t.step("missing settings file is silent (no warn)", async () => {
    let warned = 0;
    const storyDir = join(tmpDir, "missing-series", "missing-story");
    const config = await loadCompactionConfig(storyDir, "missing-series", tmpDir, {
      onWarn: () => warned++,
    });
    assertEquals(config.recentChapters, 3);
    assertEquals(config.enabled, true);
    assertEquals(warned, 0);
  });

  // Cleanup
  await Deno.remove(tmpDir, { recursive: true });
});

Deno.test("settingsSchema defaults match DEFAULTS constant", async () => {
  const manifestUrl = new URL("../../../plugins/context-compaction/plugin.json", import.meta.url);
  const manifest = JSON.parse(await Deno.readTextFile(manifestUrl)) as {
    settingsSchema: { properties: { recentChapters: { default: unknown }; enabled: { default: unknown } } };
  };
  assertEquals(manifest.settingsSchema.properties.recentChapters.default, DEFAULTS.recentChapters);
  assertEquals(manifest.settingsSchema.properties.enabled.default, DEFAULTS.enabled);
});
