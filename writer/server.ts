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

// Load .env from project root; silently skip if missing
import "@std/dotenv/load";

import * as config from "./lib/config.ts";
import { HookDispatcher } from "./lib/hooks.ts";
import { PluginManager } from "./lib/plugin-manager.ts";
import { createSafePath, verifyPassphrase } from "./lib/middleware.ts";
import { createTemplateEngine } from "./lib/template.ts";
import { createStoryEngine } from "./lib/story.ts";
import { createApp } from "./app.ts";

const certFile = config.CERT_FILE;
const keyFile = config.KEY_FILE;
if (!certFile || !keyFile) {
  console.error("❌ CERT_FILE and KEY_FILE environment variables are required");
  Deno.exit(1);
}

if (!Deno.env.get("OPENROUTER_API_KEY")) {
  console.warn("⚠️  OPENROUTER_API_KEY is not set — chat functionality will not work");
}

// ── Plugin system ───────────────────────────────────────────────
const hookDispatcher = new HookDispatcher();
const pluginManager = new PluginManager(config.PLUGINS_DIR, Deno.env.get("PLUGIN_DIR"), hookDispatcher);
await pluginManager.init();

// ── Build dependency graph ──────────────────────────────────────
const safePath = createSafePath(config.PLAYGROUND_DIR);
const { renderSystemPrompt } = createTemplateEngine(pluginManager, safePath);
const { buildPromptFromStory } = createStoryEngine(pluginManager, safePath, renderSystemPrompt);

const app = createApp({
  config,
  safePath,
  pluginManager,
  hookDispatcher,
  buildPromptFromStory,
  verifyPassphrase,
});

// ── Start HTTPS server ──────────────────────────────────────────
Deno.serve({
  port: config.PORT,
  hostname: "0.0.0.0",
  cert: Deno.readTextFileSync(certFile),
  key: Deno.readTextFileSync(keyFile),
  onListen({ port }) {
    console.log(`✅ HTTPS server listening on https://localhost:${port}`);
    console.log(`   Reader: ${config.READER_DIR}`);
    console.log(`   Playground: ${config.PLAYGROUND_DIR}`);
  },
}, (req, info) => app.fetch(req, info));
