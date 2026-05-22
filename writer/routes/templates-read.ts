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
  buildVariableCatalog,
  type TemplateKind,
} from "../lib/template-lint.ts";
import { parseTemplatePath, resolveTemplatePath } from "./templates-path.ts";
import { enumerateAllLore } from "./templates-lore-enum.ts";

const log = createLogger("template");

export function registerTemplateReadRoutes(app: Hono, deps: AppDeps): void {
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
}
