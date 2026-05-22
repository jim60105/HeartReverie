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

/** Log severity levels in ascending order. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Predefined logging categories for domain separation. */
export type LogCategory =
  | "llm"
  | "file"
  | "template"
  | "plugin"
  | "auth"
  | "ws"
  | "http"
  | "system"
  | "themes"
  | "generation"
  | "lore";

/** A single structured log entry. */
export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly category: LogCategory;
  readonly correlationId: string | null;
  readonly message: string;
  readonly data?: Record<string, unknown>;
}

/** Immutable context that can be bound to a logger instance. */
export interface LoggerContext {
  readonly correlationId?: string;
  readonly baseData?: Record<string, unknown>;
}

/** Logger instance providing leveled logging methods. */
export interface Logger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  /** Create a derived logger with additional immutable context. */
  withContext(ctx: LoggerContext): Logger;
}

export const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};
