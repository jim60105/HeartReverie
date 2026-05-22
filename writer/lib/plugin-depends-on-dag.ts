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

/**
 * Validates the `dependsOn` DAG declared by plugin manifests for every
 * parallel-allowed hook stage. Performs two checks per stage:
 *
 *   1. Unknown-plugin reference: every `dependsOn[i]` must name a plugin
 *      that also declares the same stage.
 *   2. Acyclicity: the directed graph (dep → plugin) must be a DAG. Cycle
 *      detection uses Kahn's topological sort.
 *
 * If either check fails for a stage, ALL `dependsOn` declarations for that
 * stage are stripped from the in-memory manifests (mutating
 * `entry.manifest.hooks[i].dependsOn` to `undefined`). This is intentional:
 * a broken DAG is unsafe to dispatch with, so we degrade the stage to
 * sequential-respecting-priority rather than guess intent.
 *
 * Extracted from {@link PluginManager} so the algorithm can be reasoned
 * about independently of plugin discovery. Operates on a `ReadonlyMap` of
 * already-discovered plugins; the function performs no I/O and reaches
 * back to the live `#plugins` map only via the supplied reference.
 */

import { PARALLEL_ALLOWED } from "./hooks.ts";
import { createLogger } from "./logger.ts";
import type { PluginManifest } from "../types.ts";

const log = createLogger("plugin");

export interface DependsOnDagEntry {
  readonly manifest: PluginManifest;
}

export function validateDependsOnDAG(
  plugins: ReadonlyMap<string, DependsOnDagEntry>,
): void {
  // Collect hook declarations per stage across all plugins
  for (const stage of PARALLEL_ALLOWED) {
    const edges = new Map<string, string[]>(); // plugin → dependsOn[]
    const knownPlugins = new Set<string>(); // all plugins declaring this stage

    for (const [pluginName, entry] of plugins) {
      if (!Array.isArray(entry.manifest.hooks)) continue;
      for (const h of entry.manifest.hooks) {
        const decl = h as Record<string, unknown>;
        if (decl.stage !== stage) continue;
        knownPlugins.add(pluginName);
        const deps = decl.dependsOn as string[] | undefined;
        if (deps?.length) {
          edges.set(pluginName, [...deps]);
        }
      }
    }

    if (edges.size === 0) continue;

    // Check for unknown plugin references
    let invalid = false;
    for (const [plugin, deps] of edges) {
      for (const dep of deps) {
        if (!knownPlugins.has(dep)) {
          log.error(
            "Plugin manifest: dependsOn references unknown plugin",
            { plugin, stage, unknownDep: dep },
          );
          invalid = true;
        }
      }
    }

    // Check for cycles using Kahn's algorithm (topological sort)
    if (!invalid) {
      // In dependsOn semantics, "A dependsOn B" means A must run AFTER B,
      // so the edge is B → A. For Kahn's, count in-degree of each node
      // where edges point TO the node. Edge direction =
      // dependsOn[i] → plugin (dep must finish first).
      const adj = new Map<string, string[]>();
      const deg = new Map<string, number>();
      for (const node of knownPlugins) {
        adj.set(node, []);
        deg.set(node, 0);
      }
      for (const [plugin, deps] of edges) {
        for (const dep of deps) {
          if (adj.has(dep)) {
            adj.get(dep)!.push(plugin);
            deg.set(plugin, (deg.get(plugin) ?? 0) + 1);
          }
        }
      }

      const queue: string[] = [];
      for (const [node, d] of deg) {
        if (d === 0) queue.push(node);
      }
      let processed = 0;
      while (queue.length > 0) {
        const node = queue.shift()!;
        processed++;
        for (const neighbor of adj.get(node) ?? []) {
          const newDeg = (deg.get(neighbor) ?? 1) - 1;
          deg.set(neighbor, newDeg);
          if (newDeg === 0) queue.push(neighbor);
        }
      }

      if (processed < knownPlugins.size) {
        const cyclePlugins = [...deg.entries()]
          .filter(([, d]) => d > 0)
          .map(([n]) => n);
        log.error(
          "Plugin manifest: dependsOn cycle detected",
          { stage, involvedPlugins: cyclePlugins },
        );
        invalid = true;
      }
    }

    // Drop ALL dependsOn for this stage if invalid
    if (invalid) {
      for (const [, entry] of plugins) {
        if (!Array.isArray(entry.manifest.hooks)) continue;
        for (const h of entry.manifest.hooks) {
          const decl = h as Record<string, unknown>;
          if (decl.stage === stage) {
            decl.dependsOn = undefined;
          }
        }
      }
      log.warn(
        "Plugin manifest: all dependsOn for stage dropped due to invalid DAG",
        { stage },
      );
    }
  }
}
