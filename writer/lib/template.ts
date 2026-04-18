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

import { join } from "@std/path";
import vento from "ventojs";
import type { Environment as VentoEnvironment } from "ventojs/core/environment";
import type { TemplateEngine, RenderResult, RenderOptions } from "../types.ts";
import type { PluginManager } from "./plugin-manager.ts";
import { PLAYGROUND_DIR, ROOT_DIR } from "./config.ts";
import { buildVentoError } from "./errors.ts";
import { resolveLoreVariables, generateLoreVariables } from "./lore.ts";
import { createLogger } from "./logger.ts";

const log = createLogger("template");

/**
 * Validate a Vento template string — only safe expressions are allowed.
 * Prevents SSTI by whitelisting: simple variables, for/if control flow,
 * pipe filters, includes, and comments.
 * @returns {string[]} Array of error messages (empty = valid)
 */
export function validateTemplate(templateStr: string): string[] {
  const tagRegex: RegExp = /\{\{([\s\S]*?)\}\}/g;
  const errors: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = tagRegex.exec(templateStr)) !== null) {
    const expr = match[1]!.trim();
    if (!expr) continue;

    // Vento comments
    if (expr.startsWith("#")) continue;
    // End tags: /for, /if
    if (/^\/(?:for|if)$/.test(expr)) continue;
    // else
    if (expr === "else") continue;
    // for-of: for <ident> of <ident>
    if (/^for\s+[a-zA-Z_]\w*\s+of\s+[a-zA-Z_]\w*$/.test(expr)) continue;
    // if <ident>
    if (/^if\s+[a-zA-Z_]\w*$/.test(expr)) continue;
    // Simple variable: <ident>
    if (/^[a-zA-Z_]\w*$/.test(expr)) continue;
    // Variable with pipe filters: <ident> |> <filter> (one or more)
    if (/^[a-zA-Z_]\w*(\s*\|>\s*[a-zA-Z_]\w*)+$/.test(expr)) continue;
    // Include: disallowed — potential file-inclusion vector in user templates

    errors.push(
      `Unsafe template expression at position ${match.index}: {{ ${expr} }}`
    );
  }

  return errors;
}

export function createTemplateEngine(pluginManager: PluginManager): TemplateEngine {
  const ventoEnv: VentoEnvironment = vento();

  async function renderSystemPrompt(
    series: string,
    story?: string,
    {
      previousContext,
      userInput,
      isFirstRound,
      templateOverride,
      storyDir,
      chapterNumber,
      previousContent,
      chapterCount,
    }: RenderOptions = {},
  ): Promise<RenderResult> {
    const systemTemplatePath: string = join(ROOT_DIR, "system.md");

    // Validate user-provided templates to prevent SSTI
    if (templateOverride) {
      if (templateOverride.length > 500_000) {
        return {
          content: null,
          error: {
            title: "Template Validation Error",
            message: "Template exceeds maximum length",
            detail: "Template exceeds maximum length",
          },
        };
      }
      const templateErrors = validateTemplate(templateOverride);
      if (templateErrors.length > 0) {
        return {
          content: null,
          error: {
            title: "Template Validation Error",
            message:
              "Template contains unsafe expressions that cannot be executed",
            detail:
              "Template contains unsafe expressions that cannot be executed",
            expressions: templateErrors,
          },
        };
      }
    }

    const systemTemplate: string =
      templateOverride ||
      (await Deno.readTextFile(systemTemplatePath));

    // Resolve lore: raw passages + first-pass variables (snapshot for rendering context)
    const loreResolution = await resolveLoreVariables(PLAYGROUND_DIR, series, story);

    // Second pass: render each passage body through Vento with immutable snapshot context
    // Immutable snapshot: each passage render receives a fresh spread copy
    const renderContext: Record<string, unknown> = {
      ...loreResolution.variables,
      series_name: series || "",
      story_name: story || "",
    };

    const renderedPassages = await Promise.all(
      loreResolution.passages.map(async (passage) => {
        if (!passage.content || !passage.content.includes("{{")) {
          return passage;
        }
        try {
          const result = await ventoEnv.runString(passage.content, { ...renderContext });
          return { ...passage, content: result.content };
        } catch (renderErr: unknown) {
          log.warn(`Lore passage '${passage.relativePath}' Vento render failed, using raw content`, {
            passage: passage.relativePath,
            error: renderErr instanceof Error ? renderErr.message : String(renderErr),
          });
          return passage;
        }
      }),
    );

    // Re-generate lore variables from rendered passage bodies
    const loreVars = generateLoreVariables(renderedPassages);

    // Collect plugin prompt variables
    const pluginVars = await pluginManager.getPromptVariables();

    // Collect dynamic variables from plugins (e.g. status_data from state plugin)
    const dynamicVars = await pluginManager.getDynamicVariables({
      series: series || "",
      name: story || "",
      storyDir: storyDir || "",
      userInput: userInput || "",
      chapterNumber: chapterNumber ?? 1,
      previousContent: previousContent || "",
      isFirstRound: isFirstRound || false,
      chapterCount: chapterCount ?? 0,
    });

    try {
      const startTime = performance.now();
      const result = await ventoEnv.runString(systemTemplate, {
        ...dynamicVars,
        previous_context: previousContext || [],
        user_input: userInput || "",
        isFirstRound: isFirstRound || false,
        series_name: series || "",
        story_name: story || "",
        ...loreVars,
        ...pluginVars.variables,
        plugin_fragments: pluginVars.fragments || [],
      });
      const latencyMs = Math.round(performance.now() - startTime);
      const variableCount = Object.keys(loreVars).length + Object.keys(pluginVars.variables).length + Object.keys(dynamicVars).length + 4;
      log.info("Template rendered successfully", { latencyMs, variableCount });
      log.debug("Template render details", {
        templatePath: templateOverride ? "(override)" : systemTemplatePath,
        variableNames: [...Object.keys(loreVars), ...Object.keys(pluginVars.variables), ...Object.keys(dynamicVars)],
        renderedLength: result.content.length,
      });
      return { content: result.content, error: null };
    } catch (err: unknown) {
      log.error("Template rendering failed", {
        error: err instanceof Error ? err.message : String(err),
        templatePath: templateOverride ? "(override)" : systemTemplatePath,
      });
      return {
        content: null,
        error: buildVentoError(
          err instanceof Error ? err : new Error(String(err)),
          systemTemplatePath,
          pluginVars,
          [...Object.keys(loreVars), ...Object.keys(dynamicVars)],
        ),
      };
    }
  }

  return { renderSystemPrompt, validateTemplate, ventoEnv };
}
