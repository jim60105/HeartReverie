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

import { errorMessage } from "./errors.ts";
import type { Environment as VentoEnvironment, Template as VentoTemplate } from "ventojs/core/environment";
import { VENTO_HELPERS } from "./vento-helpers.ts";
import { validateTemplate } from "./template.ts";
import { resolveLoreVariables } from "./lore.ts";
import type { PluginManager } from "./plugin-manager.ts";
import { createLogger } from "./logger.ts";

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

export type TemplateKind = "system" | "plugin-fragment" | "lore" | "prompt-message-body";

const CORE_VARIABLES: ReadonlyArray<VariableRef> = [
  { name: "previous_context", type: "array", source: "core", description: "Array of previous chapter contents (stripped)" },
  { name: "user_input", type: "string", source: "core", description: "Current user message" },
  { name: "isFirstRound", type: "boolean", source: "core", description: "Whether this is the first round (no non-empty chapters)" },
  { name: "series_name", type: "string", source: "core", description: "Display name of the current series" },
  { name: "story_name", type: "string", source: "core", description: "Display name of the current story" },
  { name: "chapter_number", type: "number", source: "core", description: "1-based index of the chapter being generated (injected when rendering plugin promptFragments)" },
  { name: "plugin_fragments", type: "array", source: "core", description: "Array of plugin-contributed prompt fragments" },
];

const CORE_LORE_SNAPSHOT_VARS: ReadonlyArray<VariableRef> = [
  { name: "series_name", type: "string", source: "core", description: "Current series name" },
  { name: "story_name", type: "string", source: "core", description: "Current story name" },
  { name: "lore_all", type: "string", source: "lore", description: "All enabled lore passage bodies concatenated" },
  { name: "lore_tags", type: "array", source: "lore", description: "All known lore tags" },
];

/** Vento keywords that AST identifier walking should never flag as unknown vars. */
const VENTO_KEYWORDS: ReadonlySet<string> = new Set([
  "for", "of", "if", "else", "message", "echo",
  "true", "false", "null", "undefined",
  "set", "include",
  "__messageState",
]);

/**
 * Build a variable catalog according to the templatePath kind:
 *   - `system`: core + plugin-fragment-vars + plugin-parameters + (if series/story) plugin-dynamic + lore + helpers
 *   - `plugin-fragment`: core + this plugin's fragment vars + lore (if series/story) + helpers
 *   - `lore`: snapshot (lore_* + series_name + story_name) + helpers
 *
 * Each plugin's `getDynamicVariables()` is wrapped in try/catch — on throw a
 * warnings[] entry naming the plugin is returned and other plugins continue.
 */
export interface CatalogBuildOptions {
  readonly kind: TemplateKind;
  readonly pluginManager: PluginManager;
  readonly playgroundDir: string;
  readonly series?: string;
  readonly story?: string;
  /** When `kind === "plugin-fragment"`, the owning plugin's name (used to scope fragment vars). */
  readonly pluginName?: string;
}

export interface CatalogResult {
  readonly variables: VariableRef[];
  readonly warnings: string[];
}

