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
import {
  LEVEL_ORDER,
  type LogCategory,
  type LogEntry,
  type Logger,
  type LoggerContext,
  type LogLevel,
} from "./logger-types.ts";
import { formatConsole, shouldUseAnsiColors } from "./logger-console.ts";
import {
  closeFileSink,
  createFileSinkState,
  enqueueWrite,
  ErrorThrottler,
  type FileSinkState,
  resetFileSink,
} from "./logger-file-sink.ts";

export type { LogCategory, LogEntry, Logger, LoggerContext, LogLevel };

// ── Module-level state ──────────────────────────────────────────

let configuredLevel: LogLevel = "info";
let initialized = false;

const throttler = new ErrorThrottler();
const auditSink: FileSinkState = createFileSinkState();
const llmSink: FileSinkState = createFileSinkState((path) => {
  console.warn(
    `[logger] Failed to reopen LLM log file after rotation: ${path} — LLM file logging disabled`,
  );
});

// ── Core emit ───────────────────────────────────────────────────

function emit(entry: LogEntry): void {
  if (LEVEL_ORDER[entry.level] < LEVEL_ORDER[configuredLevel]) return;

  const stream: "stdout" | "stderr" =
    (entry.level === "warn" || entry.level === "error") ? "stderr" : "stdout";

  const formatted = formatConsole(entry, shouldUseAnsiColors(stream));
  if (entry.level === "error") {
    console.error(formatted);
  } else if (entry.level === "warn") {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }

  if (auditSink.file) {
    enqueueWrite(auditSink, entry, throttler);
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

  // Resolve audit log file path
  if (options?.filePath !== undefined) {
    auditSink.path = options.filePath || null;
  } else {
    const envFile = Deno.env.get("LOG_FILE");
    if (envFile === "") {
      auditSink.path = null;
    } else if (envFile) {
      auditSink.path = envFile;
    } else {
      auditSink.path = "playground/_logs/audit.jsonl";
    }
  }

  if (auditSink.path) {
    try {
      await Deno.mkdir(dirname(auditSink.path), {
        recursive: true,
        mode: 0o775,
      });
      auditSink.file = await Deno.open(auditSink.path, {
        write: true,
        create: true,
        append: true,
        mode: 0o664,
      });
      const stat = await auditSink.file.stat();
      auditSink.currentSize = stat.size;
    } catch {
      // Cannot open audit log file — continue with console-only
      auditSink.path = null;
      auditSink.file = null;
    }
  }

  // Resolve LLM log file path
  if (options?.llmFilePath !== undefined) {
    llmSink.path = options.llmFilePath || null;
  } else {
    const envLlmFile = Deno.env.get("LLM_LOG_FILE");
    if (envLlmFile === "") {
      llmSink.path = null;
    } else if (envLlmFile) {
      llmSink.path = envLlmFile;
    } else {
      llmSink.path = "playground/_logs/llm.jsonl";
    }
  }

  if (llmSink.path) {
    try {
      await Deno.mkdir(dirname(llmSink.path), {
        recursive: true,
        mode: 0o775,
      });
      llmSink.file = await Deno.open(llmSink.path, {
        write: true,
        create: true,
        append: true,
        mode: 0o664,
      });
      const stat = await llmSink.file.stat();
      llmSink.currentSize = stat.size;
    } catch {
      console.warn(
        `[logger] Failed to open LLM log file: ${llmSink.path} — LLM file logging disabled`,
      );
      llmSink.path = null;
      llmSink.file = null;
    }
  }

  initialized = true;
}

/**
 * Create a logger instance for a specific category.
 */
export function createLogger(
  category: LogCategory,
  ctx?: LoggerContext,
): Logger {
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
  function log(
    level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
    const mergedData = baseData ? { ...baseData, ...data } : data;
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
  if (!llmSink.file) {
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
  function log(
    _level: LogLevel,
    message: string,
    data?: Record<string, unknown>,
  ): void {
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
    if (llmSink.file) {
      enqueueWrite(llmSink, entry, throttler);
    }
  }

  return {
    debug: (message, data) => log("debug", message, data),
    info: (message, data) => log("info", message, data),
    warn: (message, data) => log("warn", message, data),
    error: (message, data) => log("error", message, data),
    withContext(ctx: LoggerContext): Logger {
      const newBaseData = ctx.baseData
        ? { ...baseData, ...ctx.baseData }
        : baseData;
      return createLlmLoggerWithContext(
        ctx.correlationId ?? correlationId,
        newBaseData,
      );
    },
  };
}

/** Get the current configured log level (for testing/inspection). */
export function getLogLevel(): LogLevel {
  return configuredLevel;
}

/** Reset logger state (for testing only). */
export function _resetLogger(): void {
  resetFileSink(auditSink);
  resetFileSink(llmSink);
  configuredLevel = "info";
  initialized = false;
  throttler.reset();
}

/**
 * Flush pending writes and close the log files.
 * Call during graceful shutdown to avoid losing buffered log entries.
 */
export async function closeLogger(): Promise<void> {
  await closeFileSink(auditSink);
  await closeFileSink(llmSink);
}
