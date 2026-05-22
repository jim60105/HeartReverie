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

import type { Hono } from "@hono/hono";
import type { AppDeps } from "../types.ts";
import { problemJson, errorMessage } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import { validateTemplate } from "../lib/template.ts";
import {
  atomicWriteWithBackup,
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
import {
  parseTemplatePath,
  resolveTemplatePath,
  parentDir,
} from "./templates-path.ts";
import { withWriteMutex } from "./templates-write-mutex.ts";
import { enumerateAllLore } from "./templates-lore-enum.ts";

const log = createLogger("template");

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

