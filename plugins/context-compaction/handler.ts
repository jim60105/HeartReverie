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

import type { HookDispatcher } from "../../writer/lib/hooks.ts";
import { loadCompactionConfig } from "./config.ts";
import { compactContext } from "./compactor.ts";
import { dirname } from "@std/path";

/**
 * Register the prompt-assembly hook for context compaction.
 */
export function register(hookDispatcher: HookDispatcher): void {
  hookDispatcher.register("prompt-assembly", async (context) => {
    const previousContext = context.previousContext as string[];
    const rawChapters = context.rawChapters as string[];
    const storyDir = context.storyDir as string;
    const series = context.series as string;

    if (!previousContext || !rawChapters || previousContext.length === 0) {
      return;
    }

    // Derive playground dir from storyDir (playground/{series}/{name}/)
    const playgroundDir = dirname(dirname(storyDir));

    const config = await loadCompactionConfig(storyDir, series, playgroundDir);

    if (!config.enabled) {
      return;
    }

    const compacted = compactContext(previousContext, rawChapters, config);

    // Only replace in-place if compaction produced a different array
    if (compacted !== previousContext) {
      previousContext.length = 0;
      previousContext.push(...compacted);
    }
  }, 100);
}
