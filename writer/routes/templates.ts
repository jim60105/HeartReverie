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

import { join, resolve } from "@std/path";
import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";
import { problemJson, errorMessage } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { validateTemplate } from "../lib/template.ts";
import {
  atomicWriteWithBackup,
  isPathContained,
  PathSafetyError,
} from "../lib/path-safety.ts";
import {
  buildVariableCatalog,
  lintTemplate,
  type TemplateKind,
} from "../lib/template-lint.ts";
import {
  loadDefaultFixture,
  renderSystemPromptForPreview,
  type FixtureBag,
  type PreviewArgs,
} from "../lib/template-preview.ts";



const log = createLogger("template");

/**
 * Validates a single `<series>` or `<story>` segment inside a `lore:` or
 * `plugin:` templatePath. The templatePath syntax uses `:` as separator and
 * resolves to filesystem paths, so segments must not contain `:`, path
 * separators, NUL, or `..`. Other Unicode characters (e.g. CJK series names
 * like `艾爾瑞亞`) are allowed — they round-trip through `Deno.readDir` and
 * the existing playground tooling.
 */
const SEGMENT_RE = /^[^:\/\\\x00]+$/;
function isValidSegment(s: string): boolean {
  return SEGMENT_RE.test(s) && !s.includes("..") && !s.startsWith("_") && s !== "lost+found";
}

/** Per-target write mutex keyed on resolved absolute final path. */
const WRITE_MUTEX = new Map<string, Promise<void>>();

async function withWriteMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = WRITE_MUTEX.get(key) ?? Promise.resolve();
  let release: () => void;
  const next = new Promise<void>((r) => { release = r; });
  const chained = prev.then(() => next);
  WRITE_MUTEX.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release!();
    if (WRITE_MUTEX.get(key) === chained) {
      WRITE_MUTEX.delete(key);
    }
  }
}

interface ParsedTemplatePath {
  readonly kind: Exclude<TemplateKind, "prompt-message-body">;
  readonly pluginName?: string;
  readonly relativeFile?: string;
  readonly loreScope?: "global" | "series" | "story";
  readonly series?: string;
  readonly story?: string;
}

interface ParseError {
  readonly status: number;
  readonly detail: string;
}

function parseTemplatePath(
  templatePath: unknown,
): { ok: true; value: ParsedTemplatePath } | { ok: false; err: ParseError } {
  if (typeof templatePath !== "string" || templatePath.length === 0) {
    return { ok: false, err: { status: 400, detail: "templatePath required" } };
  }
  if (templatePath === "system.md") {
    return { ok: true, value: { kind: "system" } };
  }
  if (templatePath.startsWith("plugin:")) {
    const parts = templatePath.split(":");
    if (parts.length < 3) {
      return { ok: false, err: { status: 400, detail: "Invalid plugin templatePath" } };
    }
    const pluginName = parts[1];
    const relativeFile = parts.slice(2).join(":");
    if (!pluginName || !relativeFile) {
      return { ok: false, err: { status: 400, detail: "Invalid plugin templatePath" } };
    }
    if (!isValidSegment(pluginName)) {
      return { ok: false, err: { status: 400, detail: "Invalid plugin name segment" } };
    }
    return { ok: true, value: { kind: "plugin-fragment", pluginName, relativeFile } };
  }
  if (templatePath.startsWith("lore:")) {
    const parts = templatePath.split(":");
    if (parts.length < 3) {
      return { ok: false, err: { status: 400, detail: "Invalid lore templatePath" } };
    }
    const scope = parts[1];
    if (scope === "global") {
      const rel = parts.slice(2).join(":");
      if (!rel) return { ok: false, err: { status: 400, detail: "Missing lore relative path" } };
      return { ok: true, value: { kind: "lore", loreScope: "global", relativeFile: rel } };
    }
    if (scope === "series") {
      if (parts.length < 4) {
        return { ok: false, err: { status: 400, detail: "Invalid lore:series templatePath" } };
      }
      const series = parts[2]!;
      const rel = parts.slice(3).join(":");
      if (!isValidSegment(series)) {
        return { ok: false, err: { status: 400, detail: "Invalid series segment" } };
      }
      if (!rel) return { ok: false, err: { status: 400, detail: "Missing lore relative path" } };
      return { ok: true, value: { kind: "lore", loreScope: "series", series, relativeFile: rel } };
    }
    if (scope === "story") {
      if (parts.length < 5) {
        return { ok: false, err: { status: 400, detail: "Invalid lore:story templatePath" } };
      }
      const series = parts[2]!;
      const story = parts[3]!;
      const rel = parts.slice(4).join(":");
      if (!isValidSegment(series) || !isValidSegment(story)) {
        return { ok: false, err: { status: 400, detail: "Invalid series/story segment" } };
      }
      if (!rel) return { ok: false, err: { status: 400, detail: "Missing lore relative path" } };
      return { ok: true, value: { kind: "lore", loreScope: "story", series, story, relativeFile: rel } };
    }
    return { ok: false, err: { status: 400, detail: `Unknown lore scope: ${scope}` } };
  }
  return { ok: false, err: { status: 400, detail: "Unrecognised templatePath prefix" } };
}

