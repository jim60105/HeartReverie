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
import { errorMessage, problemJson } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import {
  lintTemplate,
  type TemplateKind,
} from "../lib/template-lint.ts";
import {
  type FixtureBag,
  loadDefaultFixture,
  type PreviewArgs,
  renderSystemPromptForPreview,
} from "../lib/template-preview.ts";
import { parseTemplatePath } from "./templates-path.ts";

const log = createLogger("template");

export function registerTemplateValidateRoutes(app: Hono, deps: AppDeps): void {
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
}
