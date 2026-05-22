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

import type { LogEntry, LogLevel } from "./logger-types.ts";

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

export function shouldUseAnsiColors(stream: "stdout" | "stderr"): boolean {
  if (Deno.noColor) return false;
  try {
    return stream === "stderr"
      ? Deno.stderr.isTerminal()
      : Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

export function formatConsole(
  entry: LogEntry,
  useAnsiColors: boolean,
): string {
  const color = LEVEL_COLORS[entry.level];
  const plainLevel = entry.level.toUpperCase().padEnd(5);
  const levelTag = useAnsiColors ? `${color}${plainLevel}${RESET}` : plainLevel;
  const time = entry.timestamp.slice(11, 23); // HH:MM:SS.mmm
  const categoryLabel = `[${entry.category}]`;
  const cat = useAnsiColors ? `${DIM}${categoryLabel}${RESET}` : categoryLabel;
  const corrIdBody = entry.correlationId
    ? `(${entry.correlationId.slice(0, 8)})`
    : "";
  const corrId = corrIdBody
    ? (useAnsiColors ? ` ${DIM}${corrIdBody}${RESET}` : ` ${corrIdBody}`)
    : "";
  const dataBody = entry.data ? JSON.stringify(entry.data) : "";
  const dataStr = dataBody
    ? (useAnsiColors ? ` ${DIM}${dataBody}${RESET}` : ` ${dataBody}`)
    : "";
  return `${time} ${levelTag} ${cat}${corrId} ${entry.message}${dataStr}`;
}
