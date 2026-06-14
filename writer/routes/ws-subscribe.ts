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
import type { WSContext } from "@hono/hono/ws";
import { isValidParam } from "../lib/middleware.ts";
import { listChapterFiles, readStateDiff } from "../lib/story.ts";
import { logWsError } from "./ws-error-log.ts";
import type { WsConnection } from "./ws-connection.ts";

export async function handleSubscribe(
  conn: WsConnection,
  ws: WSContext,
  msg: Record<string, unknown>,
): Promise<void> {
  const series = msg.series;
  const story = msg.story;

  if (typeof series !== "string" || typeof story !== "string") {
    conn.wsSend(ws, { type: "error", detail: "Invalid subscribe parameters" });
    return;
  }

  if (!isValidParam(series) || !isValidParam(story)) {
    conn.wsSend(ws, { type: "error", detail: "Invalid series or story name" });
    return;
  }

  const storyDir = conn.deps.safePath(series, story);
  if (!storyDir) {
    conn.wsSend(ws, { type: "error", detail: "Invalid path" });
    return;
  }

  // Replace previous subscription
  conn.clearSubscription();

  let prevCount = -1;
  let prevLastContent = "";
  let prevStateDiffJson: string | undefined;

  const intervalId = setInterval(async () => {
    try {
      let chapterFiles: string[];
      try {
        // listChapterFiles returns [] on NotFound and throws otherwise;
        // preserve the prior early-return-with-log behaviour on any throw.
        chapterFiles = await listChapterFiles(storyDir);
      } catch (err: unknown) {
        logWsError("dir-read", err);
        return; // Directory may not exist yet
      }

      const count = chapterFiles.length;

      if (count !== prevCount) {
        prevCount = count;
        conn.wsSend(ws, { type: "chapters:updated", series, story, count });
      }

      if (count > 0) {
        const lastFile = chapterFiles[count - 1]!;
        const lastNum = parseInt(lastFile, 10);
        try {
          const content = await Deno.readTextFile(join(storyDir, lastFile));

          // Try to load stateDiff for the last chapter. The shared helper
          // stays silent on an absent sidecar (NotFound) and logs only real
          // failures (malformed YAML, permission denied); route those through
          // the existing throttled WS error logger to preserve diff-read
          // logging on this path.
          const stateDiff = await readStateDiff(storyDir, lastNum, {
            warn: (_message, data) => logWsError("diff-read", data?.error),
          });

          const diffJson = stateDiff ? JSON.stringify(stateDiff) : undefined;
          if (
            content !== prevLastContent ||
            diffJson !== prevStateDiffJson
          ) {
            prevLastContent = content;
            prevStateDiffJson = diffJson;

            conn.wsSend(ws, {
              type: "chapters:content",
              series,
              story,
              chapter: lastNum,
              content,
              stateDiff,
            });
          }
        } catch (err: unknown) {
          logWsError("chapter-read", err);
          // File may be in the process of being written
        }
      }
    } catch (err: unknown) {
      logWsError("poll", err);
      // Ignore errors in polling
    }
  }, 1_000);

  conn.setSubscriptionInterval(intervalId);
}
