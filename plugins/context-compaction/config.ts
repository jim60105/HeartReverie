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

import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

/** Compaction configuration. */
export interface CompactionConfig {
  /** Number of recent chapters to keep as full text (L2 window). */
  recentChapters: number;
  /** Whether compaction is enabled. */
  enabled: boolean;
}

const DEFAULTS: CompactionConfig = {
  recentChapters: 3,
  enabled: true,
};

const CONFIG_FILENAME = "compaction-config.yaml";

/**
 * Load compaction configuration with story-level > series-level > defaults precedence.
 * @param storyDir - Absolute path to `playground/{series}/{name}/`
 * @param series - Series name, used to derive series-level config path
 * @param playgroundDir - Absolute path to `playground/`
 */
export async function loadCompactionConfig(
  storyDir: string,
  series: string,
  playgroundDir: string,
): Promise<CompactionConfig> {
  // Story-level config
  const storyConfig = await tryReadYaml(join(storyDir, CONFIG_FILENAME));
  if (storyConfig !== null) {
    return mergeConfig(storyConfig);
  }

  // Series-level config
  const seriesConfig = await tryReadYaml(join(playgroundDir, series, CONFIG_FILENAME));
  if (seriesConfig !== null) {
    return mergeConfig(seriesConfig);
  }

  return { ...DEFAULTS };
}

function mergeConfig(raw: Record<string, unknown>): CompactionConfig {
  return {
    recentChapters:
      typeof raw.recentChapters === "number" && raw.recentChapters > 0
        ? Math.floor(raw.recentChapters)
        : DEFAULTS.recentChapters,
    enabled:
      typeof raw.enabled === "boolean" ? raw.enabled : DEFAULTS.enabled,
  };
}

async function tryReadYaml(
  path: string,
): Promise<Record<string, unknown> | null> {
  try {
    const text = await Deno.readTextFile(path);
    const parsed = parseYaml(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
