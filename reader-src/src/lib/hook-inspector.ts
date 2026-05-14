// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// Pure conflict-detection heuristics for the Hook Inspector. No DOM or
// network access; safe to unit-test in isolation. See `design.md §D9` and
// `hook-inspector/spec.md` for the C1..C4 semantics.

import type {
  ConflictReport,
  HandlerInfo,
  ManifestDeclarations,
  PipelineFieldRef,
} from "@/types";

type StageHandlers = Record<string, readonly HandlerInfo[]>;

/**
 * Enrich frontend introspection (`plugin`, `priority`, `errorCount`) with
 * manifest-declared `reads` / `writes` / `note` per `(plugin, stage)` pair.
 * Unknown stages pass through unchanged.
 */
export function mergeFrontendDeclarations(
  introspect: StageHandlers,
  manifestDeclarations: readonly ManifestDeclarations[],
): StageHandlers {
  const declIndex = new Map<string, { reads?: readonly string[]; writes?: readonly string[]; note?: string }>();
  for (const entry of manifestDeclarations) {
    for (const h of entry.hooks) {
      declIndex.set(`${entry.plugin}::${h.stage}`, {
        reads: h.reads,
        writes: h.writes,
        note: h.note,
      });
    }
  }
  const out: Record<string, HandlerInfo[]> = {};
  for (const [stage, handlers] of Object.entries(introspect)) {
    out[stage] = handlers.map((h) => {
      const key = `${h.plugin ?? ""}::${stage}`;
      const decl = declIndex.get(key);
      return decl ? { ...h, ...decl } : h;
    });
  }
  return out;
}

function isPipelineField(
  stage: string,
  field: string,
  pipelineFields: readonly PipelineFieldRef[],
): boolean {
  return pipelineFields.some((p) => p.stage === stage && p.field === field);
}

/**
 * Detect conflicts across the joined backend + frontend handler graph.
 *
 *   - **C1 multi-write** — two distinct plugins write the same field at the
 *     same stage AND the (stage, field) pair is NOT on the pipeline-fields
 *     allowlist.
 *   - **C2 stale-read** — a reader plugin runs at a lower-numbered priority
 *     than a writer plugin on the same stage and reads a field the writer
 *     writes. Same plugin reader/writer pairs are excluded. The
 *     pipeline-fields allowlist does NOT exempt C2.
 *   - **C3 same-priority** — multiple handlers share the same priority on a
 *     stage (order non-deterministic).
 *   - **C4 runtime-error** — a handler's `errorCount` is > 0.
 */
export function detectConflicts(
  backend: StageHandlers,
  frontend: StageHandlers,
  pipelineFields: readonly PipelineFieldRef[],
): ConflictReport[] {
  const out: ConflictReport[] = [];
  const merged: StageHandlers = { ...backend, ...frontend };

  for (const [stage, rawHandlers] of Object.entries(merged)) {
    const handlers = [...rawHandlers].sort((a, b) => a.priority - b.priority);

    // C1: writers per field
    const writersByField = new Map<string, HandlerInfo[]>();
    for (const h of handlers) {
      for (const f of h.writes ?? []) {
        if (!writersByField.has(f)) writersByField.set(f, []);
        writersByField.get(f)!.push(h);
      }
    }
    for (const [field, writers] of writersByField) {
      const pluginSet = new Set(writers.map((w) => w.plugin).filter(Boolean));
      if (
        pluginSet.size >= 2 && !isPipelineField(stage, field, pipelineFields)
      ) {
        out.push({
          kind: "C1-multi-write",
          stage,
          field,
          plugins: [...pluginSet] as string[],
          message: `Stage '${stage}' field '${field}' written by ${pluginSet.size} plugins outside the pipeline allowlist`,
        });
      }
    }

    // C2: stale-read — reader runs before a writer on same field, different plugin
    for (const reader of handlers) {
      for (const f of reader.reads ?? []) {
        const writersAfter = handlers.filter((w) =>
          w !== reader &&
          (w.writes ?? []).includes(f) &&
          w.priority > reader.priority &&
          w.plugin !== undefined &&
          reader.plugin !== undefined &&
          w.plugin !== reader.plugin
        );
        if (writersAfter.length === 0) continue;
        for (const writer of writersAfter) {
          out.push({
            kind: "C2-stale-read",
            stage,
            field: f,
            plugins: [reader.plugin ?? "", writer.plugin ?? ""].filter(Boolean),
            priorities: [reader.priority, writer.priority],
            message: `Stage '${stage}': '${reader.plugin}' reads '${f}' at priority ${reader.priority} before '${writer.plugin}' writes at priority ${writer.priority}`,
          });
        }
      }
    }

    // C3: same priority across distinct plugins
    const byPriority = new Map<number, HandlerInfo[]>();
    for (const h of handlers) {
      if (!byPriority.has(h.priority)) byPriority.set(h.priority, []);
      byPriority.get(h.priority)!.push(h);
    }
    for (const [priority, group] of byPriority) {
      const plugins = [...new Set(group.map((g) => g.plugin).filter(Boolean))];
      if (plugins.length >= 2) {
        out.push({
          kind: "C3-same-priority",
          stage,
          plugins: plugins as string[],
          priorities: [priority],
          message: `Stage '${stage}': ${plugins.length} plugins share priority ${priority} (order non-deterministic)`,
        });
      }
    }

    // C4: runtime errors
    for (const h of handlers) {
      if (h.errorCount > 0 && h.plugin) {
        out.push({
          kind: "C4-runtime-error",
          stage,
          plugins: [h.plugin],
          message: `Stage '${stage}': handler from '${h.plugin}' has thrown ${h.errorCount} time(s) since last restart`,
        });
      }
    }
  }
  return out;
}