export async function buildVariableCatalog(
  opts: CatalogBuildOptions,
): Promise<CatalogResult> {
  const warnings: string[] = [];
  const helpers: VariableRef[] = VENTO_HELPERS.map((h) => ({
    name: h,
    source: "vento-helper" as const,
    description: `Vento built-in pipe filter |> ${h}`,
  }));

  if (opts.kind === "lore") {
    const loreVars = await collectLoreVars(opts, warnings);
    const seen = new Set<string>();
    const result: VariableRef[] = [];
    for (const v of [...CORE_LORE_SNAPSHOT_VARS, ...loreVars, ...helpers]) {
      if (seen.has(v.name)) continue;
      seen.add(v.name);
      result.push(v);
    }
    return { variables: result, warnings };
  }

  const out: VariableRef[] = [...CORE_VARIABLES];

  // Plugin-declared parameters (always shown)
  for (const p of opts.pluginManager.getParameters()) {
    if (p.source === "core") continue;
    out.push({
      name: p.name,
      type: p.type,
      source: "plugin-parameter",
      pluginName: p.source,
      description: p.description,
    });
  }

  // Plugin-fragment-declared variables (from manifests, always shown)
  try {
    const fragVars = await opts.pluginManager.getPromptVariables();
    for (const [name, meta] of Object.entries(fragVars.metadata ?? {})) {
      // When scoping for a specific plugin fragment, exclude *other* plugins' fragment vars
      if (opts.kind === "plugin-fragment" && opts.pluginName && meta.plugin !== opts.pluginName) continue;
      out.push({
        name,
        type: "string",
        source: "plugin-fragment",
        pluginName: meta.plugin,
        description: `Prompt fragment variable from plugin '${meta.plugin}' (${meta.file})`,
      });
    }
  } catch (err: unknown) {
    warnings.push(`pluginManager.getPromptVariables() failed: ${errorMessage(err)}`);
  }

  // Runtime dynamic + lore: only when both series and story provided
  if (opts.series && opts.story) {
    const dynamic = await collectDynamicVars(opts, warnings);
    out.push(...dynamic);
    const loreVars = await collectLoreVars(opts, warnings);
    out.push(...loreVars);
  }

  out.push(...helpers);
  // Deduplicate by name (first wins; helper / lore last so manifest entries take priority)
  const seen = new Set<string>();
  const deduped: VariableRef[] = [];
  for (const v of out) {
    if (seen.has(v.name)) continue;
    seen.add(v.name);
    deduped.push(v);
  }
  return { variables: deduped, warnings };
}

async function collectDynamicVars(
  opts: CatalogBuildOptions,
  warnings: string[],
): Promise<VariableRef[]> {
  if (!opts.series || !opts.story) return [];
  const out: VariableRef[] = [];
  try {
    const { variables, warnings: pluginWarnings } = await opts.pluginManager
      .getDynamicVariablesWithWarnings({
        series: opts.series,
        name: opts.story,
        storyDir: "",
        userInput: "",
        chapterNumber: 1,
        previousContent: "",
        isFirstRound: false,
        chapterCount: 0,
      });
    for (const w of pluginWarnings) {
      warnings.push(`plugin '${w.pluginName}' getDynamicVariables() failed: ${w.message}`);
    }
    for (const [key, value] of Object.entries(variables)) {
      out.push({
        name: key,
        type: typeof value,
        source: "plugin-dynamic",
        description: `Dynamic variable contributed at runtime`,
      });
    }
  } catch (err: unknown) {
    warnings.push(`plugin getDynamicVariables() failed: ${errorMessage(err)}`);
  }
  return out;
}

async function collectLoreVars(
  opts: CatalogBuildOptions,
  warnings: string[],
): Promise<VariableRef[]> {
  if (!opts.series) return [];
  try {
    const resolution = await resolveLoreVariables(opts.playgroundDir, opts.series, opts.story);
    return Object.keys(resolution.variables)
      .filter((k) => k.startsWith("lore_"))
      .map((name) => ({
        name,
        type: name === "lore_tags" ? "array" : "string",
        source: "lore" as const,
        description: `Lore variable resolved from ${opts.series}/${opts.story ?? "(series scope)"}`,
      }));
  } catch (err: unknown) {
    warnings.push(`resolveLoreVariables() failed: ${errorMessage(err)}`);
    return [];
  }
}

/**
 * Map a Vento `SourceError.message` containing a `multi-message:nested` /
 * `multi-message:invalid-role` tag to the corresponding lint diagnostic
 * ruleId. Returns `null` when the message has no recognised multi-message
 * tag (caller should fall back to `vento.parse-error`).
 */
export function multiMessageRuleId(message: string): string | null {
  if (message.includes("multi-message:nested")) return "vento.message-nested";
  if (message.includes("multi-message:invalid-role")) return "vento.message-invalid-role";
  return null;
}

