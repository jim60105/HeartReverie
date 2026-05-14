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

// Hook introspection CLI: boots a minimal PluginManager (no HTTP server,
// no LLM I/O), dumps the introspection payload to stdout as JSON, then exits.
// Intended for CI usage (`deno task introspect:hooks`).

import "@std/dotenv/load";

import * as config from "../writer/lib/config.ts";
import { initLogger, closeLogger } from "../writer/lib/logger.ts";
import { HookDispatcher } from "../writer/lib/hooks.ts";
import { PluginManager } from "../writer/lib/plugin-manager.ts";
import { buildIntrospectionDump } from "../writer/lib/introspection-dump.ts";

await initLogger({ level: "error" });
try {
  const hookDispatcher = new HookDispatcher();
  const pluginManager = new PluginManager(
    config.PLUGINS_DIR,
    Deno.env.get("PLUGIN_DIR"),
    hookDispatcher,
    config.PLAYGROUND_DIR,
  );
  await pluginManager.init();

  const dump = buildIntrospectionDump(pluginManager, hookDispatcher);
  // Guard: never log the passphrase or other env values to stdout.
  // The dump object contains only manifest metadata + hook registrations.
  console.log(JSON.stringify(dump, null, 2));
  Deno.exit(0);
} finally {
  await closeLogger();
}
