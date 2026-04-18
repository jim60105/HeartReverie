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

import type { PluginRegisterContext } from "../../writer/types.ts";
import type { Logger } from "../../writer/lib/logger.ts";
import { loadCompactionConfig } from "./config.ts";
import { compactContext } from "./compactor.ts";
import { dirname } from "@std/path";

/**
 * Register the prompt-assembly hook for context compaction.
 */
export function register({ hooks, logger }: PluginRegisterContext): void {
  logger.info("Registering context compaction plugin");

  hooks.register("prompt-assembly", async (context) => {
    const log = (context.logger as Logger | undefined) ?? logger;
    const previousContext = context.previousContext as string[];
    const rawChapters = context.rawChapters as string[];
    const storyDir = context.storyDir as string;
    const series = context.series as string;

    if (!previousContext || !rawChapters || previousContext.length === 0) {
      log.debug("Skipping compaction: no context to compact", { chapters: rawChapters?.length ?? 0 });
      return;
    }

    // Derive playground dir from storyDir (playground/{series}/{name}/)
    const playgroundDir = dirname(dirname(storyDir));

    const config = await loadCompactionConfig(storyDir, series, playgroundDir);

    if (!config.enabled) {
      log.debug("Context compaction disabled by config", { storyDir, series });
      return;
    }

    log.debug("Compacting context", {
      contextEntries: previousContext.length,
      rawChapters: rawChapters.length,
      recentChapters: config.recentChapters,
    });

    const compacted = compactContext(previousContext, rawChapters, config);

    // Only replace in-place if compaction produced a different array
    if (compacted !== previousContext) {
      const removedCount = previousContext.length - compacted.length;
      previousContext.length = 0;
      previousContext.push(...compacted);
      log.info("Context compacted", {
        originalEntries: previousContext.length + removedCount,
        compactedEntries: compacted.length,
        removedEntries: removedCount,
      });
    } else {
      log.debug("No compaction needed", { contextEntries: previousContext.length });
    }
  }, 100);
}
