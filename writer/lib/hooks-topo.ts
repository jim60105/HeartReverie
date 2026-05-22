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

import type { HookHandler, HookStage } from "../types.ts";
import type { Logger } from "./logger.ts";

/**
 * Internal handler record stored by `HookDispatcher` per stage. Exposed
 * here so the topological-sort helper can be a free function operating
 * over the same shape without depending on the dispatcher class.
 */
export interface HandlerEntry {
  readonly handler: HookHandler;
  readonly priority: number;
  readonly plugin?: string;
  readonly baseLogger?: Logger;
  readonly parallel: boolean;
  readonly readOnly: boolean;
  readonly concurrency?: number;
  readonly dependsOn?: readonly string[];
  errorCount: number;
}

/**
 * Compute topological layers for a parallel bucket honouring `dependsOn`.
 * Each layer is a set of handlers with no remaining incoming edges; layers
 * execute serially while members of a layer run concurrently (subject to
 * the dispatcher's concurrency chunking).
 *
 * Returns `[parallel]` (a single priority-ordered layer) when:
 * - no entry declares `dependsOn`, OR
 * - any `dependsOn` references an unknown plugin within the same bucket, OR
 * - a dependency cycle is detected.
 *
 * In the unknown-plugin and cycle cases an error is logged via `log` for
 * operator visibility. The dispatcher still proceeds with priority-only
 * ordering — failing closed would silently drop handlers.
 */
export function computeTopoLayers(
  parallel: HandlerEntry[],
  log: Logger,
  stage?: HookStage,
): HandlerEntry[][] {
  // Check if any entry actually has dependsOn
  const hasDeps = parallel.some((e) => e.dependsOn && e.dependsOn.length > 0);
  if (!hasDeps) return [parallel]; // already priority-sorted

  // Build name → entry map (by plugin name within this bucket)
  const byPlugin = new Map<string, HandlerEntry>();
  for (const e of parallel) {
    if (e.plugin) byPlugin.set(e.plugin, e);
  }

  // Validate all dependsOn references
  for (const e of parallel) {
    if (!e.dependsOn) continue;
    for (const dep of e.dependsOn) {
      if (!byPlugin.has(dep)) {
        log.error("dependsOn references unknown plugin; falling back to priority-only", {
          plugin: e.plugin, unknownDep: dep, stage,
        });
        return [parallel];
      }
    }
  }

  // Compute in-degree map
  const inDegree = new Map<HandlerEntry, number>();
  const successors = new Map<HandlerEntry, HandlerEntry[]>();
  for (const e of parallel) {
    inDegree.set(e, 0);
    successors.set(e, []);
  }
  for (const e of parallel) {
    if (!e.dependsOn) continue;
    for (const dep of e.dependsOn) {
      const depEntry = byPlugin.get(dep)!;
      successors.get(depEntry)!.push(e);
      inDegree.set(e, (inDegree.get(e) ?? 0) + 1);
    }
  }

  // Kahn's algorithm — produce layers
  const layers: HandlerEntry[][] = [];
  const remaining = new Set(parallel);

  while (remaining.size > 0) {
    const layer: HandlerEntry[] = [];
    for (const e of remaining) {
      if ((inDegree.get(e) ?? 0) === 0) layer.push(e);
    }
    if (layer.length === 0) {
      // Cycle detected — fall back to priority-only
      const cyclePlugins = [...remaining].map(e => e.plugin).filter(Boolean);
      log.error("dependsOn cycle detected in parallel bucket; falling back to priority-only", {
        plugins: cyclePlugins, stage,
      });
      return [parallel];
    }
    layer.sort((a, b) => a.priority - b.priority);
    layers.push(layer);

    for (const e of layer) {
      remaining.delete(e);
      for (const s of successors.get(e) ?? []) {
        inDegree.set(s, (inDegree.get(s) ?? 0) - 1);
      }
    }
  }

  return layers;
}
