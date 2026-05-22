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
 * Plugin-action HTTP route + shared runner.
 *
 * `runPluginActionWithDeps` is the single core runner used by both the
 * Hono route below and the WebSocket handler. It coordinates three
 * focused phases that live in sibling modules:
 *
 *  - {@link "./plugin-actions-preflight.ts"} — all pre-lock validation
 *    (plugin gate, input shape, prompt-file read, LLM config, API key).
 *  - lock acquisition via `tryMarkGenerationActive` — short-circuits to
 *    409 when another generation is in flight.
 *  - {@link "./plugin-actions-execute.ts"} — under-lock execution (Vento
 *    render, `streamLlmAndPersist`, response shaping).
 *
 * The coordinator catch translates `ChatError` / `ChatAbortError` thrown
 * by the execute phase. The `finally` always releases the lock.
 */

import type { Hono } from "@hono/hono";
import {
  errorMessage,
  pluginActionProblems,
  problemJson,
} from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import {
  clearGenerationActive,
  tryMarkGenerationActive,
} from "../lib/generation-registry.ts";
import { ChatAbortError, ChatError } from "../lib/chat-shared.ts";
import type { AppDeps } from "../types.ts";
import type {
  PluginActionOutcome,
  PluginActionRequestArgs,
} from "./plugin-actions-shared.ts";
import { runPreflight } from "./plugin-actions-preflight.ts";
import { runUnderLock } from "./plugin-actions-execute.ts";

export type { PluginActionOutcome, PluginActionRequestArgs };

const log = createLogger("plugin");

/**
 * Internal core runner shared by both the HTTP route and the WebSocket
 * handler. Performs all validation, acquires the per-story generation lock,
 * calls `streamLlmAndPersist` with the right `WriteMode`, and returns a
 * discriminated outcome.
 */
export async function runPluginActionWithDeps(
  args: PluginActionRequestArgs,
  deps: Pick<
    AppDeps,
    | "config"
    | "safePath"
    | "hookDispatcher"
    | "pluginManager"
    | "buildPromptFromStory"
  >,
): Promise<PluginActionOutcome> {
  const preflight = await runPreflight(args, deps);
  if (!preflight.ok) return preflight.outcome;
  const { ctx } = preflight;

  // Acquire the per-story generation lock atomically BEFORE prompt render so
  // that replace mode can safely read the on-disk chapter under the lock and
  // inject it as the `draft` variable. For non-replace modes, the lock just
  // happens slightly earlier than before — semantically identical (the lock
  // is held for the entire LLM call regardless).
  if (!tryMarkGenerationActive(ctx.validSeries, ctx.validStory)) {
    return {
      ok: false,
      aborted: false,
      problem: pluginActionProblems.concurrentGeneration(),
      status: 409,
    };
  }

  try {
    return await runUnderLock(args, deps, ctx);
  } catch (err) {
    if (err instanceof ChatAbortError) {
      return { ok: false, aborted: true };
    }
    if (err instanceof ChatError) {
      log.error("Plugin action chat error", {
        plugin: args.pluginName,
        code: err.code,
        httpStatus: err.httpStatus,
        detail: err.message,
        ventoError: err.ventoError,
      });
      if (err.code === "no-chapter") {
        return {
          ok: false,
          aborted: false,
          problem: pluginActionProblems.noChapter(err.message),
          status: 400,
        };
      }
      return {
        ok: false,
        aborted: false,
        problem: problemJson("Bad Gateway", err.httpStatus, err.message),
        status: err.httpStatus,
      };
    }
    const detail = errorMessage(err);
    log.error("Plugin action failed", {
      plugin: args.pluginName,
      error: detail,
    });
    return {
      ok: false,
      aborted: false,
      problem: problemJson(
        "Internal Server Error",
        500,
        "Plugin action failed",
      ),
      status: 500,
    };
  } finally {
    clearGenerationActive(ctx.validSeries, ctx.validStory);
  }
}

/**
 * Register `POST /api/plugins/:pluginName/run-prompt` on the Hono app.
 */
export function registerPluginActionRoutes(
  app: Hono,
  deps: Pick<
    AppDeps,
    | "config"
    | "safePath"
    | "hookDispatcher"
    | "pluginManager"
    | "buildPromptFromStory"
  >,
): void {
  app.post("/api/plugins/:pluginName/run-prompt", async (c) => {
    const pluginName = c.req.param("pluginName") ?? "";
    let body: Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch (err: unknown) {
      log.warn(
        `[POST /api/plugins/run-prompt] Malformed request body: ${
          errorMessage(err)
        }`,
      );
      return c.json(
        problemJson("Bad Request", 400, "Invalid JSON in request body"),
        400,
      );
    }
    const controller = new AbortController();
    // Tie the AbortController to the request's underlying connection.
    const reqSignal = c.req.raw.signal;
    if (reqSignal) {
      if (reqSignal.aborted) controller.abort();
      else {
        reqSignal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }
    }

    // Reject early when both `append` and `replace` are explicitly true so the
    // caller gets a clean RFC 9457 problem instead of an ambiguous mode
    // string. The body→mode translation below picks `append` if both are set,
    // but we want to refuse rather than silently prefer one.
    const wantAppend = body.append === true;
    const wantReplace = body.replace === true;
    if (wantAppend && wantReplace) {
      return c.json(pluginActionProblems.invalidReplaceCombo(), 400);
    }
    if (wantReplace && body.appendTag !== undefined) {
      return c.json(
        pluginActionProblems.invalidReplaceCombo(
          "replace mode cannot be combined with appendTag",
        ),
        400,
      );
    }
    const resolvedMode = wantAppend
      ? "append-to-existing-chapter"
      : wantReplace
      ? "replace-last-chapter"
      : "discard";

    const outcome = await runPluginActionWithDeps(
      {
        pluginName,
        series: body.series,
        story: body.name,
        promptPath: body.promptFile,
        mode: resolvedMode,
        appendTag: body.appendTag,
        replace: body.replace,
        extraVariables: body.extraVariables,
        signal: controller.signal,
      },
      deps,
    );

    if (outcome.ok) {
      return c.json(outcome.response, 200);
    }
    if (outcome.aborted) {
      return c.json(
        problemJson(
          "Client Closed Request",
          499,
          "Generation aborted by client",
        ),
        499 as 400,
      );
    }
    return c.json(outcome.problem, outcome.status as 400);
  });
}
