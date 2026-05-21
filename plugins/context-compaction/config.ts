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

import { errorMessage } from "../../writer/lib/errors.ts";
import { join } from "@std/path";
import { parse as parseYaml } from "@std/yaml";

/** Compaction configuration. */
export interface CompactionConfig {
  /** Number of recent chapters to keep as full text (L2 window). */
  recentChapters: number;
  /** Whether compaction is enabled. */
  enabled: boolean;
}

export const DEFAULTS: CompactionConfig = {
  recentChapters: 3,
  enabled: true,
};

const CONFIG_FILENAME = "compaction-config.yaml";
const PLUGIN_NAME = "context-compaction";
const PLUGIN_SETTINGS_FILENAME = "config.json";

/** Optional warning sink so the caller can surface malformed settings files. */
export interface LoadCompactionConfigOptions {
  /** Called once with a human-readable message when the plugin-settings JSON is unreadable/malformed. */
  onWarn?: (message: string, detail?: Record<string, unknown>) => void;
}

/**
 * Load compaction configuration with the following precedence (highest first):
 *   1. Story-level YAML (`{storyDir}/compaction-config.yaml`)
 *   2. Series-level YAML (`{playgroundDir}/{series}/compaction-config.yaml`)
 *      — story XOR series: if story-level YAML exists, series-level is NOT consulted.
 *   3. Engine-managed plugin settings (`{playgroundDir}/_plugins/context-compaction/config.json`)
 *   4. Built-in defaults.
 *
 * Plugin settings sit under the chosen YAML and fill in fields the YAML omits via field-level merge.
 * Each layer is sanitised (drop fields that fail type/range checks) so the next-lower layer fills in.
 *
 * @param storyDir - Absolute path to `playground/{series}/{name}/`
 * @param series - Series name, used to derive series-level config path
 * @param playgroundDir - Absolute path to `playground/`
 * @param options - Optional callbacks (e.g. warn sink for malformed plugin settings)
 */
export async function loadCompactionConfig(
  storyDir: string,
  series: string,
  playgroundDir: string,
  options: LoadCompactionConfigOptions = {},
): Promise<CompactionConfig> {
  const chosenYaml = await loadChosenYaml(storyDir, series, playgroundDir);
  const pluginSettings = await loadPluginSettings(playgroundDir, options.onWarn);

  return {
    ...DEFAULTS,
    ...sanitize(pluginSettings),
    ...sanitize(chosenYaml ?? {}),
  };
}

/**
 * Choose the YAML layer: story-level if present, else series-level if present, else null.
 * Story XOR series semantics — they are NEVER merged together.
 */
async function loadChosenYaml(
  storyDir: string,
  series: string,
  playgroundDir: string,
): Promise<Record<string, unknown> | null> {
  const storyConfig = await tryReadYaml(join(storyDir, CONFIG_FILENAME));
  if (storyConfig !== null) return storyConfig;

  const seriesConfig = await tryReadYaml(join(playgroundDir, series, CONFIG_FILENAME));
  if (seriesConfig !== null) return seriesConfig;

  return null;
}

/**
 * Read engine-managed plugin settings from `{playgroundDir}/_plugins/context-compaction/config.json`.
 * Missing file → empty layer (silent). Malformed JSON or unreadable file → empty layer + warn callback.
 */
async function loadPluginSettings(
  playgroundDir: string,
  onWarn?: (message: string, detail?: Record<string, unknown>) => void,
): Promise<Record<string, unknown>> {
  const settingsPath = join(playgroundDir, "_plugins", PLUGIN_NAME, PLUGIN_SETTINGS_FILENAME);
  let text: string;
  try {
    text = await Deno.readTextFile(settingsPath);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) {
      return {};
    }
    onWarn?.("Failed to read context-compaction plugin settings file", {
      path: settingsPath,
      error: errorMessage(err),
    });
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    onWarn?.("context-compaction plugin settings file is not a JSON object", { path: settingsPath });
    return {};
  } catch (err) {
    onWarn?.("context-compaction plugin settings file is not valid JSON", {
      path: settingsPath,
      error: errorMessage(err),
    });
    return {};
  }
}

/**
 * Sanitise a Partial<CompactionConfig>: drop fields whose values fail validation
 * (non-positive integer for `recentChapters`, non-boolean for `enabled`).
 * The dropped field is then filled in by the next-lower layer in the merge chain.
 */
function sanitize(raw: Record<string, unknown>): Partial<CompactionConfig> {
  const result: Partial<CompactionConfig> = {};
  if (Number.isSafeInteger(raw.recentChapters) && (raw.recentChapters as number) > 0) {
    result.recentChapters = raw.recentChapters as number;
  }
  if (typeof raw.enabled === "boolean") {
    result.enabled = raw.enabled;
  }
  return result;
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
