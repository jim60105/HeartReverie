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
import { loadCompactionConfig } from "../../../plugins/context-compaction/config.ts";
import { join } from "@std/path";

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
      join(seriesDir, "compaction-config.yml"),
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
      join(seriesDir, "compaction-config.yml"),
      "recentChapters: 5\nenabled: true\n",
    );
    await Deno.writeTextFile(
      join(storyDir, "compaction-config.yml"),
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
      join(seriesDir, "compaction-config.yml"),
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
      join(seriesDir, "compaction-config.yml"),
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
