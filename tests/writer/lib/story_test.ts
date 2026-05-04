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

import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  ContinuePromptError,
  createStoryEngine,
  parseChapterForContinue,
  resolveTargetChapterNumber,
} from "../../../writer/lib/story.ts";
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
      return Promise.resolve({ messages: [{ role: "user", content: "rendered" }], error: null } as RenderResult);
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

Deno.test("buildPromptFromStory: _config.json alongside chapters is ignored in listing", async () => {
  const storyDir = await Deno.makeTempDir({ prefix: "heartreverie-config-listing-test-" });
  try {
    await Deno.writeTextFile(`${storyDir}/001.md`, "chapter 1");
    await Deno.writeTextFile(`${storyDir}/002.md`, "chapter 2");
    await Deno.writeTextFile(`${storyDir}/_config.json`, '{"temperature":0.9}');
    await Deno.writeTextFile(`${storyDir}/README.md`, "not a chapter");

    const pluginManagerStub = {
      getStripTagPatterns: () => null,
      getPromptVariables: () => Promise.resolve({}),
    } as unknown as PluginManager;
    const hookDispatcherStub = {
      dispatch: (_s: string, ctx: Record<string, unknown>) => Promise.resolve(ctx),
    } as unknown as HookDispatcher;
    const renderSystemPrompt = (): Promise<RenderResult> =>
      Promise.resolve({ messages: [{ role: "user", content: "rendered" }], error: null } as RenderResult);

    const engine = createStoryEngine(
      pluginManagerStub,
      (p: string) => p,
      renderSystemPrompt,
      hookDispatcherStub,
    );
    const result = await engine.buildPromptFromStory("s", "n", storyDir, "msg");

    assertEquals(result.chapterFiles, ["001.md", "002.md"]);
  } finally {
    await Deno.remove(storyDir, { recursive: true });
  }
});

// ───────────────────────────────────────────────────────────────────
// parseChapterForContinue
// ───────────────────────────────────────────────────────────────────

Deno.test("parseChapterForContinue", async (t) => {
  // Identity stripPromptTags — no plugin patterns here, so the helper just
  // trims like `createStoryEngine.stripPromptTags()` does when there are no
  // strip patterns.
  const stripIdentity = (s: string): string => s.trim();

  await t.step("only <user_message> with no surrounding prose", () => {
    const r = parseChapterForContinue("<user_message>hello</user_message>", stripIdentity);
    assertEquals(r.userMessageText, "hello");
    assertEquals(r.assistantPrefill, "");
  });

  await t.step("<user_message> followed by prose body", () => {
    const r = parseChapterForContinue(
      "<user_message>X</user_message>\n\nbody text",
      stripIdentity,
    );
    assertEquals(r.userMessageText, "X");
    assertEquals(r.assistantPrefill, "body text");
  });

  await t.step("empty chapter yields both fields empty", () => {
    const r = parseChapterForContinue("", stripIdentity);
    assertEquals(r.userMessageText, "");
    assertEquals(r.assistantPrefill, "");
  });

  await t.step("no <user_message> tag → whole content becomes prefill", () => {
    const r = parseChapterForContinue("just some prose without the tag", stripIdentity);
    assertEquals(r.userMessageText, "");
    assertEquals(r.assistantPrefill, "just some prose without the tag");
  });

  await t.step("case-insensitive open and close tags", () => {
    const r = parseChapterForContinue(
      "<USER_MESSAGE>Hi</User_Message>\nbody",
      stripIdentity,
    );
    assertEquals(r.userMessageText, "Hi");
    assertEquals(r.assistantPrefill, "body");
  });

  await t.step("prefill containing <think>…</think> is preserved by identity strip", () => {
    // With an identity stripPromptTags (no plugin strip patterns) the
    // <think>…</think> block remains verbatim in the prefill — only trimming
    // is applied.
    const raw = "<user_message>q</user_message>\n<think>inner</think>\n\nafter";
    const r = parseChapterForContinue(raw, stripIdentity);
    assertEquals(r.userMessageText, "q");
    assertEquals(r.assistantPrefill, "<think>inner</think>\n\nafter");
  });

  await t.step("plugin strip pattern that removes <think>…</think> is honoured", () => {
    // When the caller's stripPromptTags removes the <think> block, that
    // removal flows through to the prefill exactly once (as documented).
    const stripThink = (s: string): string =>
      s.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    const raw = "<user_message>q</user_message>\n<think>inner</think>\n\nafter";
    const r = parseChapterForContinue(raw, stripThink);
    assertEquals(r.userMessageText, "q");
    assertEquals(r.assistantPrefill, "after");
  });

  await t.step("only first <user_message> block is extracted", () => {
    // Subsequent blocks remain in the remainder; with an identity strip they
    // stay verbatim so the test pins the extract-first behaviour.
    const raw = "<user_message>first</user_message>\n<user_message>second</user_message>\ntail";
    const r = parseChapterForContinue(raw, stripIdentity);
    assertEquals(r.userMessageText, "first");
    assertStringIncludes(r.assistantPrefill, "<user_message>second</user_message>");
    assertStringIncludes(r.assistantPrefill, "tail");
  });
});

