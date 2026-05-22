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

/**
 * Template-lint public surface + orchestrator. Heavy lifting lives in:
 *  - {@link "./template-lint-catalog.ts"} — variable-catalog construction.
 *  - {@link "./template-lint-check.ts"} — unknown-variable scan + Vento
 *    source-position decoders.
 *
 * This file owns the diagnostic / variable-ref type contract that
 * sibling modules import, plus the `lintTemplate` pipeline that sequences
 * size-cap → SSTI whitelist → parse → catalog + unknown-variable check.
 */

import { errorMessage } from "./errors.ts";
import type {
  Environment as VentoEnvironment,
  Template as VentoTemplate,
} from "ventojs/core/environment";
import { validateTemplate } from "./template.ts";
import type { PluginManager } from "./plugin-manager.ts";
import { createLogger } from "./logger.ts";
import { buildVariableCatalog } from "./template-lint-catalog.ts";
import {
  checkUnknownVariables,
  multiMessageRuleId,
  positionFromError,
  positionFromOffset,
} from "./template-lint-check.ts";

const log = createLogger("template");

export const TEMPLATE_LINT_MAX_LENGTH = 500_000;

export type DiagnosticSeverity = "error" | "warning";

export interface Diagnostic {
  readonly ruleId: string;
  readonly severity: DiagnosticSeverity;
  readonly line: number;
  readonly column: number;
  readonly message: string;
}

export type VariableSource =
  | "core"
  | "lore"
  | "plugin-fragment"
  | "plugin-dynamic"
  | "plugin-parameter"
  | "vento-helper";

export interface VariableRef {
  readonly name: string;
  readonly type?: string;
  readonly source: VariableSource;
  readonly pluginName?: string;
  readonly description?: string;
}

export type TemplateKind =
  | "system"
  | "plugin-fragment"
  | "lore"
  | "prompt-message-body";

// Re-exports for stable public surface.
export {
  buildVariableCatalog,
  type CatalogBuildOptions,
  type CatalogResult,
} from "./template-lint-catalog.ts";
export {
  checkUnknownVariables,
  multiMessageRuleId,
  positionFromError,
  positionFromOffset,
} from "./template-lint-check.ts";

export interface LintOptions {
  readonly source: string;
  readonly templatePath: string;
  readonly kind: TemplateKind;
  readonly ventoEnv: VentoEnvironment;
  readonly pluginManager: PluginManager;
  readonly playgroundDir: string;
  readonly series?: string;
  readonly story?: string;
  readonly pluginName?: string;
}

const REMEDIATION_HINT =
  "使用 `{{> include }}` 是不允許的；改用主模板具名變數、plugin promptFragments 或 getDynamicVariables() 注入內容";

/**
 * Full lint pipeline:
 *   1. Reject long templates (> 500 KB) up front.
 *   2. Run `validateTemplate()` (SSTI whitelist) → `vento.unsafe-expression`.
 *   3. `ventoEnv.compile(source, "<lint>")` → parse-time `SourceError`
 *      mapped to `vento.message-nested` / `vento.message-invalid-role` /
 *      `vento.parse-error`.
 *   4. Walk identifiers vs the catalog → `vento.unknown-variable` warnings.
 */
export async function lintTemplate(opts: LintOptions): Promise<Diagnostic[]> {
  const { source, ventoEnv } = opts;
  const diagnostics: Diagnostic[] = [];

  if (source.length > TEMPLATE_LINT_MAX_LENGTH) {
    return [{
      ruleId: "vento.long-template",
      severity: "error",
      line: 1,
      column: 1,
      message:
        `Template exceeds ${TEMPLATE_LINT_MAX_LENGTH} characters (${source.length}) — refusing to parse`,
    }];
  }

  // 1. SSTI whitelist
  const sstiErrors = validateTemplate(source);
  for (const expr of sstiErrors) {
    const offsetMatch = expr.match(/at position (\d+):/);
    const offset = offsetMatch ? parseInt(offsetMatch[1]!, 10) : 0;
    const pos = positionFromOffset(source, offset);
    diagnostics.push({
      ruleId: "vento.unsafe-expression",
      severity: "error",
      line: pos.line,
      column: pos.column,
      message: `${expr} — ${REMEDIATION_HINT}`,
    });
  }

  // If the source contains SSTI tokens we still attempt parse to surface
  // message-nested errors; ventoEnv.compile() is parse-only and never executes.
  let ast: VentoTemplate | null = null;
  try {
    ast = ventoEnv.compile(source, "<lint>");
  } catch (err: unknown) {
    const msg = errorMessage(err);
    const ruleId = multiMessageRuleId(msg) ?? "vento.parse-error";
    const pos = positionFromError(err, source);
    diagnostics.push({
      ruleId,
      severity: "error",
      line: pos.line,
      column: pos.column,
      message: msg,
    });
  }

  // 2. Unknown variables (warning only)
  if (ast) {
    try {
      const catalog = await buildVariableCatalog({
        kind: opts.kind,
        pluginManager: opts.pluginManager,
        playgroundDir: opts.playgroundDir,
        series: opts.series,
        story: opts.story,
        pluginName: opts.pluginName,
      });
      diagnostics.push(
        ...checkUnknownVariables(ast, source, catalog.variables),
      );
    } catch (err: unknown) {
      log.warn("Variable catalog build failed during lint", {
        templatePath: opts.templatePath,
        error: errorMessage(err),
      });
    }
  }

  return diagnostics;
}
