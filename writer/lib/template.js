// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import { join } from "@std/path";
import vento from "ventojs";
import { ROOT_DIR } from "./config.js";
import { buildVentoError } from "./errors.js";

/**
 * Validate a Vento template string — only safe expressions are allowed.
 * Prevents SSTI by whitelisting: simple variables, for/if control flow,
 * pipe filters, includes, and comments.
 * @returns {string[]} Array of error messages (empty = valid)
 */
export function validateTemplate(templateStr) {
  const tagRegex = /\{\{([\s\S]*?)\}\}/g;
  const errors = [];
  let match;

  while ((match = tagRegex.exec(templateStr)) !== null) {
    const expr = match[1].trim();
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

export function createTemplateEngine(pluginManager, safePath) {
  const ventoEnv = vento();

  async function renderSystemPrompt(
    series,
    {
      previousContext,
      userInput,
      status,
      isFirstRound,
      templateOverride,
    } = {}
  ) {
    const systemTemplatePath = join(ROOT_DIR, "system.md");
    const scenarioPath = safePath(series, "scenario.md");

    // Validate user-provided templates to prevent SSTI
    if (templateOverride) {
      if (templateOverride.length > 500_000) {
        return {
          content: null,
          error: {
            title: "Template Validation Error",
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
            detail:
              "Template contains unsafe expressions that cannot be executed",
            expressions: templateErrors,
          },
        };
      }
    }

    const systemTemplate =
      templateOverride ||
      (await Deno.readTextFile(systemTemplatePath));
    let scenarioContent = "";
    if (scenarioPath) {
      try {
        scenarioContent = await Deno.readTextFile(scenarioPath);
      } catch {
        // Scenario file may not exist
      }
    }

    // Collect plugin prompt variables
    const pluginVars = await pluginManager.getPromptVariables();

    try {
      const result = await ventoEnv.runString(systemTemplate, {
        scenario: scenarioContent,
        previous_context: previousContext || [],
        user_input: userInput || "",
        status_data: status || "",
        isFirstRound: isFirstRound || false,
        ...pluginVars.variables,
        plugin_fragments: pluginVars.fragments || [],
      });
      return { content: result.content, error: null };
    } catch (err) {
      return {
        content: null,
        error: buildVentoError(err, systemTemplatePath, pluginVars),
      };
    }
  }

  return { renderSystemPrompt, validateTemplate, ventoEnv };
}
