// Copyright (C) 2025 Jim Chen <Jim@ChenJ.im>, licensed under GPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import type { HookStage, HookHandler } from "../types.ts";

interface HandlerEntry {
  readonly handler: HookHandler;
  readonly priority: number;
}

const VALID_STAGES: ReadonlySet<HookStage> = new Set<HookStage>([
  "prompt-assembly",
  "response-stream",
  "post-response",
  "strip-tags",
]);

export class HookDispatcher {
  #handlers: Map<HookStage, HandlerEntry[]> = new Map();

  /**
   * Register a handler for a given hook stage.
   * @param {HookStage} stage - One of: prompt-assembly, response-stream, post-response, strip-tags
   * @param {function} handler - Async function receiving a context object
   * @param {number} priority - Lower runs first (default 100)
   */
  register(stage: HookStage, handler: HookHandler, priority: number = 100): void {
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
    list.push({ handler, priority });
    list.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Dispatch all handlers for a stage in priority order.
   * Errors in individual handlers are logged but do not stop execution.
   * @param {string} stage
   * @param {object} context - Mutable context passed to each handler
   * @returns {object} The (possibly mutated) context
   */
  async dispatch(stage: HookStage, context: Record<string, unknown>): Promise<Record<string, unknown>> {
    const handlers = this.#handlers.get(stage) || [];
    for (const { handler } of handlers) {
      try {
        await handler(context);
      } catch (err: unknown) {
        console.error(`Hook error in stage '${stage}':`, err instanceof Error ? err.message : String(err));
      }
    }
    return context;
  }
}
