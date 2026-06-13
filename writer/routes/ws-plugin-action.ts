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

import type { WSContext } from "@hono/hono/ws";
import { runPluginActionWithDeps } from "./plugin-actions.ts";
import { errorMessage, problemJson } from "../lib/errors.ts";
import { createLogger } from "../lib/logger.ts";
import type { WsConnection } from "./ws-connection.ts";

const log = createLogger("ws");

export async function handlePluginActionRun(
  conn: WsConnection,
  ws: WSContext,
  msg: Record<string, unknown>,
): Promise<void> {
  const correlationId = msg.correlationId;
  const pluginName = msg.pluginName;
  const series = msg.series;
  const story = msg.name;
  const promptFile = msg.promptFile;
  const append = msg.append === true;
  const replace = msg.replace === true;
  const appendTag = msg.appendTag;
  const extraVariables = msg.extraVariables;

  if (typeof correlationId !== "string" || typeof pluginName !== "string") {
    conn.wsSend(ws, { type: "error", detail: "Invalid plugin-action:run parameters" });
    return;
  }

  const signal = conn.startGeneration(correlationId);
  try {
    const resolvedMode = append
      ? "append-to-existing-chapter"
      : replace
      ? "replace-last-chapter"
      : "discard";
    const { config, safePath, hookDispatcher, pluginManager, buildPromptFromStory } = conn.deps;
    const outcome = await runPluginActionWithDeps(
      {
        pluginName,
        series,
        story,
        promptPath: promptFile,
        mode: resolvedMode,
        appendTag,
        replace: msg.replace,
        extraVariables,
        signal,
        onDelta: (chunk) => {
          conn.wsSend(ws, { type: "plugin-action:delta", correlationId, chunk });
        },
      },
      { config, safePath, hookDispatcher, pluginManager, buildPromptFromStory },
    );
    if (outcome.ok) {
      conn.wsSend(ws, {
        type: "plugin-action:done",
        correlationId,
        content: outcome.response.content,
        usage: outcome.response.usage,
        chapterUpdated: outcome.response.chapterUpdated,
        chapterReplaced: outcome.response.chapterReplaced,
        appendedTag: outcome.response.appendedTag,
      });
    } else if (outcome.aborted) {
      conn.wsSend(ws, { type: "plugin-action:aborted", correlationId });
    } else {
      conn.wsSend(ws, {
        type: "plugin-action:error",
        correlationId,
        problem: outcome.problem,
      });
    }
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : "Plugin action failed";
    log.error("Plugin action failed (unexpected)", {
      event: "plugin-action:error",
      correlationId,
      pluginName,
      error: errorMessage(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
    conn.wsSend(ws, {
      type: "plugin-action:error",
      correlationId,
      problem: problemJson("Internal Server Error", 500, detail),
    });
  } finally {
    conn.endGeneration(correlationId, ws);
  }
}

export function handlePluginActionAbort(
  conn: WsConnection,
  msg: Record<string, unknown>,
): void {
  const correlationId = msg.correlationId;
  if (typeof correlationId !== "string") return;
  conn.abortGeneration(correlationId);
}
