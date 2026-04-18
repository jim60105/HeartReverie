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
  createLlmLogger,
  closeLogger,
  _resetLogger,
} from "../../../writer/lib/logger.ts";
import type { LogEntry } from "../../../writer/lib/logger.ts";

Deno.test("LLM Logger", async (t) => {
  await t.step("writes to LLM log file only (not console, not audit)", async () => {
    _resetLogger();
    const tmpDir = await Deno.makeTempDir();
    const auditFile = join(tmpDir, "audit.jsonl");
    const llmFile = join(tmpDir, "llm.jsonl");
    const logStub = stub(console, "log", () => {});
    const warnStub = stub(console, "warn", () => {});
    const errorStub = stub(console, "error", () => {});
    try {
      await initLogger({ level: "info", filePath: auditFile, llmFilePath: llmFile });
      const llm = createLlmLogger();

      llm.info("request", { type: "request", model: "m" });
      llm.info("response", { type: "response", response: "hello" });

      await closeLogger();

      // LLM file should contain both entries
      const llmContent = await Deno.readTextFile(llmFile);
      const lines = llmContent.trim().split("\n");
      assertEquals(lines.length, 2);
      const e1: LogEntry = JSON.parse(lines[0]!);
      assertEquals(e1.category, "llm");
      assertEquals(e1.level, "info");
      assertEquals(e1.message, "request");
      assertEquals(e1.data?.type, "request");

      // Audit file should be empty (no entries)
      const auditContent = await Deno.readTextFile(auditFile);
      assertEquals(auditContent.trim(), "");

      // Console should not have been called
      assertEquals(logStub.calls.length, 0);
      assertEquals(warnStub.calls.length, 0);
      assertEquals(errorStub.calls.length, 0);
    } finally {
      logStub.restore();
      warnStub.restore();
      errorStub.restore();
      _resetLogger();
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("default LLM path is playground/_logs/llm.jsonl when unset", async () => {
    _resetLogger();
    const tmpDir = await Deno.makeTempDir();
    const cwd = Deno.cwd();
    Deno.chdir(tmpDir);
    const prevEnv = Deno.env.get("LLM_LOG_FILE");
    Deno.env.delete("LLM_LOG_FILE");
    try {
      // filePath null disables audit; omit llmFilePath to use env/default
      await initLogger({ level: "info", filePath: null });
      const llm = createLlmLogger();
      llm.info("hello");
      await closeLogger();

      const defaultPath = join(tmpDir, "playground", "_logs", "llm.jsonl");
      const content = await Deno.readTextFile(defaultPath);
      const entry: LogEntry = JSON.parse(content.trim());
      assertEquals(entry.message, "hello");
    } finally {
      if (prevEnv !== undefined) Deno.env.set("LLM_LOG_FILE", prevEnv);
      Deno.chdir(cwd);
      _resetLogger();
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("llmFilePath: '' disables LLM logging (no-op logger)", async () => {
    _resetLogger();
    const logStub = stub(console, "log", () => {});
    try {
      await initLogger({ level: "info", filePath: null, llmFilePath: "" });
      const llm = createLlmLogger();

      // Should be no-op — not throw, not write anywhere
      llm.info("nothing");
      llm.error("still nothing");
      const derived = llm.withContext({ correlationId: "abc" });
      derived.info("still nothing either");

      await closeLogger();
      assertEquals(logStub.calls.length, 0);
    } finally {
      logStub.restore();
      _resetLogger();
    }
  });

  await t.step("llmFilePath custom path is honored", async () => {
    _resetLogger();
    const tmpDir = await Deno.makeTempDir();
    const customPath = join(tmpDir, "nested", "custom-llm.jsonl");
    try {
      await initLogger({ level: "info", filePath: null, llmFilePath: customPath });
      const llm = createLlmLogger();
      llm.info("custom");
      await closeLogger();

      const content = await Deno.readTextFile(customPath);
      const entry: LogEntry = JSON.parse(content.trim());
      assertEquals(entry.message, "custom");
    } finally {
      _resetLogger();
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("is independent of LOG_LEVEL (writes even at error level)", async () => {
    _resetLogger();
    const tmpDir = await Deno.makeTempDir();
    const llmFile = join(tmpDir, "llm.jsonl");
    const logStub = stub(console, "log", () => {});
    const errorStub = stub(console, "error", () => {});
    try {
      await initLogger({ level: "error", filePath: null, llmFilePath: llmFile });

      // Regular logger at error level suppresses info
      const reg = createLogger("system");
      reg.info("suppressed");
      assertEquals(logStub.calls.length, 0);

      // LLM logger still writes regardless of level
      const llm = createLlmLogger();
      llm.info("still written");
      llm.debug("also written");

      await closeLogger();

      const content = await Deno.readTextFile(llmFile);
      const lines = content.trim().split("\n");
      assertEquals(lines.length, 2);
    } finally {
      logStub.restore();
      errorStub.restore();
      _resetLogger();
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("correlationId and baseData are preserved via withContext", async () => {
    _resetLogger();
    const tmpDir = await Deno.makeTempDir();
    const llmFile = join(tmpDir, "llm.jsonl");
    try {
      await initLogger({ level: "info", filePath: null, llmFilePath: llmFile });
      const llm = createLlmLogger().withContext({
        correlationId: "corr-1",
        baseData: { series: "s", story: "x" },
      });

      llm.info("entry", { type: "request", model: "m" });
      await closeLogger();

      const content = await Deno.readTextFile(llmFile);
      const entry: LogEntry = JSON.parse(content.trim());
      assertEquals(entry.correlationId, "corr-1");
      assertEquals(entry.data?.series, "s");
      assertEquals(entry.data?.story, "x");
      assertEquals(entry.data?.model, "m");
      assertEquals(entry.data?.type, "request");
    } finally {
      _resetLogger();
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("error entry structure", async () => {
    _resetLogger();
    const tmpDir = await Deno.makeTempDir();
    const llmFile = join(tmpDir, "llm.jsonl");
    try {
      await initLogger({ level: "info", filePath: null, llmFilePath: llmFile });
      const llm = createLlmLogger();

      llm.info("LLM error", {
        type: "error",
        errorCode: "llm-api",
        httpStatus: 500,
        latencyMs: 42,
        errorBody: "upstream failure",
      });
      await closeLogger();

      const content = await Deno.readTextFile(llmFile);
      const entry: LogEntry = JSON.parse(content.trim());
      assertEquals(entry.data?.type, "error");
      assertEquals(entry.data?.errorCode, "llm-api");
      assertEquals(entry.data?.httpStatus, 500);
      assertEquals(entry.data?.latencyMs, 42);
      assertStringIncludes(String(entry.data?.errorBody), "upstream");
    } finally {
      _resetLogger();
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("response entry includes tokens and aborted flag", async () => {
    _resetLogger();
    const tmpDir = await Deno.makeTempDir();
    const llmFile = join(tmpDir, "llm.jsonl");
    try {
      await initLogger({ level: "info", filePath: null, llmFilePath: llmFile });
      const llm = createLlmLogger();

      llm.info("LLM response", {
        type: "response",
        response: "partial",
        latencyMs: 10,
        chapter: 2,
        tokens: { prompt: 5, completion: 3, total: 8 },
        aborted: true,
      });
      await closeLogger();

      const content = await Deno.readTextFile(llmFile);
      const entry: LogEntry = JSON.parse(content.trim());
      assertEquals(entry.data?.aborted, true);
      const tokens = entry.data?.tokens as Record<string, number>;
      assertEquals(tokens.prompt, 5);
      assertEquals(tokens.completion, 3);
      assertEquals(tokens.total, 8);
    } finally {
      _resetLogger();
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
});
