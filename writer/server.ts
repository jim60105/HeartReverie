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

// Load .env from project root; silently skip if missing
import "@std/dotenv/load";

import * as config from "./lib/config.ts";
import { initLogger, createLogger, closeLogger } from "./lib/logger.ts";
import { HookDispatcher } from "./lib/hooks.ts";
import { PluginManager } from "./lib/plugin-manager.ts";
import { createSafePath, verifyPassphrase } from "./lib/middleware.ts";
import { createTemplateEngine } from "./lib/template.ts";
import { createStoryEngine } from "./lib/story.ts";
import { loadThemes } from "./lib/themes.ts";
import { createApp } from "./app.ts";

// ── Initialize logger first ────────────────────────────────────
await initLogger();
const log = createLogger("system");

if (!Deno.env.get("LLM_API_KEY")) {
  log.warn("LLM_API_KEY is not set — chat functionality will not work");
}

// ── Plugin system ───────────────────────────────────────────────
const hookDispatcher = new HookDispatcher();
const pluginManager = new PluginManager(config.PLUGINS_DIR, Deno.env.get("PLUGIN_DIR"), hookDispatcher);
await pluginManager.init();

// ── Theme system ────────────────────────────────────────────────
await loadThemes(config.THEME_DIR);

// ── Build dependency graph ──────────────────────────────────────
const safePath = createSafePath(config.PLAYGROUND_DIR);
const { renderSystemPrompt } = createTemplateEngine(pluginManager);
const { buildPromptFromStory, buildContinuePromptFromStory } = createStoryEngine(pluginManager, safePath, renderSystemPrompt, hookDispatcher);

const app = createApp({
  config,
  safePath,
  pluginManager,
  hookDispatcher,
  buildPromptFromStory,
  buildContinuePromptFromStory,
  verifyPassphrase,
});

// ── Start server (plain HTTP only — TLS is the operator's job) ──
const serveOptions: Deno.ServeTcpOptions = {
  port: config.PORT,
  hostname: "::",
  onListen({ port }) {
    log.info(`HTTP server listening on http://localhost:${port}`, {
      port,
      readerDir: config.READER_DIR,
      playgroundDir: config.PLAYGROUND_DIR,
    });
  },
};

Deno.serve(serveOptions, (req, info) => app.fetch(req, info));

// ── Graceful shutdown: flush log file on SIGINT/SIGTERM ─────────
const shutdown = async () => {
  log.info("Shutdown signal received — flushing logs");
  await closeLogger();
  Deno.exit(0);
};
Deno.addSignalListener("SIGINT", shutdown);
Deno.addSignalListener("SIGTERM", shutdown);
