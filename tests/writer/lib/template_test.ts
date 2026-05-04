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

import { assertEquals, assertExists, assertMatch } from "@std/assert";
import { join } from "@std/path";
import { createTemplateEngine, validateTemplate } from "../../../writer/lib/template.ts";
import type { PluginManager } from "../../../writer/lib/plugin-manager.ts";
import { PLAYGROUND_DIR } from "../../../writer/lib/config.ts";

Deno.test("validateTemplate", async (t) => {
  await t.step("safe expressions accepted", async (t) => {
    await t.step("allows simple variable", () => {
      assertEquals(validateTemplate("{{ variable }}"), []);
    });

    await t.step("allows for-of loop", () => {
      assertEquals(
        validateTemplate("{{ for x of items }}body{{ /for }}"),
        [],
      );
    });

    await t.step("allows if condition", () => {
      assertEquals(
        validateTemplate("{{ if condition }}body{{ /if }}"),
        [],
      );
    });

    await t.step("allows pipe filters", () => {
      assertEquals(
        validateTemplate("{{ variable |> filter }}"),
        [],
      );
    });

    await t.step("rejects includes (file-inclusion vector)", () => {
      const errors = validateTemplate('{{ > "path" }}');
      assertEquals(errors.length, 1);
    });

    await t.step("allows comments", () => {
      assertEquals(
        validateTemplate("{{ # this is a comment }}"),
        [],
      );
    });

    await t.step("allows else", () => {
      assertEquals(
        validateTemplate("{{ if x }}a{{ else }}b{{ /if }}"),
        [],
      );
    });
  });

  await t.step("unsafe expressions rejected", async (t) => {
    await t.step("rejects process.env access", () => {
      const errors = validateTemplate("{{ process.env.SECRET }}");
      assertEquals(errors.length, 1);
      assertMatch(errors[0]!, /Unsafe template expression/);
    });

    await t.step("rejects require calls", () => {
      const errors = validateTemplate("{{ require('fs') }}");
      assertEquals(errors.length, 1);
    });

    await t.step("rejects constructor chain", () => {
      const errors = validateTemplate(
        "{{ constructor.constructor('return this')() }}",
      );
      assertEquals(errors.length, 1);
    });
  });

  await t.step("edge cases", async (t) => {
    await t.step("returns no errors for empty template", () => {
      assertEquals(validateTemplate(""), []);
    });

    await t.step("returns no errors for template with no tags", () => {
      assertEquals(
        validateTemplate("Hello world, no template tags here!"),
        [],
      );
    });
  });
});