// ───────────────────────────────────────────────────────────────────
// buildContinuePromptFromStory
// ───────────────────────────────────────────────────────────────────

function makeContinueDeps() {
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
    return Promise.resolve({
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: options?.userInput ?? "" },
      ],
      error: null,
    } as RenderResult);
  };
  return {
    pluginManagerStub,
    hookDispatcherStub,
    renderSystemPrompt,
    getCaptured: () => captured,
  };
}

Deno.test("buildContinuePromptFromStory: throws no-chapter when story directory has no chapters", async () => {
  const storyDir = await Deno.makeTempDir({ prefix: "hr_test_continue_no_chap_" });
  try {
    const { pluginManagerStub, hookDispatcherStub, renderSystemPrompt } = makeContinueDeps();
    const engine = createStoryEngine(
      pluginManagerStub,
      (p: string) => p,
      renderSystemPrompt,
      hookDispatcherStub,
    );
    const err = await assertRejects(
      () => engine.buildContinuePromptFromStory("s", "n", storyDir),
      ContinuePromptError,
    );
    assertEquals(err.code, "no-chapter");
    assertEquals(err.httpStatus, 400);
  } finally {
    await Deno.remove(storyDir, { recursive: true });
  }
});

Deno.test("buildContinuePromptFromStory: throws no-content when latest chapter is empty and prefill empty", async () => {
  const storyDir = await Deno.makeTempDir({ prefix: "hr_test_continue_empty_" });
  try {
    await Deno.writeTextFile(`${storyDir}/001.md`, "");
    const { pluginManagerStub, hookDispatcherStub, renderSystemPrompt } = makeContinueDeps();
    const engine = createStoryEngine(
      pluginManagerStub,
      (p: string) => p,
      renderSystemPrompt,
      hookDispatcherStub,
    );
    const err = await assertRejects(
      () => engine.buildContinuePromptFromStory("s", "n", storyDir),
      ContinuePromptError,
    );
    assertEquals(err.code, "no-content");
    assertEquals(err.httpStatus, 400);
  } finally {
    await Deno.remove(storyDir, { recursive: true });
  }
});

Deno.test("buildContinuePromptFromStory: appends trailing assistant prefill and uses latest chapter number (NOT +1)", async () => {
  const storyDir = await Deno.makeTempDir({ prefix: "hr_test_continue_ok_" });
  try {
    const ch1 = "<user_message>hello</user_message>\n\nbody so far";
    await Deno.writeTextFile(`${storyDir}/001.md`, ch1);
    const { pluginManagerStub, hookDispatcherStub, renderSystemPrompt, getCaptured } = makeContinueDeps();
    const engine = createStoryEngine(
      pluginManagerStub,
      (p: string) => p,
      renderSystemPrompt,
      hookDispatcherStub,
    );
    const r = await engine.buildContinuePromptFromStory("s", "n", storyDir);

    assertEquals(r.targetChapterNumber, 1, "must reuse latest chapter number, not increment");
    assertEquals(r.existingContent, ch1, "existingContent must equal on-disk bytes verbatim");
    assertEquals(r.userMessageText, "hello");
    assertEquals(r.assistantPrefill, "body so far");

    const last = r.messages[r.messages.length - 1]!;
    assertEquals(last.role, "assistant");
    assertEquals(last.content, "body so far");

    // Render received userInput = parsed user_message text. With only the
    // target chapter present (no priors), `isFirstRound` is true because
    // `previousContext` is empty — mirrors `buildPromptFromStory` semantics
    // and prevents custom system.md templates from emitting an empty
    // assistant message gated on `!isFirstRound`.
    const cap = getCaptured()!;
    assertEquals(cap.userInput, "hello");
    assertEquals(cap.isFirstRound, true);
    assertEquals(cap.chapterNumber, 1);
  } finally {
    await Deno.remove(storyDir, { recursive: true });
  }
});