/** Resolve a parsed templatePath to the absolute filesystem path + allowed base. */
interface ResolvedPath {
  readonly absolute: string;
  readonly allowedBase: string;
}

function resolveTemplatePath(
  parsed: ParsedTemplatePath,
  deps: AppDeps,
): { ok: true; value: ResolvedPath } | { ok: false; err: ParseError } {
  const { config, pluginManager } = deps;
  if (parsed.kind === "system") {
    const target = config.PROMPT_FILE;
    return { ok: true, value: { absolute: target, allowedBase: parentDir(target) } };
  }
  if (parsed.kind === "plugin-fragment") {
    if (!parsed.pluginName || !parsed.relativeFile) {
      return { ok: false, err: { status: 400, detail: "Missing plugin segments" } };
    }
    if (parsed.relativeFile.includes("..")) {
      return { ok: false, err: { status: 400, detail: "Plugin path contains .." } };
    }
    const dir = pluginManager.getPluginDir(parsed.pluginName);
    if (!dir) {
      return { ok: false, err: { status: 404, detail: `Unknown plugin: ${parsed.pluginName}` } };
    }
    const abs = resolve(dir, parsed.relativeFile);
    if (!isPathContained(dir, abs)) {
      return { ok: false, err: { status: 400, detail: "Plugin path escapes plugin directory" } };
    }
    return { ok: true, value: { absolute: abs, allowedBase: dir } };
  }
  // lore
  if (!parsed.relativeFile || parsed.relativeFile.includes("..")) {
    return { ok: false, err: { status: 400, detail: "Lore path contains .. or is empty" } };
  }
  let scopeRoot: string;
  if (parsed.loreScope === "global") {
    scopeRoot = join(config.PLAYGROUND_DIR, "_lore");
  } else if (parsed.loreScope === "series") {
    scopeRoot = join(config.PLAYGROUND_DIR, parsed.series!, "_lore");
  } else if (parsed.loreScope === "story") {
    scopeRoot = join(config.PLAYGROUND_DIR, parsed.series!, parsed.story!, "_lore");
  } else {
    return { ok: false, err: { status: 400, detail: "Unknown lore scope" } };
  }
  const abs = resolve(scopeRoot, parsed.relativeFile);
  if (!isPathContained(scopeRoot, abs)) {
    return { ok: false, err: { status: 400, detail: "Lore path escapes scope root" } };
  }
  return { ok: true, value: { absolute: abs, allowedBase: scopeRoot } };
}

