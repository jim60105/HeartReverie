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

import { dirname } from "@std/path";

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
  | "system";

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

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[36m",  // cyan
  info: "\x1b[32m",   // green
  warn: "\x1b[33m",   // yellow
  error: "\x1b[31m",  // red
};

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";

// ── Module-level state ──────────────────────────────────────────

let configuredLevel: LogLevel = "info";
let logFilePath: string | null = null;
let logFile: Deno.FsFile | null = null;
let currentFileSize = 0;
let initialized = false;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_BACKUPS = 5;
const encoder = new TextEncoder();

// ── Write queue (serializes file writes to prevent race conditions) ──

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite(entry: LogEntry): void {
  writeQueue = writeQueue.then(() => writeToFile(entry)).catch(() => {});
}

// ── File rotation ───────────────────────────────────────────────

async function rotateLogFile(): Promise<void> {
  if (!logFilePath || !logFile) return;

  logFile.close();
  logFile = null;

  // Shift existing backups: .5 → delete, .4 → .5, ..., .1 → .2, current → .1
  for (let i = MAX_BACKUPS; i >= 1; i--) {
    const src = i === 1 ? logFilePath : `${logFilePath}.${i - 1}`;
    const dest = `${logFilePath}.${i}`;
    try {
      if (i === MAX_BACKUPS) {
        await Deno.remove(dest).catch(() => {});
      }
      await Deno.rename(src, dest);
    } catch {
      // File may not exist — skip
    }
  }

  // Re-open fresh log file
  logFile = await Deno.open(logFilePath, { write: true, create: true, append: true, mode: 0o664 });
  currentFileSize = 0;
}

async function writeToFile(entry: LogEntry): Promise<void> {
  if (!logFile || !logFilePath) return;

  const line = JSON.stringify(entry) + "\n";
  const bytes = encoder.encode(line);

  if (currentFileSize + bytes.length > MAX_FILE_SIZE) {
    await rotateLogFile();
  }

  try {
    await logFile.write(bytes);
    currentFileSize += bytes.length;
  } catch {
    // Silently skip file write errors to avoid cascading failures
  }
}

// ── Console formatting ──────────────────────────────────────────

function formatConsole(entry: LogEntry): string {
  const color = LEVEL_COLORS[entry.level];
  const levelTag = `${color}${entry.level.toUpperCase().padEnd(5)}${RESET}`;
  const time = entry.timestamp.slice(11, 23); // HH:MM:SS.mmm
  const cat = `${DIM}[${entry.category}]${RESET}`;
  const corrId = entry.correlationId ? ` ${DIM}(${entry.correlationId.slice(0, 8)})${RESET}` : "";
  const dataStr = entry.data ? ` ${DIM}${JSON.stringify(entry.data)}${RESET}` : "";
  return `${time} ${levelTag} ${cat}${corrId} ${entry.message}${dataStr}`;
}

// ── Core emit function ──────────────────────────────────────────

function emit(entry: LogEntry): void {
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[configuredLevel]) return;

  // Console output
  const formatted = formatConsole(entry);
  if (entry.level === "error") {
    console.error(formatted);
  } else if (entry.level === "warn") {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  // File output (serialized via queue)
  if (logFile) {
    enqueueWrite(entry);
  }
}

// ── Public API ──────────────────────────────────────────────────

/**
 * Initialize the logging system. Must be called once at server startup.
 * Reads LOG_LEVEL and LOG_FILE from environment (or uses provided values).
 */
export async function initLogger(options?: {
  level?: LogLevel;
  filePath?: string | null;
}): Promise<void> {
  if (initialized) return;

  // Resolve log level
  const envLevel = Deno.env.get("LOG_LEVEL")?.toLowerCase();
  if (options?.level) {
    configuredLevel = options.level;
  } else if (envLevel && envLevel in LEVEL_ORDER) {
    configuredLevel = envLevel as LogLevel;
  }

  // Resolve log file path
  if (options?.filePath !== undefined) {
    logFilePath = options.filePath || null;
  } else {
    const envFile = Deno.env.get("LOG_FILE");
    if (envFile === "") {
      logFilePath = null; // Explicitly disabled
    } else if (envFile) {
      logFilePath = envFile;
    } else {
      logFilePath = "playground/_logs/audit.jsonl";
    }
  }

  // Open log file if configured
  if (logFilePath) {
    try {
      await Deno.mkdir(dirname(logFilePath), { recursive: true, mode: 0o775 });
      logFile = await Deno.open(logFilePath, { write: true, create: true, append: true, mode: 0o664 });
      const stat = await logFile.stat();
      currentFileSize = stat.size;
    } catch {
      // Cannot open log file — continue with console-only
      logFilePath = null;
      logFile = null;
    }
  }

  initialized = true;
}

/**
 * Create a logger instance for a specific category.
 * @param category - The logging category (llm, file, template, plugin, auth, ws, http, system)
 * @param ctx - Optional initial context (correlationId, baseData)
 */
export function createLogger(category: LogCategory, ctx?: LoggerContext): Logger {
  return createLoggerWithContext(
    category,
    ctx?.correlationId ?? null,
    ctx?.baseData,
  );
}

function createLoggerWithContext(
  category: LogCategory,
  correlationId: string | null,
  baseData?: Record<string, unknown>,
): Logger {
  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    // Merge baseData with call-site data; call-site takes precedence
    const mergedData = baseData
      ? { ...baseData, ...data }
      : data;
    emit({
      timestamp: new Date().toISOString(),
      level,
      category,
      correlationId,
      message,
      data: mergedData,
    });
  }

  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
    withContext(ctx: LoggerContext): Logger {
      // Accumulate baseData: existing + new (new takes precedence)
      const newBaseData = ctx.baseData
        ? { ...baseData, ...ctx.baseData }
        : baseData;
      return createLoggerWithContext(
        category,
        ctx.correlationId ?? correlationId,
        newBaseData,
      );
    },
  };
}

/**
 * Get the current configured log level (for testing/inspection).
 */
export function getLogLevel(): LogLevel {
  return configuredLevel;
}

/**
 * Reset logger state (for testing only).
 */
export function _resetLogger(): void {
  if (logFile) {
    logFile.close();
    logFile = null;
  }
  logFilePath = null;
  currentFileSize = 0;
  configuredLevel = "info";
  initialized = false;
  writeQueue = Promise.resolve();
}

/**
 * Flush pending writes and close the log file.
 * Call during graceful shutdown to avoid losing buffered log entries.
 */
export async function closeLogger(): Promise<void> {
  // Wait for all queued writes to complete
  await writeQueue;
  if (logFile) {
    logFile.close();
    logFile = null;
  }
}
