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
import { createStoryEngine, resolveTargetChapterNumber } from "../../../writer/lib/story.ts";
import type { ChapterEntry, RenderOptions, RenderResult } from "../../../writer/types.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import type { HookDispatcher } from "../../../writer/lib/hooks.ts";

Deno.test("resolveTargetChapterNumber", async (t) => {
  await t.step("empty directory returns 1", () => {
    assertEquals(resolveTargetChapterNumber([], []), 1);
  });

  await t.step("two non-empty chapters returns max + 1 (3)", () => {
    const files = ["001.md", "002.md"];
    const chapters: ChapterEntry[] = [
      { number: 1, content: "alpha" },
      { number: 2, content: "beta" },
    ];
    assertEquals(resolveTargetChapterNumber(files, chapters), 3);
  });

  await t.step("trailing empty file is reused (returns 2)", () => {
    const files = ["001.md", "002.md"];
    const chapters: ChapterEntry[] = [
      { number: 1, content: "alpha" },
      { number: 2, content: "" },
    ];
    assertEquals(resolveTargetChapterNumber(files, chapters), 2);
  });

  await t.step("single empty file returns 1", () => {
    const files = ["001.md"];
    const chapters: ChapterEntry[] = [{ number: 1, content: "   \n" }];
    assertEquals(resolveTargetChapterNumber(files, chapters), 1);
  });
});

Deno.test("buildPromptFromStory: chapterCount reflects true on-disk total even with >200 chapters", async () => {
  const storyDir = await Deno.makeTempDir({ prefix: "heartreverie-story-test-" });
  try {
    const TOTAL = 250;
    for (let i = 1; i <= TOTAL; i++) {
      const name = String(i).padStart(3, "0") + ".md";
      await Deno.writeTextFile(`${storyDir}/${name}`, `chapter ${i} content`);
    }

    const pluginManagerStub = {
      getStripTagPatterns: () => null,
      getPromptVariables: () => Promise.resolve({}),
    } as unknown as PluginManager;

    const hookDispatcherStub = {
      dispatch: (_stage: string, ctx: Record<string, unknown>) => Promise.resolve(ctx),
    } as unknown as HookDispatcher;

    let captured: RenderOptions | undefined;
    const renderSystemPrompt = (
      _series: string,
      _name?: string,
      options?: RenderOptions,
    ): Promise<RenderResult> => {
      captured = options;
      return Promise.resolve({ content: "rendered", error: null } as RenderResult);
    };

    const engine = createStoryEngine(
      pluginManagerStub,
      (p: string) => p,
      renderSystemPrompt,
      hookDispatcherStub,
    );

    const result = await engine.buildPromptFromStory(
      "series-a",
      "story-a",
      storyDir,
      "user input",
    );

    assertEquals(captured?.chapterCount, TOTAL);
    // Prompt history still truncated to last 200 for performance
    assertEquals(result.chapterFiles.length, 200);
    assertEquals(result.chapterFiles[0], "051.md");
    assertEquals(result.chapterFiles[result.chapterFiles.length - 1], "250.md");
  } finally {
    await Deno.remove(storyDir, { recursive: true });
  }
});
