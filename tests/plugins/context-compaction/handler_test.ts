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

import { assertEquals, assert } from "@std/assert";
import { HookDispatcher } from "../../../writer/lib/hooks.ts";
import { createLogger } from "../../../writer/lib/logger.ts";
import { register } from "../../../plugins/context-compaction/handler.ts";

const testLogger = createLogger("plugin", { baseData: { plugin: "context-compaction" } });

Deno.test("context-compaction prompt-assembly hook", async (t) => {
  await t.step("modifies previousContext via compaction", async () => {
    const hd = new HookDispatcher();
    register({ hooks: hd, logger: testLogger });

    // Create a temp playground structure
    const tmpDir = await Deno.makeTempDir({ prefix: "hook-test-" });
    const seriesDir = `${tmpDir}/test-series`;
    const storyDir = `${seriesDir}/test-story`;
    await Deno.mkdir(storyDir, { recursive: true });

    const previousContext = [
      "ch1 stripped", "ch2 stripped", "ch3 stripped",
      "ch4 stripped", "ch5 stripped",
    ];
    const rawChapters = [
      "ch1 raw <chapter_summary>第 1 章：摘要 A</chapter_summary>",
      "ch2 raw <chapter_summary>第 2 章：摘要 B</chapter_summary>",
      "ch3 stripped",
      "ch4 stripped",
      "ch5 stripped",
    ];

    const context: Record<string, unknown> = {
      previousContext,
      rawChapters,
      storyDir,
      series: "test-series",
      name: "test-story",
    };

    await hd.dispatch("prompt-assembly", context);

    const modified = context.previousContext as string[];
    assertEquals(modified.length, 4); // 1 story_summary + 3 L2
    assert((modified[0] as string).startsWith("<story_summary>"));
    assert((modified[0] as string).includes("第 1 章：摘要 A"));
    assert((modified[0] as string).includes("第 2 章：摘要 B"));

    await Deno.remove(tmpDir, { recursive: true });
  });

  await t.step("passes rawChapters correctly", async () => {
    const hd = new HookDispatcher();
    register({ hooks: hd, logger: testLogger });

    const tmpDir = await Deno.makeTempDir({ prefix: "hook-test-raw-" });
    const storyDir = `${tmpDir}/series/story`;
    await Deno.mkdir(storyDir, { recursive: true });

    const rawChapters = ["ch1 raw", "ch2 raw"];
    const previousContext = ["ch1 stripped", "ch2 stripped"];

    const context: Record<string, unknown> = {
      previousContext,
      rawChapters,
      storyDir,
      series: "series",
      name: "story",
    };

    await hd.dispatch("prompt-assembly", context);

    // With only 2 chapters and default window of 3, no compaction should happen
    assertEquals((context.previousContext as string[]).length, 2);
    assertEquals((context.previousContext as string[])[0], "ch1 stripped");

    await Deno.remove(tmpDir, { recursive: true });
  });

  await t.step("does nothing when disabled", async () => {
    const hd = new HookDispatcher();
    register({ hooks: hd, logger: testLogger });

    const tmpDir = await Deno.makeTempDir({ prefix: "hook-test-disabled-" });
    const seriesDir = `${tmpDir}/disabled-series`;
    const storyDir = `${seriesDir}/disabled-story`;
    await Deno.mkdir(storyDir, { recursive: true });

    // Write disabled config
    await Deno.writeTextFile(
      `${storyDir}/compaction-config.yml`,
      "enabled: false\n",
    );

    const previousContext = [
      "ch1", "ch2", "ch3", "ch4", "ch5",
    ];
    const rawChapters = [
      "ch1 <chapter_summary>摘要</chapter_summary>",
      "ch2 <chapter_summary>摘要</chapter_summary>",
      "ch3", "ch4", "ch5",
    ];

    const context: Record<string, unknown> = {
      previousContext,
      rawChapters,
      storyDir,
      series: "disabled-series",
      name: "disabled-story",
    };

    await hd.dispatch("prompt-assembly", context);

    // Should be unchanged
    assertEquals((context.previousContext as string[]).length, 5);
    assertEquals((context.previousContext as string[])[0], "ch1");

    await Deno.remove(tmpDir, { recursive: true });
  });

  await t.step("does nothing with empty previousContext", async () => {
    const hd = new HookDispatcher();
    register({ hooks: hd, logger: testLogger });

    const context: Record<string, unknown> = {
      previousContext: [],
      rawChapters: [],
      storyDir: "/nonexistent",
      series: "s",
      name: "n",
    };

    await hd.dispatch("prompt-assembly", context);
    assertEquals((context.previousContext as string[]).length, 0);
  });
});