Deno.test("buildContinuePromptFromStory: omits trailing assistant message when prefill empty", async () => {
  const storyDir = await Deno.makeTempDir({ prefix: "hr_test_continue_no_prefill_" });
  try {
    await Deno.writeTextFile(`${storyDir}/001.md`, "<user_message>only msg</user_message>");
    const { pluginManagerStub, hookDispatcherStub, renderSystemPrompt } = makeContinueDeps();
    const engine = createStoryEngine(
      pluginManagerStub,
      (p: string) => p,
      renderSystemPrompt,
      hookDispatcherStub,
    );
    const r = await engine.buildContinuePromptFromStory("s", "n", storyDir);

    const last = r.messages[r.messages.length - 1]!;
    assertEquals(last.role, "user");
    assertEquals(last.content, "only msg");
    // No empty-content assistant tail appended.
    for (const m of r.messages) {
      if (m.role === "assistant") {
        assertEquals(m.content.trim().length > 0, true);
      }
    }
  } finally {
    await Deno.remove(storyDir, { recursive: true });
  }
});

Deno.test("buildContinuePromptFromStory: previousContext built from chapters 1..n-1 (excludes target)", async () => {
  const storyDir = await Deno.makeTempDir({ prefix: "hr_test_continue_prev_" });
  try {
    await Deno.writeTextFile(`${storyDir}/001.md`, "first chapter prose");
    await Deno.writeTextFile(`${storyDir}/002.md`, "second chapter prose");
    await Deno.writeTextFile(
      `${storyDir}/003.md`,
      "<user_message>q3</user_message>\n\npartial three",
    );
    const { pluginManagerStub, hookDispatcherStub, renderSystemPrompt, getCaptured } = makeContinueDeps();
    const engine = createStoryEngine(
      pluginManagerStub,
      (p: string) => p,
      renderSystemPrompt,
      hookDispatcherStub,
    );
    const r = await engine.buildContinuePromptFromStory("s", "n", storyDir);

    assertEquals(r.targetChapterNumber, 3);
    const cap = getCaptured()!;
    // previousContext excludes chapter 3 (the one being continued).
    assertEquals(cap.previousContext, ["first chapter prose", "second chapter prose"]);
    // previousContent reflects the chapter immediately preceding the target.
    assertEquals(cap.previousContent, "second chapter prose");
    // Non-empty priors → isFirstRound=false (so templates render the
    // previous-context assistant block).
    assertEquals(cap.isFirstRound, false);
  } finally {
    await Deno.remove(storyDir, { recursive: true });
  }
});

Deno.test("buildContinuePromptFromStory: isFirstRound=true when no priors exist (regression: avoids multi-message:empty-message)", async () => {
  const storyDir = await Deno.makeTempDir({ prefix: "hr_test_continue_first_round_" });
  try {
    // Single chapter case: continuing chapter 1 has no prior chapters at all,
    // so previousContext is []. Without isFirstRound=true a custom system.md
    // gated on !isFirstRound would emit an empty assistant message and
    // assertNoEmptyMessages would throw `multi-message:empty-message`.
    await Deno.writeTextFile(
      `${storyDir}/001.md`,
      "<user_message>continue please</user_message>\n\nstart of one",
    );
    const { pluginManagerStub, hookDispatcherStub, renderSystemPrompt, getCaptured } = makeContinueDeps();
    const engine = createStoryEngine(
      pluginManagerStub,
      (p: string) => p,
      renderSystemPrompt,
      hookDispatcherStub,
    );
    const r = await engine.buildContinuePromptFromStory("s", "n", storyDir);

    assertEquals(r.targetChapterNumber, 1);
    const cap = getCaptured()!;
    assertEquals(cap.previousContext, []);
    assertEquals(cap.isFirstRound, true);
  } finally {
    await Deno.remove(storyDir, { recursive: true });
  }
});
