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

import type { HookStage, HookHandler } from "../types.ts";
import { createLogger } from "./logger.ts";
import type { Logger } from "./logger.ts";

const log = createLogger("plugin");

interface HandlerEntry {
  readonly handler: HookHandler;
  readonly priority: number;
  readonly plugin?: string;
  readonly baseLogger?: Logger;
}

const VALID_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "prompt-assembly",
  "response-stream",
  "pre-write",
  "post-response",
  "strip-tags",
]);

export class HookDispatcher {
  #handlers: Map<HookStage, HandlerEntry[]> = new Map();

  /**
   * Register a handler for a given hook stage.
   * @param {HookStage} stage - One of: prompt-assembly, response-stream, pre-write, post-response, strip-tags
   * @param {function} handler - Async function receiving a context object
   * @param {number} priority - Lower runs first (default 100)
   * @param {string} plugin - Optional plugin name for logger scoping
   * @param {Logger} baseLogger - Optional plugin logger to derive request-scoped loggers from
   */
  register(stage: HookStage, handler: HookHandler, priority: number = 100, plugin?: string, baseLogger?: Logger): void {
    if (!VALID_STAGES.has(stage)) {
      throw new Error(
        `Invalid hook stage '${stage}'. Valid stages: ${[...VALID_STAGES].join(", ")}`
      );
    }
    if (typeof handler !== "function") {
      throw new Error("Hook handler must be a function");
    }

    if (!this.#handlers.has(stage)) this.#handlers.set(stage, []);
    const list = this.#handlers.get(stage)!;
    list.push({ handler, priority, plugin, baseLogger });
    list.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Dispatch all handlers for a stage in priority order.
   * A logger is always injected as context.logger for each handler. When the
   * context contains a correlationId, it is bound to the logger. If the handler
   * has a baseLogger, the request logger is derived from it (preserving all
   * baseData). Otherwise a fresh logger is created with the plugin name.
   * Errors in individual handlers are logged but do not stop execution.
   * @param {string} stage
   * @param {object} context - Mutable context passed to each handler
   * @returns {object} The (possibly mutated) context
   */
  async dispatch(stage: HookStage, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const handlers = this.#handlers.get(stage) || [];
    const correlationId = typeof context.correlationId === "string" ? context.correlationId : undefined;
    const startTime = performance.now();
    for (const { handler, plugin, baseLogger } of handlers) {
      try {
        // Always inject context.logger for each handler
        if (baseLogger) {
          // Derive from plugin's logger — preserves all existing baseData
          context.logger = (correlationId
            ? baseLogger.withContext({ correlationId })
            : baseLogger) as unknown;
        } else {
          const baseData: Record<string, unknown> = {};
          if (plugin) baseData.plugin = plugin;
          context.logger = createLogger("plugin", { ...(correlationId ? { correlationId } : {}), baseData }) as unknown;
        }
        await handler(context);
      } catch (err: unknown) {
        log.error(`Hook error in stage '${stage}'`, {
          stage,
          plugin,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const latencyMs = Math.round(performance.now() - startTime);
    log.debug(`Hook dispatch completed`, {
      stage,
      handlerCount: handlers.length,
      latencyMs,
    });
    return context;
  }
}
