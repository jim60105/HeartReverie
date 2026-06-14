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
 * Typed HTTP client for the writer-side `/api/templates*` endpoints.
 * Adds `X-Passphrase` + `Content-Type: application/json` via `apiFetch`.
 */

import { ApiError, apiFetch } from "@/lib/api";

export type TemplateKind = "system" | "plugin-fragment" | "lore" | "prompt-message-body";
export type LoreScope = "global" | "series" | "story";

export interface TemplateRef {
  id: string;
  label: string;
  path: string;
  templatePath: string;
  kind: TemplateKind;
  pluginName?: string;
  /**
   * zh-TW label sourced from the plugin manifest's `displayName`. Present
   * only for `kind === "plugin-fragment"` entries; frontend falls back to
   * `pluginName` (slug) when absent.
   */
  pluginDisplayName?: string;
  variable?: string;
  loreScope?: LoreScope;
  editable: boolean;
  sizeBytes: number;
}

export interface ListTemplatesResponse {
  entries: TemplateRef[];
  templates: TemplateRef[];
}

export type VariableSource =
  | "core"
  | "lore"
  | "plugin-fragment"
  | "plugin-dynamic"
  | "vento-helper"
  | "plugin-parameter";

export interface VariableEntry {
  name: string;
  type?: string;
  source: VariableSource;
  pluginName?: string;
  description?: string;
}

export interface GetVariablesResponse {
  variables: VariableEntry[];
  warnings?: string[];
}

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  ruleId: string;
  severity: DiagnosticSeverity;
  line: number;
  column: number;
  message: string;
  endLine?: number;
  endColumn?: number;
}

export interface LintResponse {
  diagnostics: Diagnostic[];
}

export interface LintBodyPath {
  templatePath: string;
  source: string;
  series?: string;
  story?: string;
}

/**
 * Source-form lint body for virtual editors (prompt-editor message cards,
 * lore drafts). Backend distinguishes by absence of `templatePath`.
 * `kind: "prompt-message-body"` requires `role`; backend wraps source in
 * `{{ message "<role>" }} … {{ /message }}` before parsing.
 */
export interface LintBodySource {
  kind: TemplateKind;
  source: string;
  role?: "system" | "user" | "assistant";
  scope?: LoreScope;
  series?: string;
  story?: string;
  pluginName?: string;
}

export type LintBody = LintBodyPath | LintBodySource;

export type PreviewFixture = "default" | "current" | Record<string, unknown>;

export interface PreviewBody {
  templatePath: string;
  source: string;
  fixture: PreviewFixture;
  series?: string;
  story?: string;
}

export interface PreviewMessages {
  kind: "messages";
  messages: Array<{ role: string; content: string }>;
  variables?: Record<string, unknown> & { injected?: string[] };
  ventoError?: { message: string; line?: number; column?: number };
  fixtureUsed?: string;
}

export interface PreviewMarkdown {
  kind: "markdown";
  content: string;
  variables?: Record<string, unknown> & { injected?: string[] };
  ventoError?: { message: string; line?: number; column?: number };
  fixtureUsed?: string;
}

export type PreviewResponse = PreviewMessages | PreviewMarkdown;

export interface WriteBody {
  templatePath: string;
  source: string;
}

export interface WriteResponse {
  ok: true;
  path: string;
  backupPath?: string;
}

/**
 * Template-editor-flavoured {@link ApiError} subclass. Preserves the public
 * field names template-editor consumers branch on (`status`, `detail`,
 * `expressions`, `body`) and the `instanceof TemplateApiError` check while
 * unifying the underlying problem-details parsing onto the shared `ApiError`.
 */
export class TemplateApiError extends ApiError {
  override readonly name = "TemplateApiError";
  readonly detail?: string;
  readonly expressions?: string[];

  constructor(err: ApiError) {
    const b = (err.body && typeof err.body === "object")
      ? err.body as Record<string, unknown>
      : undefined;
    const detail = typeof b?.detail === "string" ? b.detail : undefined;
    const expressions = Array.isArray(b?.expressions)
      ? b.expressions.filter((x): x is string => typeof x === "string")
      : undefined;
    super(
      detail ?? err.title ?? `HTTP ${err.status}`,
      err.status,
      err.type,
      err.title,
      err.body,
    );
    this.detail = detail;
    this.expressions = expressions;
  }
}

const JSON_HEADERS: Record<string, string> = { "Content-Type": "application/json" };

/**
 * Call the shared default-throwing client and, on a non-2xx `ApiError`,
 * rethrow it as a {@link TemplateApiError} so template-editor consumers keep
 * their `detail`/`expressions`/`instanceof` contract.
 */
async function templateFetchJson<T>(
  input: string,
  init?: Parameters<typeof apiFetch>[1],
): Promise<T> {
  try {
    const res = await apiFetch(input, init);
    return await res.json() as T;
  } catch (err: unknown) {
    if (err instanceof ApiError) throw new TemplateApiError(err);
    throw err;
  }
}

export interface SourceResponse {
  templatePath: string;
  source: string;
}

export async function fetchTemplateSource(templatePath: string): Promise<SourceResponse> {
  const url = `/api/templates/source?templatePath=${encodeURIComponent(templatePath)}`;
  return await templateFetchJson<SourceResponse>(url);
}

export async function listTemplates(
  opts: { series?: string; story?: string } = {},
): Promise<ListTemplatesResponse> {
  const params = new URLSearchParams();
  if (opts.series) params.set("series", opts.series);
  if (opts.story) params.set("story", opts.story);
  const qs = params.toString();
  const url = qs ? `/api/templates?${qs}` : "/api/templates";
  return await templateFetchJson<ListTemplatesResponse>(url);
}

export async function getVariables(
  opts: { kind?: TemplateKind; series?: string; story?: string; pluginName?: string } = {},
): Promise<GetVariablesResponse> {
  const params = new URLSearchParams();
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.series) params.set("series", opts.series);
  if (opts.story) params.set("story", opts.story);
  if (opts.pluginName) params.set("pluginName", opts.pluginName);
  const qs = params.toString();
  const url = qs ? `/api/templates/variables?${qs}` : "/api/templates/variables";
  return await templateFetchJson<GetVariablesResponse>(url);
}

export async function lintTemplate(body: LintBody): Promise<LintResponse> {
  return await templateFetchJson<LintResponse>("/api/templates/lint", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export async function previewTemplate(body: PreviewBody): Promise<PreviewResponse> {
  return await templateFetchJson<PreviewResponse>("/api/templates/preview", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

export async function writeTemplate(body: WriteBody): Promise<WriteResponse> {
  return await templateFetchJson<WriteResponse>("/api/templates", {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}