export function registerTemplateRoutes(app: Hono, deps: AppDeps): void {
  // ── GET /api/templates ────────────────────────────────────────
  app.get("/api/templates", async (c) => {
    try {
      void c;
      const entries: Array<Record<string, unknown>> = [];

      // System — show size of the *effective* system.md: the user's override
      // at PROMPT_FILE if present, otherwise the engine default at
      // ROOT_DIR/system.md (matches `renderSystemPrompt` / `readTemplate`
      // fallback semantics).
      let systemSize = 0;
      try {
        const stat = await Deno.stat(deps.config.PROMPT_FILE);
        systemSize = stat.size;
      } catch {
        try {
          const stat = await Deno.stat(`${deps.config.ROOT_DIR}/system.md`);
          systemSize = stat.size;
        } catch { /* neither present */ }
      }
      entries.push({
        id: "system.md",
        label: "system.md",
        path: "system.md",
        templatePath: "system.md",
        kind: "system",
        editable: true,
        sizeBytes: systemSize,
      });

      // Plugin fragments — enumerate every promptFragment (named + unnamed)
      try {
        const refs = deps.pluginManager.enumerateFragmentRefs();
        for (const ref of refs) {
          const tp = `plugin:${ref.plugin}:${ref.file}`;
          entries.push({
            id: tp,
            label: `${ref.plugin} → ${ref.file}`,
            path: ref.file,
            templatePath: tp,
            kind: "plugin-fragment",
            pluginName: ref.plugin,
            variable: ref.variable,
            editable: false,
            sizeBytes: 0,
          });
        }
      } catch (err: unknown) {
        log.warn("Failed to enumerate plugin fragments", {
          error: errorMessage(err),
        });
      }

      // Lore — enumerate every passage under playground (global + every
      // series + every story), ignoring query params. Editor needs to see
      // every lore file regardless of which story is loaded.
      try {
        const allLore = await enumerateAllLore(deps.config.PLAYGROUND_DIR);
        for (const entry of allLore) {
          entries.push(entry);
        }
      } catch (err: unknown) {
        log.warn("Failed to enumerate lore entries", {
          error: errorMessage(err),
        });
      }

      return c.json({ entries, templates: entries });
    } catch (err: unknown) {
      log.error("GET /api/templates failed", {
        error: errorMessage(err),
      });
      return c.json(problemJson("Internal Server Error", 500, "Failed to list templates"), 500);
    }
  });

  // ── GET /api/templates/variables ──────────────────────────────
  app.get("/api/templates/variables", async (c) => {
    try {
      const url = new URL(c.req.url);
      const kindRaw = url.searchParams.get("kind") ?? "system";
      const allowed: ReadonlyArray<TemplateKind> = [
        "system",
        "plugin-fragment",
        "lore",
        "prompt-message-body",
      ];
      if (!allowed.includes(kindRaw as TemplateKind)) {
        return c.json(
          problemJson("Bad Request", 400, `Invalid kind: ${kindRaw}`),
          400,
        );
      }
      const kind = kindRaw as TemplateKind;
      const series = url.searchParams.get("series") || undefined;
      const story = url.searchParams.get("story") || undefined;
      const pluginName = url.searchParams.get("pluginName") || undefined;
      const result = await buildVariableCatalog({
        kind,
        pluginManager: deps.pluginManager,
        playgroundDir: deps.config.PLAYGROUND_DIR,
        series,
        story,
        pluginName,
      });
      return c.json({ variables: result.variables, warnings: result.warnings });
    } catch (err: unknown) {
      log.error("GET /api/templates/variables failed", {
        error: errorMessage(err),
      });
      return c.json(problemJson("Internal Server Error", 500, "Failed to build variable catalog"), 500);
    }
  });

  // ── GET /api/templates/source ─────────────────────────────────
  // Read-only access to template file contents. Used by the editor to
  // populate the buffer before edit. Returns `{ source }` with empty string
  // for files that do not yet exist (e.g. blank `system.md`). Plugin
  // fragments are readable here even though PUT refuses them with 403.
  app.get("/api/templates/source", async (c) => {
    const url = new URL(c.req.url);
    const templatePath = url.searchParams.get("templatePath");
    const parsed = parseTemplatePath(templatePath);
    if (!parsed.ok) {
      return c.json(problemJson("Bad Request", parsed.err.status, parsed.err.detail), parsed.err.status as 400);
    }
    const resolved = resolveTemplatePath(parsed.value, deps);
    if (!resolved.ok) {
      return c.json(problemJson("Bad Request", resolved.err.status, resolved.err.detail), resolved.err.status as 400);
    }
    try {
      const source = await Deno.readTextFile(resolved.value.absolute);
      return c.json({ templatePath, source });
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        // For `system.md`, fall back to the engine default at
        // `ROOT_DIR/system.md` when the user has not yet customised the
        // playground copy. Matches `renderSystemPrompt` / `readTemplate`
        // fallback semantics so the editor opens with the same content the
        // engine would actually render.
        if (parsed.value.kind === "system") {
          try {
            const fallback = await Deno.readTextFile(
              `${deps.config.ROOT_DIR}/system.md`,
            );
            return c.json({ templatePath, source: fallback });
          } catch { /* fall through to empty */ }
        }
        return c.json({ templatePath, source: "" });
      }
      log.error("GET /api/templates/source failed", {
        templatePath,
        error: errorMessage(err),
      });
      return c.json(problemJson("Internal Server Error", 500, "Failed to read template source"), 500);
    }
  });

  // ── POST /api/templates/lint ──────────────────────────────────
  //
  // Accepts two request shapes:
  //
  //   1. Path-form (Template Editor page, real on-disk files):
  //        { templatePath, source, series?, story? }
  //
  //   2. Source-form (virtual/in-memory sites — prompt-editor cards,
  //      lore drafts):
  //        { kind, source, series?, story?, scope?, role?, pluginName? }
  //
  //      For kind = "prompt-message-body" the route wraps `source` in
  //      `{{ message "<role>" }} … {{ /message }}` before parsing and
  //      translates diagnostic line numbers back to the original source.
  //      Diagnostics that point inside the synthetic wrapper are dropped.
  app.post("/api/templates/lint", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(problemJson("Bad Request", 400, "Invalid JSON"), 400);
    }
    const source = body.source;
    if (typeof source !== "string") {
      return c.json(problemJson("Bad Request", 400, "source must be a string"), 400);
    }

    const ventoEnv = deps.templateEngine?.ventoEnv;
    if (!ventoEnv) {
      return c.json(problemJson("Internal Server Error", 500, "Template engine unavailable"), 500);
    }

    const hasTemplatePath = typeof body.templatePath === "string"
      && (body.templatePath as string).length > 0;

    // ─── Source-form branch ──────────────────────────────────────
    if (!hasTemplatePath) {
      const kindRaw = body.kind;
      const allowedKinds: ReadonlyArray<TemplateKind> = [
        "system",
        "plugin-fragment",
        "lore",
        "prompt-message-body",
      ];
      if (typeof kindRaw !== "string" || !allowedKinds.includes(kindRaw as TemplateKind)) {
        return c.json(
          problemJson("Bad Request", 400, `Missing or invalid 'kind' (got ${JSON.stringify(kindRaw)})`),
          400,
        );
      }
      const kind = kindRaw as TemplateKind;
      const series = typeof body.series === "string" ? body.series : undefined;
      const story = typeof body.story === "string" ? body.story : undefined;
      const pluginName = typeof body.pluginName === "string" ? body.pluginName : undefined;

      if (kind === "plugin-fragment" && !pluginName) {
        return c.json(
          problemJson("Bad Request", 400, "kind='plugin-fragment' requires 'pluginName'"),
          400,
        );
      }
      let role: "system" | "user" | "assistant" | undefined;
      if (kind === "prompt-message-body") {
        const r = body.role;
        if (r !== "system" && r !== "user" && r !== "assistant") {
          return c.json(
            problemJson("Bad Request", 400, "kind='prompt-message-body' requires role ∈ {system,user,assistant}"),
            400,
          );
        }
        role = r;
      }
      if (kind === "lore") {
        const s = body.scope;
        if (s !== undefined) {
          if (s !== "global" && s !== "series" && s !== "story") {
            return c.json(
              problemJson("Bad Request", 400, "kind='lore' scope must be one of global|series|story"),
              400,
            );
          }
          if (s === "series" && !series) {
            return c.json(
              problemJson("Bad Request", 400, "kind='lore' scope='series' requires 'series'"),
              400,
            );
          }
          if (s === "story" && (!series || !story)) {
            return c.json(
              problemJson("Bad Request", 400, "kind='lore' scope='story' requires 'series' and 'story'"),
              400,
            );
          }
        }
        // scope is optional; an unsaved draft may have no scope yet — engine
        // still gives syntax/parse diagnostics; only lore_* resolution needs
        // series+story.
      }

      try {
        let lintSource = source;
        let lineOffset = 0;
        if (kind === "prompt-message-body" && role) {
          // Wrap so the engine sees the real `{{ message }}` context — this
          // surfaces nested-message diagnostics that would otherwise hide
          // until prompt serialization at chat time.
          const prefix = `{{ message "${role}" }}\n`;
          const suffix = `\n{{ /message }}`;
          lintSource = prefix + source + suffix;
          // Each `{{ message }}` tag is its own line in the wrapped buffer.
          // Diagnostics in the body get `line += 1`; diagnostics on line 1
          // or on the trailing wrapper line are dropped (they target the
          // synthetic wrapper, not user input).
          lineOffset = 1;
        }

        const rawDiagnostics = await lintTemplate({
          source: lintSource,
          templatePath: "",
          kind,
          ventoEnv,
          pluginManager: deps.pluginManager,
          playgroundDir: deps.config.PLAYGROUND_DIR,
          series,
          story,
          pluginName,
        });

        let diagnostics = rawDiagnostics;
        if (kind === "prompt-message-body" && role) {
          const sourceLineCount = source.split("\n").length;
          // user lines occupy wrapped lines 2 .. (sourceLineCount + 1)
          const lastUserLine = 1 + sourceLineCount;
          diagnostics = rawDiagnostics.flatMap((d) => {
            // Whole-template diagnostics (not line-specific) must pass through
            // even though they report at line 1 of the wrapped buffer.
            if (d.ruleId === "vento.long-template") {
              return [{ ...d, line: 1, column: 1 }];
            }
            if (d.line >= 2 && d.line <= lastUserLine) {
              return [{ ...d, line: d.line - lineOffset }];
            }
            return [];
          });
        }

        return c.json({ diagnostics });
      } catch (err: unknown) {
        log.error("POST /api/templates/lint (source-form) failed", {
          kind: kindRaw,
          error: errorMessage(err),
        });
        return c.json(problemJson("Internal Server Error", 500, "Lint pipeline failure"), 500);
      }
    }

    // ─── Path-form branch (unchanged) ────────────────────────────
    const templatePath = body.templatePath;
    const parsed = parseTemplatePath(templatePath);
    if (!parsed.ok) return c.json(problemJson("Bad Request", parsed.err.status, parsed.err.detail), parsed.err.status as 400);

    try {
      const diagnostics = await lintTemplate({
        source,
        templatePath: typeof templatePath === "string" ? templatePath : "",
        kind: parsed.value.kind,
        ventoEnv,
        pluginManager: deps.pluginManager,
        playgroundDir: deps.config.PLAYGROUND_DIR,
        series: typeof body.series === "string" ? body.series : parsed.value.series,
        story: typeof body.story === "string" ? body.story : parsed.value.story,
        pluginName: parsed.value.pluginName,
      });
      return c.json({ diagnostics });
    } catch (err: unknown) {
      log.error("POST /api/templates/lint failed", {
        error: errorMessage(err),
      });
      return c.json(problemJson("Internal Server Error", 500, "Lint pipeline failure"), 500);
    }
  });

  // ── POST /api/templates/preview ───────────────────────────────
  app.post("/api/templates/preview", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(problemJson("Bad Request", 400, "Invalid JSON"), 400);
    }
    const source = body.source;
    const fixture = body.fixture;
    if (typeof source !== "string") {
      return c.json(problemJson("Bad Request", 400, "source must be a string"), 400);
    }
    const parsed = parseTemplatePath(body.templatePath);
    if (!parsed.ok) return c.json(problemJson("Bad Request", parsed.err.status, parsed.err.detail), parsed.err.status as 400);
    const ventoEnv = deps.templateEngine?.ventoEnv;
    if (!ventoEnv) {
      return c.json(problemJson("Internal Server Error", 500, "Template engine unavailable"), 500);
    }

    const templateKind = parsed.value.kind;
    try {
      let args: PreviewArgs;
      if (fixture === "current") {
        const series = typeof body.series === "string" ? body.series : "";
        const story = typeof body.story === "string" ? body.story : "";
        if (!series || !story) {
          return c.json(problemJson("Bad Request", 400, "series and story are required for fixture='current'"), 400);
        }
        args = {
          mode: "current",
          source,
          templateKind,
          ventoEnv,
          series,
          story,
          deps,
        };
      } else if (fixture === "default" || fixture === undefined || fixture === null) {
        const defaultFixture = await loadDefaultFixture(deps.config.ROOT_DIR);
        args = {
          mode: "default",
          source,
          templateKind,
          ventoEnv,
          fixture: defaultFixture,
        };
      } else if (typeof fixture === "object") {
        args = {
          mode: "inline",
          source,
          templateKind,
          ventoEnv,
          fixture: fixture as FixtureBag,
        };
      } else {
        return c.json(problemJson("Bad Request", 400, "fixture must be 'default', 'current', or an object"), 400);
      }
      const result = await renderSystemPromptForPreview(args);
      return c.json(result);
    } catch (err: unknown) {
      log.error("POST /api/templates/preview failed", {
        error: errorMessage(err),
      });
      return c.json(problemJson("Internal Server Error", 500, "Preview failed"), 500);
    }
  });

  // ── PUT /api/templates ────────────────────────────────────────
  app.put("/api/templates", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json(problemJson("Bad Request", 400, "Invalid JSON"), 400);
    }
    const templatePath = body.templatePath;
    const source = body.source;
    if (typeof source !== "string") {
      return c.json(problemJson("Bad Request", 400, "source must be a string"), 400);
    }
    // 403 BEFORE any validation when targeting plugin: paths
    if (typeof templatePath === "string" && templatePath.startsWith("plugin:")) {
      return c.json(
        problemJson("Forbidden", 403, "Plugin fragments are read-only; edit them in the plugin source repository"),
        403,
      );
    }
    const parsed = parseTemplatePath(templatePath);
    if (!parsed.ok) return c.json(problemJson("Bad Request", parsed.err.status, parsed.err.detail), parsed.err.status as 400);

    if (source.length > 500_000) {
      return c.json(problemJson("Bad Request", 400, "Template exceeds maximum length"), 400);
    }
    const sstiErrors = validateTemplate(source);
    if (sstiErrors.length > 0) {
      return c.json({
        type: "https://heartreverie.invalid/template-validation",
        title: "Template Validation Error",
        status: 422,
        detail: "Template contains unsafe expressions that cannot be executed",
        expressions: sstiErrors,
      }, 422);
    }

    const resolved = resolveTemplatePath(parsed.value, deps);
    if (!resolved.ok) {
      return c.json(problemJson("Bad Request", resolved.err.status, resolved.err.detail), resolved.err.status as 400);
    }

    try {
      // Ensure parent directory exists before realpath checks
      await Deno.mkdir(parentDir(resolved.value.absolute), { recursive: true, mode: 0o775 });
      // Ensure allowedBase exists too
      await Deno.mkdir(resolved.value.allowedBase, { recursive: true, mode: 0o775 });

      const result = await withWriteMutex(resolved.value.absolute, async () => {
        return await atomicWriteWithBackup(
          resolved.value.absolute,
          source,
          resolved.value.allowedBase,
        );
      });
      log.info("Template saved", {
        templatePath,
        path: result.path,
        backupPath: result.backupPath,
        bytes: new TextEncoder().encode(source).length,
      });
      return c.json({
        ok: true,
        path: result.path,
        backupPath: result.backupPath,
      });
    } catch (err: unknown) {
      if (err instanceof PathSafetyError) {
        if (err.code === "symlink-rejected") {
          log.warn("Template write rejected — symlink target", { templatePath, error: err.message });
          return c.json(problemJson("Bad Request", 400, err.message), 400);
        }
        log.warn("Template write rejected — path safety", { templatePath, error: err.message });
        return c.json(problemJson("Bad Request", 400, err.message), 400);
      }
      log.error("PUT /api/templates failed", {
        templatePath,
        error: errorMessage(err),
      });
      return c.json(problemJson("Internal Server Error", 500, "Failed to save template"), 500);
    }
  });
}

