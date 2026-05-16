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

import type { Hono } from "@hono/hono";
import type { HookDispatcher, DispatchMetric } from "../lib/hooks.ts";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Mount debug hook endpoints at `/api/_debug/hooks` and
 * `/api/_debug/hooks/stream`. Both sit under `/api/*` so they inherit
 * the passphrase middleware configured in `app.ts`.
 */
export function registerDebugHookRoutes(
  app: Hono,
  dispatcher: HookDispatcher,
): void {
  // ── GET /api/_debug/hooks — aggregate stats over ring buffer ───
  app.get("/api/_debug/hooks", (c) => {
    const buffer = dispatcher.getMetricsBuffer();

    const perStage: Record<
      string,
      { count: number; avgMs: number; p50Ms: number; p95Ms: number; serialCount: number; parallelCount: number }
    > = {};
    const perPlugin: Record<
      string,
      { cumulativeMs: number; dispatchCount: number; errorCount: number }
    > = {};

    // Group metrics by stage
    const stageGroups = new Map<string, DispatchMetric[]>();
    for (const m of buffer) {
      let group = stageGroups.get(m.stage);
      if (!group) {
        group = [];
        stageGroups.set(m.stage, group);
      }
      group.push(m);
    }

    for (const [stage, metrics] of stageGroups) {
      const durations = metrics.map((m) => m.durationMs).sort((a, b) => a - b);
      const count = durations.length;
      const avgMs =
        Math.round(
          (durations.reduce((s, d) => s + d, 0) / count) * 100,
        ) / 100;
      const p50Ms = durations[Math.floor(count * 0.5)] ?? 0;
      const p95Ms = durations[Math.floor(count * 0.95)] ?? 0;
      const serialCount = metrics.reduce((s, m) => s + m.serialCount, 0);
      const parallelCount = metrics.reduce((s, m) => s + m.parallelCount, 0);
      perStage[stage] = { count, avgMs, p50Ms, p95Ms, serialCount, parallelCount };
    }

    // Aggregate per-plugin stats across all metrics
    for (const m of buffer) {
      for (const p of m.plugins) {
        let entry = perPlugin[p.plugin];
        if (!entry) {
          entry = { cumulativeMs: 0, dispatchCount: 0, errorCount: 0 };
          perPlugin[p.plugin] = entry;
        }
        entry.cumulativeMs += p.durationMs;
        entry.dispatchCount++;
        if (p.errored) entry.errorCount++;
      }
    }

    return c.json({
      perStage,
      perPlugin,
      windowSize: buffer.length,
      observerSubscribers: dispatcher.getHandlerEventSubscribers(),
    });
  });

  // ── GET /api/_debug/hooks/stream — SSE per-dispatch events ─────
  app.get("/api/_debug/hooks/stream", (c) => {
    const abortSignal = c.req.raw.signal;

    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();

        const enqueue = (text: string) => {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            // Stream already closed — cleanup will happen via abort handler
          }
        };

        // SSE subscriber: forward each dispatch metric as an event
        const onMetric = (metric: DispatchMetric) => {
          const payload: Record<string, unknown> = {
            stage: metric.stage,
            dispatchPhase: metric.dispatchPhase,
            durationMs: metric.durationMs,
            serialCount: metric.serialCount,
            parallelCount: metric.parallelCount,
            plugins: metric.plugins,
          };
          enqueue(`data: ${JSON.stringify(payload)}\n\n`);
        };

        // Heartbeat: keep-alive comment every 30 s
        const heartbeat = setInterval(() => {
          enqueue(":\n\n");
        }, HEARTBEAT_INTERVAL_MS);

        const cleanup = () => {
          clearInterval(heartbeat);
          dispatcher.unsubscribeSSE(onMetric);
          try {
            controller.close();
          } catch {
            // Already closed
          }
        };

        // Detect client disconnect via AbortSignal
        if (abortSignal.aborted) {
          cleanup();
          return;
        }
        abortSignal.addEventListener("abort", cleanup, { once: true });

        dispatcher.subscribeSSE(onMetric);
      },
    });

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  });
}
