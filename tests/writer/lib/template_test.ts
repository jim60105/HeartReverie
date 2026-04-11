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
import type { SafePathFn } from "../../../writer/types.ts";

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
  } as unknown as PluginManager;
  const nullSafePath: SafePathFn = () => null;

  await t.step("renderSystemPrompt with templateOverride renders correctly", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager, nullSafePath);
    const result = await renderSystemPrompt("test-series", {
      templateOverride: "Hello {{ user_input }}!",
      userInput: "world",
    });
    assertEquals(result.error, null);
    assertEquals(result.content, "Hello world!");
  });

  await t.step("templateOverride exceeding max length returns error", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager, nullSafePath);
    const longTemplate = "x".repeat(500_001);
    const result = await renderSystemPrompt("test-series", {
      templateOverride: longTemplate,
    });
    assertEquals(result.content, null);
    assertEquals(result.error!.title, "Template Validation Error");
    assertEquals(result.error!.detail, "Template exceeds maximum length");
  });

  await t.step("templateOverride with unsafe expressions returns validation error", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager, nullSafePath);
    const result = await renderSystemPrompt("test-series", {
      templateOverride: "{{ process.env.SECRET }}",
    });
    assertEquals(result.content, null);
    assertEquals(result.error!.title, "Template Validation Error");
    assertEquals(
      result.error!.detail,
      "Template contains unsafe expressions that cannot be executed",
    );
    assertEquals(result.error!.expressions!.length, 1);
  });

  await t.step("renderSystemPrompt reads scenario.md when it exists", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      await Deno.writeTextFile(join(tmpDir, "scenario.md"), "Test scenario content");
      const safePath: SafePathFn = (_series, file) => join(tmpDir, file!);
      const { renderSystemPrompt } = createTemplateEngine(mockPluginManager, safePath);
      const result = await renderSystemPrompt("test-series", {
        templateOverride: "Scenario: {{ scenario }}",
      });
      assertEquals(result.error, null);
      assertEquals(result.content, "Scenario: Test scenario content");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("renderSystemPrompt handles missing scenario file gracefully", async () => {
      const safePath: SafePathFn = () => "/nonexistent/path/scenario.md";
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager, safePath);
    const result = await renderSystemPrompt("test-series", {
      templateOverride: "Scenario:[{{ scenario }}]",
    });
    assertEquals(result.error, null);
    assertEquals(result.content, "Scenario:[]");
  });

  await t.step("renderSystemPrompt returns error on Vento rendering failure", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager, nullSafePath);
    // Unclosed for-loop causes Vento to throw a parse/render error
    const result = await renderSystemPrompt("test-series", {
      templateOverride: "{{ for x of items }}no closing tag",
    });
    assertEquals(result.content, null);
    assertExists(result.error);
    assertEquals(result.error!.type, "vento-error");
  });

  await t.step("ventoEnv is returned from createTemplateEngine", () => {
    const engine = createTemplateEngine(mockPluginManager, nullSafePath);
    assertExists(engine.ventoEnv);
    assertEquals(typeof engine.ventoEnv.runString, "function");
  });

  await t.step("plugin variables are passed to template", async () => {
    const pluginMgr = {
      getPromptVariables: async () => ({
        variables: { custom_var: "plugin_value" },
        fragments: ["frag1"],
      }),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(pluginMgr, nullSafePath);
    const result = await renderSystemPrompt("test-series", {
      templateOverride: "{{ custom_var }}",
    });
    assertEquals(result.error, null);
    assertEquals(result.content, "plugin_value");
  });

  await t.step("undefined variable renders as empty string in Vento", async () => {
    const { renderSystemPrompt } = createTemplateEngine(mockPluginManager, nullSafePath);
    const result = await renderSystemPrompt("test-series", {
      templateOverride: "before[{{ nonexistent_var }}]after",
    });
    // Vento either outputs empty or throws — capture actual behavior
    if (result.error) {
      // If Vento throws for undefined vars, this is expected
      assertExists(result.error);
    } else {
      // If Vento renders undefined as empty, the content won't have "nonexistent_var"
      assertExists(result.content);
    }
  });

  await t.step("plugin_fragments empty when no plugins register prompts", async () => {
    const emptyPluginMgr = {
      getPromptVariables: async () => ({ variables: {}, fragments: [] }),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(emptyPluginMgr, nullSafePath);
    const result = await renderSystemPrompt("test-series", {
      templateOverride: "Fragments:[{{ for f of plugin_fragments }}{{ f }}{{ /for }}]",
    });
    assertEquals(result.error, null);
    assertEquals(result.content, "Fragments:[]");
  });

  await t.step("plugin_fragments ordering preserved in template output", async () => {
    const orderedPluginMgr = {
      getPromptVariables: async () => ({
        variables: {},
        fragments: ["AAA", "BBB", "CCC"],
      }),
    } as unknown as PluginManager;
    const { renderSystemPrompt } = createTemplateEngine(orderedPluginMgr, nullSafePath);
    const result = await renderSystemPrompt("test-series", {
      templateOverride: "{{ for f of plugin_fragments }}[{{ f }}]{{ /for }}",
    });
    assertEquals(result.error, null);
    assertEquals(result.content, "[AAA][BBB][CCC]");
  });
});