function parentDir(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx > 0 ? p.slice(0, idx) : ".";
}

/**
 * Walk every `_lore` directory under playground (global + every series +
 * every story) and emit listing entries. The template editor needs to see
 * every lore file regardless of which story is currently loaded — scoping
 * by `series`/`story` would hide files the user wants to edit.
 */
async function enumerateAllLore(
  playgroundDir: string,
): Promise<Array<Record<string, unknown>>> {
  const out: Array<Record<string, unknown>> = [];

  async function walk(scopeRoot: string, builder: (rel: string) => { tp: string; label: string; scope: "global" | "series" | "story" }) {
    let stat: Deno.FileInfo;
    try {
      stat = await Deno.stat(scopeRoot);
    } catch {
      return;
    }
    if (!stat.isDirectory) return;
    for await (const top of walkMd(scopeRoot)) {
      const rel = top.slice(scopeRoot.length).replace(/^[/\\]+/, "");
      const meta = builder(rel);
      let sizeBytes = 0;
      try {
        sizeBytes = (await Deno.stat(top)).size;
      } catch { /* ignore */ }
      out.push({
        id: meta.tp,
        label: meta.label,
        path: rel,
        templatePath: meta.tp,
        kind: "lore",
        loreScope: meta.scope,
        editable: true,
        sizeBytes,
      });
    }
  }

  // Global scope
  await walk(`${playgroundDir}/_lore`, (rel) => ({
    tp: `lore:global:${rel}`,
    label: `global → ${rel}`,
    scope: "global" as const,
  }));

  // Series + story scopes
  let topEntries: Deno.DirEntry[] = [];
  try {
    for await (const e of Deno.readDir(playgroundDir)) topEntries.push(e);
  } catch { topEntries = []; }
  for (const seriesEntry of topEntries) {
    if (!seriesEntry.isDirectory) continue;
    const seriesName = seriesEntry.name;
    if (!isValidSegment(seriesName)) continue;
    const seriesPath = `${playgroundDir}/${seriesName}`;
    await walk(`${seriesPath}/_lore`, (rel) => ({
      tp: `lore:series:${seriesName}:${rel}`,
      label: `series (${seriesName}) → ${rel}`,
      scope: "series" as const,
    }));

    let storyEntries: Deno.DirEntry[] = [];
    try {
      for await (const e of Deno.readDir(seriesPath)) storyEntries.push(e);
    } catch { storyEntries = []; }
    for (const storyEntry of storyEntries) {
      if (!storyEntry.isDirectory) continue;
      const storyName = storyEntry.name;
      if (!isValidSegment(storyName)) continue;
      const storyPath = `${seriesPath}/${storyName}`;
      await walk(`${storyPath}/_lore`, (rel) => ({
        tp: `lore:story:${seriesName}:${storyName}:${rel}`,
        label: `story (${seriesName}/${storyName}) → ${rel}`,
        scope: "story" as const,
      }));
    }
  }

  return out;
}

/** Recursively yield absolute paths of `.md` files under `root`. */
async function* walkMd(root: string): AsyncGenerator<string> {
  let entries: Deno.DirEntry[];
  try {
    entries = [];
    for await (const e of Deno.readDir(root)) entries.push(e);
  } catch {
    return;
  }
  for (const e of entries) {
    const full = `${root}/${e.name}`;
    if (e.isDirectory) {
      yield* walkMd(full);
    } else if (e.isFile && e.name.endsWith(".md")) {
      yield full;
    }
  }
}
