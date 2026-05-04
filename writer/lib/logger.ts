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
  | "system"
  | "themes";

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

// LLM log target — separate file, bypasses console and audit, not gated by LOG_LEVEL
let llmLogFilePath: string | null = null;
let llmLogFile: Deno.FsFile | null = null;
let llmCurrentFileSize = 0;

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_BACKUPS = 5;
const encoder = new TextEncoder();

// ── Write queue (serializes file writes to prevent race conditions) ──

let writeQueue: Promise<void> = Promise.resolve();
let llmWriteQueue: Promise<void> = Promise.resolve();

function enqueueWrite(entry: LogEntry): void {
  writeQueue = writeQueue.then(() => writeToFile(entry)).catch(() => {});
}

function enqueueLlmWrite(entry: LogEntry): void {
  llmWriteQueue = llmWriteQueue.then(() => writeToLlmFile(entry)).catch(() => {});
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

async function rotateLlmLogFile(): Promise<void> {
  if (!llmLogFilePath || !llmLogFile) return;

  llmLogFile.close();
  llmLogFile = null;

  for (let i = MAX_BACKUPS; i >= 1; i--) {
    const src = i === 1 ? llmLogFilePath : `${llmLogFilePath}.${i - 1}`;
    const dest = `${llmLogFilePath}.${i}`;
    try {
      if (i === MAX_BACKUPS) {
        await Deno.remove(dest).catch(() => {});
      }
      await Deno.rename(src, dest);
    } catch {
      // File may not exist — skip
    }
  }

  try {
    llmLogFile = await Deno.open(llmLogFilePath, { write: true, create: true, append: true, mode: 0o664 });
    llmCurrentFileSize = 0;
  } catch {
    console.warn(`[logger] Failed to reopen LLM log file after rotation: ${llmLogFilePath} — LLM file logging disabled`);
    llmLogFilePath = null;
  }
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

async function writeToLlmFile(entry: LogEntry): Promise<void> {
  if (!llmLogFile || !llmLogFilePath) return;

  const line = JSON.stringify(entry) + "\n";
  const bytes = encoder.encode(line);

  if (llmCurrentFileSize + bytes.length > MAX_FILE_SIZE) {
    await rotateLlmLogFile();
  }

  try {
    await llmLogFile.write(bytes);
    llmCurrentFileSize += bytes.length;
  } catch {
    // Silently skip file write errors to avoid cascading failures
  }
}

// ── Console formatting ──────────────────────────────────────────

function shouldUseAnsiColors(stream: "stdout" | "stderr"): boolean {
  if (Deno.noColor) return false;
  try {
    return stream === "stderr" ? Deno.stderr.isTerminal() : Deno.stdout.isTerminal();
  } catch {
    return false;
  }
}

function formatConsole(entry: LogEntry, useAnsiColors: boolean): string {
  const color = LEVEL_COLORS[entry.level];
  const plainLevel = entry.level.toUpperCase().padEnd(5);
  const levelTag = useAnsiColors ? `${color}${plainLevel}${RESET}` : plainLevel;
  const time = entry.timestamp.slice(11, 23); // HH:MM:SS.mmm
  const categoryLabel = `[${entry.category}]`;
  const cat = useAnsiColors ? `${DIM}${categoryLabel}${RESET}` : categoryLabel;
  const corrIdBody = entry.correlationId ? `(${entry.correlationId.slice(0, 8)})` : "";
  const corrId = corrIdBody ? (useAnsiColors ? ` ${DIM}${corrIdBody}${RESET}` : ` ${corrIdBody}`) : "";
  const dataBody = entry.data ? JSON.stringify(entry.data) : "";
  const dataStr = dataBody ? (useAnsiColors ? ` ${DIM}${dataBody}${RESET}` : ` ${dataBody}`) : "";
  return `${time} ${levelTag} ${cat}${corrId} ${entry.message}${dataStr}`;
}

// ── Core emit function ──────────────────────────────────────────

function emit(entry: LogEntry): void {
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[configuredLevel]) return;

  const stream: "stdout" | "stderr" = (entry.level === "warn" || entry.level === "error")
    ? "stderr"
    : "stdout";

  // Console output
  const formatted = formatConsole(entry, shouldUseAnsiColors(stream));
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
  llmFilePath?: string | null;
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

  // Resolve LLM log file path
  if (options?.llmFilePath !== undefined) {
    llmLogFilePath = options.llmFilePath || null;
  } else {
    const envLlmFile = Deno.env.get("LLM_LOG_FILE");
    if (envLlmFile === "") {
      llmLogFilePath = null; // Explicitly disabled
    } else if (envLlmFile) {
      llmLogFilePath = envLlmFile;
    } else {
      llmLogFilePath = "playground/_logs/llm.jsonl";
    }
  }

  // Open LLM log file if configured
  if (llmLogFilePath) {
    try {
      await Deno.mkdir(dirname(llmLogFilePath), { recursive: true, mode: 0o775 });
      llmLogFile = await Deno.open(llmLogFilePath, { write: true, create: true, append: true, mode: 0o664 });
      const stat = await llmLogFile.stat();
      llmCurrentFileSize = stat.size;
    } catch {
      // Cannot open LLM log file — log warning to console and disable
      console.warn(`[logger] Failed to open LLM log file: ${llmLogFilePath} — LLM file logging disabled`);
      llmLogFilePath = null;
      llmLogFile = null;
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
 * Create a logger that writes ONLY to the LLM log file.
 * Bypasses console output and the audit log. Not gated by LOG_LEVEL.
 * Returns a no-op logger if LLM logging is disabled.
 */
export function createLlmLogger(ctx?: LoggerContext): Logger {
  if (!llmLogFile) {
    // No-op logger when LLM logging is disabled
    const noop: Logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      withContext: () => noop,
    };
    return noop;
  }

  return createLlmLoggerWithContext(
    ctx?.correlationId ?? null,
    ctx?.baseData,
  );
}

function createLlmLoggerWithContext(
  correlationId: string | null,
  baseData?: Record<string, unknown>,
): Logger {
  function log(_level: LogLevel, message: string, data?: Record<string, unknown>): void {
    // LLM logger always writes (not gated by LOG_LEVEL), file-only
    const mergedData = baseData ? { ...baseData, ...data } : data;
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: "info", // LLM entries always logged as info
      category: "llm",
      correlationId,
      message,
      data: mergedData,
    };
    if (llmLogFile) {
      enqueueLlmWrite(entry);
    }
  }

  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
    withContext(ctx: LoggerContext): Logger {
      const newBaseData = ctx.baseData ? { ...baseData, ...ctx.baseData } : baseData;
      return createLlmLoggerWithContext(
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
  if (llmLogFile) {
    llmLogFile.close();
    llmLogFile = null;
  }
  logFilePath = null;
  llmLogFilePath = null;
  currentFileSize = 0;
  llmCurrentFileSize = 0;
  configuredLevel = "info";
  initialized = false;
  writeQueue = Promise.resolve();
  llmWriteQueue = Promise.resolve();
}

/**
 * Flush pending writes and close the log file.
 * Call during graceful shutdown to avoid losing buffered log entries.
 */
export async function closeLogger(): Promise<void> {
  // Wait for all queued writes to complete
  await writeQueue;
  await llmWriteQueue;
  if (logFile) {
    logFile.close();
    logFile = null;
  }
  if (llmLogFile) {
    llmLogFile.close();
    llmLogFile = null;
  }
}