/** Extract 1-based line/column from a Vento SourceError. */
export function positionFromError(
  err: unknown,
  source: string,
): { line: number; column: number } {
  const e = err as { position?: number; line?: number; column?: number } | null;
  if (e && typeof e.line === "number" && typeof e.column === "number") {
    return { line: Math.max(1, e.line), column: Math.max(1, e.column) };
  }
  if (e && typeof e.position === "number") {
    return positionFromOffset(source, e.position);
  }
  return { line: 1, column: 1 };
}

export function positionFromOffset(
  source: string,
  offset: number,
): { line: number; column: number } {
  if (offset < 0) return { line: 1, column: 1 };
  let line = 1;
  let col = 1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") { line++; col = 1; } else col++;
  }
  return { line, column: col };
}

/**
 * Walk a compiled Vento template AST identifier set and emit
 * `vento.unknown-variable` warnings for any reference not present in the
 * catalog. Implementation note: ventojs@^2.3.1 doesn't expose a stable AST
 * walker, but the generated `template.code` (raw JS body) is reliable enough
 * to scan for identifier tokens — false positives are acceptable since the
 * diagnostic is `warning` severity and never blocks save.
 */
export function checkUnknownVariables(
  ast: VentoTemplate,
  source: string,
  catalog: ReadonlyArray<VariableRef>,
): Diagnostic[] {
  const known = new Set<string>([...catalog.map((v) => v.name), ...VENTO_KEYWORDS]);

  // Collect for-of binders from the source itself (cheap, no AST needed):
  // pattern: {{ for <ident> of <iter> }}
  const binderRe = /\{\{\s*for\s+([a-zA-Z_]\w*)\s+of\s+([a-zA-Z_]\w*)/g;
  let binderMatch: RegExpExecArray | null;
  while ((binderMatch = binderRe.exec(source)) !== null) {
    known.add(binderMatch[1]!);
  }

  // Walk every tag body — only simple-identifier tokens count. Pipe filters
  // RHS are already captured as known via VENTO_HELPERS in the catalog.
  const tagRe = /\{\{([\s\S]*?)\}\}/g;
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(source)) !== null) {
    const raw = m[1]!.trim();
    if (!raw || raw.startsWith("#")) continue;
    if (raw === "else" || /^\/(for|if|message)$/.test(raw)) continue;

    // Strip string literals (single and double quoted) before identifier
    // extraction so e.g. `{{ message "user" }}` does not flag `user` as
    // unknown. Vento string syntax matches JS-style quoting.
    const expr = raw
      .replace(/"(?:[^"\\]|\\.)*"/g, "")
      .replace(/'(?:[^'\\]|\\.)*'/g, "");

    // Strip pipe-filter tail (RHS handled separately via helpers)
    // Identify the head identifier(s)
    const idents = expr.match(/\b[A-Za-z_]\w*\b/g) ?? [];
    for (const id of idents) {
      if (known.has(id) || VENTO_KEYWORDS.has(id)) continue;
      if (id.startsWith("__")) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      const offset = m.index + m[0].indexOf(id);
      const pos = positionFromOffset(source, offset);
      diagnostics.push({
        ruleId: "vento.unknown-variable",
        severity: "warning",
        line: pos.line,
        column: pos.column,
        message: `Unknown variable: ${id}`,
      });
    }
  }
  // unused parameter — `ast` accepted for future AST-based replacement
  void ast;
  return diagnostics;
}

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
      message: `Template exceeds ${TEMPLATE_LINT_MAX_LENGTH} characters (${source.length}) — refusing to parse`,
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
      diagnostics.push(...checkUnknownVariables(ast, source, catalog.variables));
    } catch (err: unknown) {
      log.warn("Variable catalog build failed during lint", {
        templatePath: opts.templatePath,
        error: errorMessage(err),
      });
    }
  }

  return diagnostics;
}