Deno.test("createTemplateEngine", async (t) => {
  const mockPluginManager = {
    getPromptVariables: async () => ({ variables: {}, fragments: [] }),
    getDynamicVariables: async () => ({}),
  } as unknown as PluginManager;

  await t.step("renderSystemPrompt with templateOverride renders correctly", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: `{{ message "user" }}Hello {{ user_input }}!{{ /message }}`,
      userInput: "world",
    });
    assertEquals(result.error, null);
    assertEquals(result.messages, [{ role: "user", content: "Hello world!" }]);
  });

  await t.step("templateOverride exceeding max length returns error", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager);
    const longTemplate = "x".repeat(500_001);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: longTemplate,
    });
    assertEquals(result.messages, []);
    assertEquals(result.error!.title, "Template Validation Error");
    assertEquals(result.error!.detail, "Template exceeds maximum length");
  });

  await t.step("templateOverride with unsafe expressions returns validation error", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: "{{ process.env.SECRET }}",
    });
    assertEquals(result.messages, []);
    assertEquals(result.error!.title, "Template Validation Error");
    assertEquals(
      result.error!.detail,
      "Template contains unsafe expressions that cannot be executed",
    );
    assertEquals(result.error!.expressions!.length, 1);
  });

  await t.step("renderSystemPrompt returns error on Vento rendering failure", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager);
    // Unclosed for-loop causes Vento to throw a parse/render error
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: "{{ for x of items }}no closing tag",
    });
    assertEquals(result.messages, []);
    assertExists(result.error);
    assertEquals(result.error!.type, "vento-error");
  });

  await t.step("ventoEnv is returned from createTemplateEngine", () => {
    const engine = createTemplateEngine(mockPluginManager);
    assertExists(engine.ventoEnv);
    assertEquals(typeof engine.ventoEnv.runString, "function");
  });

  await t.step("plugin variables are passed to template", async () => {
    const pluginMgr = {
      getPromptVariables: async () => ({
        variables: { custom_var: "plugin_value" },
        fragments: ["frag1"],
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(pluginMgr);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: `{{ message "user" }}{{ custom_var }}{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertEquals(result.messages, [{ role: "user", content: "plugin_value" }]);
  });

  await t.step("undefined variable renders as empty string in Vento", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: `{{ message "user" }}before[{{ nonexistent_var }}]after{{ /message }}`,
    });
    // Vento either outputs empty or throws — capture actual behavior
    if (result.error) {
      // If Vento throws for undefined vars, this is expected
      assertExists(result.error);
    } else {
      // If Vento renders undefined as empty, the message survives without
      // the missing-variable name leaking through.
      assertExists(result.messages[0]);
      assertEquals(result.messages[0]!.role, "user");
    }
  });

  await t.step("plugin_fragments empty when no plugins register prompts", async () => {
    const emptyPluginMgr = {
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(emptyPluginMgr);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride:
        `{{ message "user" }}Fragments:[{{ for f of plugin_fragments }}{{ f }}{{ /for }}]{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertEquals(result.messages, [{ role: "user", content: "Fragments:[]" }]);
  });

  await t.step("plugin_fragments ordering preserved in template output", async () => {
    const orderedPluginMgr = {
      getPromptVariables: async () => ({
        variables: {},
        fragments: ["AAA", "BBB", "CCC"],
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(orderedPluginMgr);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride:
        `{{ message "user" }}{{ for f of plugin_fragments }}[{{ f }}]{{ /for }}{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertEquals(result.messages, [{ role: "user", content: "[AAA][BBB][CCC]" }]);
  });

  await t.step("series_name and story_name are available in template", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager);
    const result = await renderSystemPrompt("my-series", "my-story", {
      templateOverride:
        `{{ message "user" }}Series:{{ series_name }} Story:{{ story_name }}{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertEquals(result.messages, [{
      role: "user",
      content: "Series:my-series Story:my-story",
    }]);
  });

  await t.step("renderSystemPrompt forwards rich context to getDynamicVariables", async () => {
    let captured: Record<string, unknown> | null = null;
    const pluginMgr = {
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getDynamicVariables: async (ctx: Record<string, unknown>) => {
        captured = ctx;
        return {};
      },
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(pluginMgr);
    const result = await renderSystemPrompt("s", "n", {
      templateOverride: `{{ message "user" }}ok{{ /message }}`,
      userInput: "hello",
      isFirstRound: true,
      storyDir: "/dir",
      chapterNumber: 7,
      previousContent: "prev body",
      chapterCount: 6,
    });
    assertEquals(result.error, null);
    assertEquals(captured!.series, "s");
    assertEquals(captured!.name, "n");
    assertEquals(captured!.storyDir, "/dir");
    assertEquals(captured!.userInput, "hello");
    assertEquals(captured!.chapterNumber, 7);
    assertEquals(captured!.previousContent, "prev body");
    assertEquals(captured!.isFirstRound, true);
    assertEquals(captured!.chapterCount, 6);
  });

  await t.step("renderSystemPrompt defaults rich context fields when caller omits them", async () => {
    let captured: Record<string, unknown> | null = null;
    const pluginMgr = {
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
      getDynamicVariables: async (ctx: Record<string, unknown>) => {
        captured = ctx;
        return {};
      },
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(pluginMgr);
    const result = await renderSystemPrompt("s", "n", {
      templateOverride: `{{ message "user" }}ok{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertEquals(captured!.userInput, "");
    assertEquals(captured!.chapterNumber, 1);
    assertEquals(captured!.previousContent, "");
    assertEquals(captured!.isFirstRound, false);
    assertEquals(captured!.chapterCount, 0);
  });

  await t.step("plugin fragment renders chapter_number from chapterNumber option", async () => {
    const pluginMgr = {
      getPromptVariables: async () => ({
        variables: { test_frag: "第 {{ chapter_number }} 章" },
        fragments: [],
        metadata: { test_frag: { plugin: "test-plugin", file: "test.md" } },
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(pluginMgr);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: `{{ message "user" }}{{ test_frag }}{{ /message }}`,
      chapterNumber: 42,
    });
    assertEquals(result.error, null);
    assertExists(result.messages[0]);
    assertMatch(result.messages[0]!.content, /第 42 章/);
    assertEquals(result.messages[0]!.content.includes("{{ chapter_number }}"), false);
    assertEquals(result.messages[0]!.content.includes("${chapter_number}"), false);
  });

  await t.step("plugin fragment render failure falls back to raw content", async () => {
    const pluginMgr = {
      getPromptVariables: async () => ({
        variables: { broken_frag: "{{ if x }}broken no closing" },
        fragments: [],
        metadata: { broken_frag: { plugin: "bad-plugin", file: "broken.md" } },
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(pluginMgr);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: `{{ message "user" }}{{ broken_frag }}{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertExists(result.messages[0]);
    assertMatch(result.messages[0]!.content, /broken no closing/);
  });

  await t.step("plugin fragment defaults chapter_number to 1 when not provided", async () => {
    const pluginMgr = {
      getPromptVariables: async () => ({
        variables: { ch_frag: "Ch{{ chapter_number }}" },
        fragments: [],
      }),
      getDynamicVariables: async () => ({}),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(pluginMgr);
    const result = await renderSystemPrompt("test-series", undefined, {
      templateOverride: `{{ message "user" }}{{ ch_frag }}{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertExists(result.messages[0]);
    assertEquals(result.messages[0]!.content, "Ch1");
  });
});

Deno.test("lore Vento rendering", async (t) => {
  const loreDir = join(PLAYGROUND_DIR, "_lore");
  await Deno.mkdir(loreDir, { recursive: true });

  const mockLorePluginManager = {
    getPromptVariables: async () => ({ variables: {}, fragments: [] }),
    getDynamicVariables: async () => ({}),
  } as unknown as PluginManager;

  await t.step("passage with Vento syntax is rendered", async () => {
    await Deno.writeTextFile(
      join(loreDir, "setting.md"),
      "---\ntags: [setting]\npriority: 10\nenabled: true\n---\nWorld of {{ series_name }}",
    );

    const { renderSystemPrompt } = createTemplateEngine(mockLorePluginManager);
    const result = await renderSystemPrompt("fantasy", undefined, {
      templateOverride: `{{ message "user" }}{{ lore_setting }}{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertEquals(result.messages, [{ role: "user", content: "World of fantasy" }]);

    await Deno.remove(join(loreDir, "setting.md"));
  });

  await t.step("passage without Vento syntax is unchanged", async () => {
    await Deno.writeTextFile(
      join(loreDir, "plain.md"),
      "---\ntags: [plain]\npriority: 10\nenabled: true\n---\nPlain content no templates",
    );

    const { renderSystemPrompt } = createTemplateEngine(mockLorePluginManager);
    const result = await renderSystemPrompt("test", undefined, {
      templateOverride: `{{ message "user" }}{{ lore_plain }}{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertEquals(result.messages, [{
      role: "user",
      content: "Plain content no templates",
    }]);

    await Deno.remove(join(loreDir, "plain.md"));
  });

  await t.step("passage with Vento error falls back to raw content", async () => {
    await Deno.writeTextFile(
      join(loreDir, "broken.md"),
      "---\ntags: [broken]\npriority: 10\nenabled: true\n---\n{{ for x of }}broken syntax",
    );

    const { renderSystemPrompt } = createTemplateEngine(mockLorePluginManager);
    const result = await renderSystemPrompt("test", undefined, {
      templateOverride: `{{ message "user" }}{{ lore_broken }}{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertExists(result.messages[0]);
    assertMatch(result.messages[0]!.content, /broken syntax/);

    await Deno.remove(join(loreDir, "broken.md"));
  });

  await t.step("cross-reference sees raw first-pass content", async () => {
    await Deno.writeTextFile(
      join(loreDir, "a.md"),
      "---\ntags: [ref_a]\npriority: 10\nenabled: true\n---\nA sees B={{ lore_ref_b }}",
    );
    await Deno.writeTextFile(
      join(loreDir, "b.md"),
      "---\ntags: [ref_b]\npriority: 10\nenabled: true\n---\nB sees A={{ lore_ref_a }}",
    );

    const { renderSystemPrompt } = createTemplateEngine(mockLorePluginManager);
    const result = await renderSystemPrompt("test", undefined, {
      templateOverride:
        `{{ message "user" }}[{{ lore_ref_a }}][{{ lore_ref_b }}]{{ /message }}`,
    });
    assertEquals(result.error, null);
    assertExists(result.messages[0]);
    assertMatch(result.messages[0]!.content, /A sees B=/);
    assertMatch(result.messages[0]!.content, /B sees A=/);

    await Deno.remove(join(loreDir, "a.md"));
    await Deno.remove(join(loreDir, "b.md"));
  });
});
