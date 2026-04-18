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

import { assertEquals, assertStringIncludes } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path";
import {
  initLogger,
  createLogger,
  getLogLevel,
  closeLogger,
  _resetLogger,
} from "../../../writer/lib/logger.ts";
import type { LogEntry } from "../../../writer/lib/logger.ts";

Deno.test("Logger", async (t) => {
  await t.step("level filtering", async (t) => {
    await t.step("filters messages below configured level", async () => {
      _resetLogger();
      const logStub = stub(console, "log", () => {});
      const warnStub = stub(console, "warn", () => {});
      const errorStub = stub(console, "error", () => {});
      try {
        await initLogger({ level: "warn", filePath: null });
        const log = createLogger("system");

        log.debug("should not appear");
        log.info("should not appear");
        log.warn("should appear");
        log.error("should appear");

        assertEquals(logStub.calls.length, 0);
        assertEquals(warnStub.calls.length, 1);
        assertEquals(errorStub.calls.length, 1);
      } finally {
        logStub.restore();
        warnStub.restore();
        errorStub.restore();
        _resetLogger();
      }
    });

    await t.step("debug level shows all messages", async () => {
      _resetLogger();
      const logStub = stub(console, "log", () => {});
      const warnStub = stub(console, "warn", () => {});
      const errorStub = stub(console, "error", () => {});
      try {
        await initLogger({ level: "debug", filePath: null });
        const log = createLogger("http");

        log.debug("d");
        log.info("i");
        log.warn("w");
        log.error("e");

        // debug and info go to console.log
        assertEquals(logStub.calls.length, 2);
        assertEquals(warnStub.calls.length, 1);
        assertEquals(errorStub.calls.length, 1);
      } finally {
        logStub.restore();
        warnStub.restore();
        errorStub.restore();
        _resetLogger();
      }
    });

    await t.step("error level filters all but error", async () => {
      _resetLogger();
      const logStub = stub(console, "log", () => {});
      const warnStub = stub(console, "warn", () => {});
      const errorStub = stub(console, "error", () => {});
      try {
        await initLogger({ level: "error", filePath: null });
        const log = createLogger("auth");

        log.debug("no");
        log.info("no");
        log.warn("no");
        log.error("yes");

        assertEquals(logStub.calls.length, 0);
        assertEquals(warnStub.calls.length, 0);
        assertEquals(errorStub.calls.length, 1);
      } finally {
        logStub.restore();
        warnStub.restore();
        errorStub.restore();
        _resetLogger();
      }
    });
  });

  await t.step("console format", async (t) => {
    await t.step("includes category and message in output", async () => {
      _resetLogger();
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "info", filePath: null });
        const log = createLogger("llm");

        log.info("Request sent", { model: "gpt-4" });

        assertEquals(logStub.calls.length, 1);
        const output = String(logStub.calls[0]!.args[0]);
        assertStringIncludes(output, "[llm]");
        assertStringIncludes(output, "Request sent");
        assertStringIncludes(output, "gpt-4");
      } finally {
        logStub.restore();
        _resetLogger();
      }
    });

    await t.step("includes correlation ID when set", async () => {
      _resetLogger();
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "info", filePath: null });
        const log = createLogger("llm");
        const reqLog = log.withContext({ correlationId: "abcd1234-5678-9abc-def0-123456789abc" });

        reqLog.info("With correlation");

        const output = String(logStub.calls[0]!.args[0]);
        assertStringIncludes(output, "abcd1234");
      } finally {
        logStub.restore();
        _resetLogger();
      }
    });
  });

  await t.step("correlation ID isolation", async (t) => {
    await t.step("withContext creates independent logger", async () => {
      _resetLogger();
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "info", filePath: null });
        const log = createLogger("http");

        const req1 = log.withContext({ correlationId: "aaaa-1111" });
        const req2 = log.withContext({ correlationId: "bbbb-2222" });

        req1.info("from req1");
        req2.info("from req2");
        log.info("no correlation");

        const out1 = String(logStub.calls[0]!.args[0]);
        const out2 = String(logStub.calls[1]!.args[0]);
        const out3 = String(logStub.calls[2]!.args[0]);

        assertStringIncludes(out1, "aaaa-111");
        assertStringIncludes(out2, "bbbb-222");
        // Base logger has no correlation ID
        assertEquals(out3.includes("aaaa"), false);
        assertEquals(out3.includes("bbbb"), false);
      } finally {
        logStub.restore();
        _resetLogger();
      }
    });
  });

  await t.step("file output", async (t) => {
    await t.step("writes JSON Lines to file", async () => {
      _resetLogger();
      const tmpDir = await Deno.makeTempDir();
      const logFile = join(tmpDir, "test.jsonl");
      const logStub = stub(console, "log", () => {});
      const warnStub = stub(console, "warn", () => {});
      try {
        await initLogger({ level: "info", filePath: logFile });
        const log = createLogger("file");

        log.info("File write test", { path: "/test.md" });
        log.warn("Warning test");

        // Give async write time to complete
        await new Promise((r) => setTimeout(r, 50));

        const content = await Deno.readTextFile(logFile);
        const lines = content.trim().split("\n");
        assertEquals(lines.length, 2);

        const entry1: LogEntry = JSON.parse(lines[0]!);
        assertEquals(entry1.level, "info");
        assertEquals(entry1.category, "file");
        assertEquals(entry1.message, "File write test");
        assertEquals(entry1.data?.path, "/test.md");
        assertEquals(typeof entry1.timestamp, "string");
        assertEquals(entry1.correlationId, null);

        const entry2: LogEntry = JSON.parse(lines[1]!);
        assertEquals(entry2.level, "warn");
        assertEquals(entry2.message, "Warning test");
      } finally {
        logStub.restore();
        warnStub.restore();
        _resetLogger();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("respects level filtering for file output", async () => {
      _resetLogger();
      const tmpDir = await Deno.makeTempDir();
      const logFile = join(tmpDir, "level-test.jsonl");
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "warn", filePath: logFile });
        const log = createLogger("system");

        log.debug("no");
        log.info("no");
        log.warn("yes");

        await new Promise((r) => setTimeout(r, 50));

        const content = await Deno.readTextFile(logFile);
        const lines = content.trim().split("\n");
        assertEquals(lines.length, 1);
        const entry: LogEntry = JSON.parse(lines[0]!);
        assertEquals(entry.message, "yes");
      } finally {
        logStub.restore();
        _resetLogger();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });

  await t.step("getLogLevel returns configured level", async () => {
    _resetLogger();
    const logStub = stub(console, "log", () => {});
    try {
      await initLogger({ level: "debug", filePath: null });
      assertEquals(getLogLevel(), "debug");
    } finally {
      logStub.restore();
      _resetLogger();
    }
  });

  await t.step("initLogger is idempotent", async () => {
    _resetLogger();
    const logStub = stub(console, "log", () => {});
    try {
      await initLogger({ level: "debug", filePath: null });
      await initLogger({ level: "error", filePath: null }); // should be ignored
      assertEquals(getLogLevel(), "debug");
    } finally {
      logStub.restore();
      _resetLogger();
    }
  });

  await t.step("_resetLogger resets all state", async () => {
    _resetLogger();
    const logStub = stub(console, "log", () => {});
    try {
      await initLogger({ level: "error", filePath: null });
      assertEquals(getLogLevel(), "error");
      _resetLogger();
      // After reset, default level is info
      assertEquals(getLogLevel(), "info");
      // Can reinitialize
      await initLogger({ level: "debug", filePath: null });
      assertEquals(getLogLevel(), "debug");
    } finally {
      logStub.restore();
      _resetLogger();
    }
  });

  await t.step("sensitive data handling", async (t) => {
    await t.step("data values are included as-is (caller is responsible for exclusion)", async () => {
      _resetLogger();
      const tmpDir = await Deno.makeTempDir();
      const logFile = join(tmpDir, "sensitive.jsonl");
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "debug", filePath: logFile });
        const log = createLogger("auth");

        // The logger does not filter data — callers must never pass sensitive fields
        log.info("Auth attempt", { method: "POST", path: "/api/auth/verify" });

        await new Promise((r) => setTimeout(r, 50));

        const content = await Deno.readTextFile(logFile);
        const entry: LogEntry = JSON.parse(content.trim());
        assertEquals(entry.data?.method, "POST");
        assertEquals(entry.data?.path, "/api/auth/verify");
      } finally {
        logStub.restore();
        _resetLogger();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });

  await t.step("closeLogger flushes pending writes", async () => {
    _resetLogger();
    const tmpDir = await Deno.makeTempDir();
    const logFile = join(tmpDir, "flush-test.jsonl");
    const logStub = stub(console, "log", () => {});
    try {
      await initLogger({ level: "info", filePath: logFile });
      const log = createLogger("system");

      // Write multiple entries rapidly
      log.info("entry1");
      log.info("entry2");
      log.info("entry3");

      // Close (flushes queue)
      await closeLogger();

      // All entries should be written
      const content = await Deno.readTextFile(logFile);
      const lines = content.trim().split("\n");
      assertEquals(lines.length, 3);
    } finally {
      logStub.restore();
      _resetLogger();
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("baseData support", async (t) => {
    await t.step("merges baseData into every log entry", async () => {
      _resetLogger();
      const tmpDir = await Deno.makeTempDir();
      const logFile = join(tmpDir, "basedata.jsonl");
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "debug", filePath: logFile });
        const log = createLogger("plugin", { baseData: { plugin: "test-plugin" } });

        log.info("Hello");

        await new Promise((r) => setTimeout(r, 50));

        const content = await Deno.readTextFile(logFile);
        const entry: LogEntry = JSON.parse(content.trim());
        assertEquals(entry.data?.plugin, "test-plugin");
        assertEquals(entry.message, "Hello");
      } finally {
        logStub.restore();
        _resetLogger();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("call-site data takes precedence over baseData", async () => {
      _resetLogger();
      const tmpDir = await Deno.makeTempDir();
      const logFile = join(tmpDir, "precedence.jsonl");
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "debug", filePath: logFile });
        const log = createLogger("plugin", { baseData: { plugin: "original", extra: "kept" } });

        log.info("Overridden", { plugin: "override" });

        await new Promise((r) => setTimeout(r, 50));

        const content = await Deno.readTextFile(logFile);
        const entry: LogEntry = JSON.parse(content.trim());
        assertEquals(entry.data?.plugin, "override");
        assertEquals(entry.data?.extra, "kept");
      } finally {
        logStub.restore();
        _resetLogger();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("withContext accumulates baseData", async () => {
      _resetLogger();
      const tmpDir = await Deno.makeTempDir();
      const logFile = join(tmpDir, "accumulate.jsonl");
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "debug", filePath: logFile });
        const log = createLogger("plugin", { baseData: { plugin: "my-plugin" } });
        const derived = log.withContext({ baseData: { request: "req-1" } });

        derived.info("Derived log");

        await new Promise((r) => setTimeout(r, 50));

        const content = await Deno.readTextFile(logFile);
        const entry: LogEntry = JSON.parse(content.trim());
        assertEquals(entry.data?.plugin, "my-plugin");
        assertEquals(entry.data?.request, "req-1");
      } finally {
        logStub.restore();
        _resetLogger();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("withContext baseData overrides parent baseData on collision", async () => {
      _resetLogger();
      const tmpDir = await Deno.makeTempDir();
      const logFile = join(tmpDir, "override-chain.jsonl");
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "debug", filePath: logFile });
        const log = createLogger("plugin", { baseData: { plugin: "parent", shared: "old" } });
        const derived = log.withContext({ baseData: { shared: "new" } });

        derived.info("Chain test");

        await new Promise((r) => setTimeout(r, 50));

        const content = await Deno.readTextFile(logFile);
        const entry: LogEntry = JSON.parse(content.trim());
        assertEquals(entry.data?.plugin, "parent");
        assertEquals(entry.data?.shared, "new");
      } finally {
        logStub.restore();
        _resetLogger();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });

    await t.step("createLogger with context sets both correlationId and baseData", async () => {
      _resetLogger();
      const tmpDir = await Deno.makeTempDir();
      const logFile = join(tmpDir, "both.jsonl");
      const logStub = stub(console, "log", () => {});
      try {
        await initLogger({ level: "debug", filePath: logFile });
        const log = createLogger("plugin", {
          correlationId: "corr-123",
          baseData: { plugin: "dual" },
        });

        log.info("Both set");

        await new Promise((r) => setTimeout(r, 50));

        const content = await Deno.readTextFile(logFile);
        const entry: LogEntry = JSON.parse(content.trim());
        assertEquals(entry.correlationId, "corr-123");
        assertEquals(entry.data?.plugin, "dual");
      } finally {
        logStub.restore();
        _resetLogger();
        await Deno.remove(tmpDir, { recursive: true });
      }
    });
  });
});
