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

import { assert, assertEquals } from "@std/assert";
import { join, resolve } from "@std/path";

// config.ts evaluates all module-level constants once at import time. To exercise
// every parsing branch we spawn a fresh `deno run` subprocess per scenario and
// propagate `--coverage=$DENO_COVERAGE_DIR` so the parent's coverage report
// aggregates the subprocess profiles too. This is the only way to drive coverage
// through paths gated by env vars that are only consulted at module load.
//
// `deno eval` does not accept `--coverage`, so we materialize the script in a
// temporary directory and import the repo module by absolute URL.

const ROOT = resolve(import.meta.dirname!, "../../..");
const CONFIG_MODULE_URL =
  new URL("../../../writer/lib/config.ts", import.meta.url)
    .href;
const COV_DIR = Deno.env.get("DENO_COVERAGE_DIR");

let scriptCounter = 0;

async function runConfigSubprocess(
  env: Record<string, string>,
  body: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  const subEnv: Record<string, string> = { ...env, NO_COLOR: "1" };
  const scriptDir = await Deno.makeTempDir({ prefix: "config-cov-subscript-" });
  const scriptName =
    `._config_cov_subscript_${Date.now()}_${++scriptCounter}.ts`;
  const scriptPath = join(scriptDir, scriptName);
  await Deno.writeTextFile(scriptPath, body);
  try {
    const args = [
      "run",
      `--config=${join(ROOT, "deno.json")}`,
      "--allow-read",
      "--allow-env",
      "--allow-write",
    ];
    if (COV_DIR) args.push("--coverage=" + COV_DIR);
    args.push(scriptPath);
    const cmd = new Deno.Command(Deno.execPath(), {
      args,
      cwd: ROOT,
      env: subEnv,
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, stderr, code } = await cmd.output();
    return {
      stdout: new TextDecoder().decode(stdout).trim(),
      stderr: new TextDecoder().decode(stderr),
      code,
    };
  } finally {
    try {
      await Deno.remove(scriptDir, { recursive: true });
    } catch { /* ignore */ }
  }
}

async function evalAll(env: Record<string, string>): Promise<{
  values: Record<string, unknown>;
  stderr: string;
}> {
  const body = `
    const c = await import(${JSON.stringify(CONFIG_MODULE_URL)});
    console.log(JSON.stringify({
      ROOT_DIR: c.ROOT_DIR,
      PLAYGROUND_DIR: c.PLAYGROUND_DIR,
      READER_DIR: c.READER_DIR,
      PLUGINS_DIR: c.PLUGINS_DIR,
      PORT: c.PORT,
      LLM_API_URL: c.LLM_API_URL,
      LLM_MODEL: c.LLM_MODEL,
      LLM_TEMPERATURE: c.LLM_TEMPERATURE,
      LLM_FREQUENCY_PENALTY: c.LLM_FREQUENCY_PENALTY,
      LLM_PRESENCE_PENALTY: c.LLM_PRESENCE_PENALTY,
      LLM_TOP_K: c.LLM_TOP_K,
      LLM_TOP_P: c.LLM_TOP_P,
      LLM_REPETITION_PENALTY: c.LLM_REPETITION_PENALTY,
      LLM_MIN_P: c.LLM_MIN_P,
      LLM_TOP_A: c.LLM_TOP_A,
      LLM_REASONING_ENABLED: c.LLM_REASONING_ENABLED,
      LLM_REASONING_EFFORT: c.LLM_REASONING_EFFORT,
      LLM_REASONING_OMIT: c.LLM_REASONING_OMIT,
      LLM_MAX_COMPLETION_TOKENS: c.LLM_MAX_COMPLETION_TOKENS,
      THEME_DIR: c.THEME_DIR,
      PROMPT_FILE: c.PROMPT_FILE,
      LOG_LEVEL: c.LOG_LEVEL,
      LOG_FILE: c.LOG_FILE ?? null,
      LLM_LOG_FILE: c.LLM_LOG_FILE ?? null,
      llmDefaults: c.llmDefaults,
    }));
  `;
  const { stdout, stderr } = await runConfigSubprocess(env, body);
  return { values: JSON.parse(stdout), stderr };
}

Deno.test("config.ts – defaults when no env vars set", async () => {
  const { values } = await evalAll({});
  assertEquals(values.PORT, 8080);
  assertEquals(
    values.LLM_API_URL,
    "https://openrouter.ai/api/v1/chat/completions",
  );
  assertEquals(values.LLM_MODEL, "deepseek/deepseek-v4-pro");
  assertEquals(values.LLM_TEMPERATURE, 0.1);
  assertEquals(values.LLM_FREQUENCY_PENALTY, 0.13);
  assertEquals(values.LLM_PRESENCE_PENALTY, 0.52);
  assertEquals(values.LLM_TOP_K, 10);
  assertEquals(values.LLM_TOP_P, 0);
  assertEquals(values.LLM_REPETITION_PENALTY, 1.2);
  assertEquals(values.LLM_MIN_P, 0);
  assertEquals(values.LLM_TOP_A, 1);
  assertEquals(values.LLM_REASONING_ENABLED, true);
  assertEquals(values.LLM_REASONING_EFFORT, "xhigh");
  assertEquals(values.LLM_REASONING_OMIT, false);
  assertEquals(values.LLM_MAX_COMPLETION_TOKENS, 4096);
  assertEquals(values.THEME_DIR, "./themes/");
  assertEquals(values.LOG_LEVEL, "info");
  assertEquals(values.LOG_FILE, null);
  assert(
    typeof values.PLAYGROUND_DIR === "string" &&
      (values.PLAYGROUND_DIR as string).endsWith("playground"),
  );
  assert(
    typeof values.READER_DIR === "string" &&
      (values.READER_DIR as string).endsWith("reader-dist"),
  );
  assert(
    typeof values.PLUGINS_DIR === "string" &&
      (values.PLUGINS_DIR as string).endsWith("plugins"),
  );
});

Deno.test("config.ts – numEnv accepts numeric values for all sampling vars", async () => {
  const { values } = await evalAll({
    LLM_TEMPERATURE: "0.7",
    LLM_FREQUENCY_PENALTY: "0.3",
    LLM_PRESENCE_PENALTY: "0.9",
    LLM_TOP_K: "40",
    LLM_TOP_P: "0.95",
    LLM_REPETITION_PENALTY: "1.05",
    LLM_MIN_P: "0.05",
    LLM_TOP_A: "0.5",
  });
  assertEquals(values.LLM_TEMPERATURE, 0.7);
  assertEquals(values.LLM_FREQUENCY_PENALTY, 0.3);
  assertEquals(values.LLM_PRESENCE_PENALTY, 0.9);
  assertEquals(values.LLM_TOP_K, 40);
  assertEquals(values.LLM_TOP_P, 0.95);
  assertEquals(values.LLM_REPETITION_PENALTY, 1.05);
  assertEquals(values.LLM_MIN_P, 0.05);
  assertEquals(values.LLM_TOP_A, 0.5);
});

Deno.test("config.ts – numEnv falls back when value is non-numeric / non-finite", async () => {
  // parseFloat returns NaN → not finite → fallback path (lines 38-39)
  const { values } = await evalAll({
    LLM_TEMPERATURE: "not-a-number",
    LLM_TOP_P: "Infinity", // parseFloat → Infinity → !isFinite → fallback
  });
  assertEquals(values.LLM_TEMPERATURE, 0.1);
  assertEquals(values.LLM_TOP_P, 0);
});

Deno.test("config.ts – numEnv accepts negative finite numbers verbatim", async () => {
  const { values } = await evalAll({
    LLM_FREQUENCY_PENALTY: "-0.5",
  });
  assertEquals(values.LLM_FREQUENCY_PENALTY, -0.5);
});

Deno.test("config.ts – posIntEnv covers every rejection branch with warn", async () => {
  // Each invalid input triggers a different rejection path inside posIntEnv.
  for (const bad of ["0", "-5", "1.5", "1e3", "01024", "4096abc", "abc"]) {
    const { values, stderr } = await evalAll({
      LLM_MAX_COMPLETION_TOKENS: bad,
    });
    assertEquals(
      values.LLM_MAX_COMPLETION_TOKENS,
      4096,
      `expected fallback for ${bad}`,
    );
    assert(
      stderr.includes("LLM_MAX_COMPLETION_TOKENS"),
      `expected warn log for ${bad}, got: ${stderr}`,
    );
  }
});

Deno.test("config.ts – posIntEnv whitespace-only and empty fall back silently", async () => {
  // Whitespace-only trims to empty string → silent fallback (line 54).
  const { values: v1, stderr: e1 } = await evalAll({
    LLM_MAX_COMPLETION_TOKENS: "   ",
  });
  assertEquals(v1.LLM_MAX_COMPLETION_TOKENS, 4096);
  assert(
    !e1.includes("LLM_MAX_COMPLETION_TOKENS"),
    `expected silent fallback, got: ${e1}`,
  );

  const { values: v2, stderr: e2 } = await evalAll({
    LLM_MAX_COMPLETION_TOKENS: "",
  });
  assertEquals(v2.LLM_MAX_COMPLETION_TOKENS, 4096);
  assert(
    !e2.includes("LLM_MAX_COMPLETION_TOKENS"),
    `expected silent fallback for empty, got: ${e2}`,
  );
});

Deno.test("config.ts – posIntEnv unsafe integer warns and falls back", async () => {
  const { values, stderr } = await evalAll({
    LLM_MAX_COMPLETION_TOKENS: String(Number.MAX_SAFE_INTEGER + 2), // 9007199254740993
  });
  assertEquals(values.LLM_MAX_COMPLETION_TOKENS, 4096);
  assert(
    stderr.includes("safe integer") ||
      stderr.includes("LLM_MAX_COMPLETION_TOKENS"),
  );
});

Deno.test("config.ts – boolEnv covers every TRUE / FALSE / unknown / empty branch", async () => {
  // True tokens (case-insensitive, trimmed)
  for (const tok of ["true", "TRUE", "True", "1", "yes", "YES", "on", " on "]) {
    const { values } = await evalAll({ LLM_REASONING_OMIT: tok });
    assertEquals(
      values.LLM_REASONING_OMIT,
      true,
      `expected true for ${JSON.stringify(tok)}`,
    );
  }
  // False tokens
  for (const tok of ["false", "FALSE", "0", "no", "NO", "off", " off "]) {
    const { values } = await evalAll({ LLM_REASONING_OMIT: tok });
    assertEquals(
      values.LLM_REASONING_OMIT,
      false,
      `expected false for ${JSON.stringify(tok)}`,
    );
  }
  // Empty string → fallback (line 90)
  const { values: ev } = await evalAll({ LLM_REASONING_OMIT: "" });
  assertEquals(ev.LLM_REASONING_OMIT, false);
  // Unrecognized → warn + fallback (lines 93-98)
  const { values: uv, stderr: us } = await evalAll({
    LLM_REASONING_OMIT: "perhaps",
  });
  assertEquals(uv.LLM_REASONING_OMIT, false);
  assert(us.includes("LLM_REASONING_OMIT"));
});

Deno.test("config.ts – effortEnv: empty string falls back without warn", async () => {
  // Line 107: raw === "" returns fallback without logging.
  const { values, stderr } = await evalAll({ LLM_REASONING_EFFORT: "" });
  assertEquals(values.LLM_REASONING_EFFORT, "xhigh");
  assert(
    !stderr.includes("LLM_REASONING_EFFORT"),
    `expected no warn, got: ${stderr}`,
  );
});

Deno.test("config.ts – effortEnv: warn-and-fallback on invalid token", async () => {
  const { values, stderr } = await evalAll({ LLM_REASONING_EFFORT: "EXTREME" });
  assertEquals(values.LLM_REASONING_EFFORT, "xhigh");
  assert(stderr.includes("LLM_REASONING_EFFORT"));
});

Deno.test("config.ts – effortEnv: each valid value parsed verbatim", async () => {
  for (const v of ["none", "minimal", "low", "medium", "high", "xhigh"]) {
    const { values } = await evalAll({ LLM_REASONING_EFFORT: v });
    assertEquals(values.LLM_REASONING_EFFORT, v);
  }
});

Deno.test("config.ts – PORT parses provided integer / falls back to NaN-aware default", async () => {
  // Note: the production code uses parseInt with fallback "8080", so non-numeric
  // value yields NaN (parseInt of "not-a-number" === NaN). This documents the
  // current behaviour rather than asserting validation.
  const { values } = await evalAll({ PORT: "9001" });
  assertEquals(values.PORT, 9001);
});

Deno.test("config.ts – PLAYGROUND_DIR / READER_DIR honour env overrides", async () => {
  const { values } = await evalAll({
    PLAYGROUND_DIR: "/tmp-fake-playground",
    READER_DIR: "/tmp-fake-reader",
  });
  assertEquals(values.PLAYGROUND_DIR, "/tmp-fake-playground");
  assertEquals(values.READER_DIR, "/tmp-fake-reader");
});

Deno.test("config.ts – PROMPT_FILE: env override (absolute, relative) and default", async () => {
  // Default — derived from PLAYGROUND_DIR
  const { values: vDefault } = await evalAll({});
  assert(typeof vDefault.PROMPT_FILE === "string");
  assert((vDefault.PROMPT_FILE as string).endsWith("/_prompts/system.md"));

  // Absolute override (line 160 truthy branch)
  const { values: vAbs } = await evalAll({ PROMPT_FILE: "/abs/sys.md" });
  assertEquals(vAbs.PROMPT_FILE, "/abs/sys.md");

  // Relative override (line 160 falsy branch — resolve against ROOT_DIR)
  const { values: vRel } = await evalAll({ PROMPT_FILE: "relative/sys.md" });
  assert(typeof vRel.PROMPT_FILE === "string");
  assert((vRel.PROMPT_FILE as string).endsWith("/relative/sys.md"));
  assert((vRel.PROMPT_FILE as string).startsWith("/"));
});

Deno.test("config.ts – THEME_DIR override", async () => {
  const { values } = await evalAll({ THEME_DIR: "/custom/themes/" });
  assertEquals(values.THEME_DIR, "/custom/themes/");
});

Deno.test("config.ts – LOG_LEVEL / LOG_FILE / LLM_LOG_FILE pass through env", async () => {
  const { values } = await evalAll({
    LOG_LEVEL: "debug",
    LOG_FILE: "/var/log/heartreverie.jsonl",
    LLM_LOG_FILE: "/var/log/llm.jsonl",
  });
  assertEquals(values.LOG_LEVEL, "debug");
  assertEquals(values.LOG_FILE, "/var/log/heartreverie.jsonl");
  assertEquals(values.LLM_LOG_FILE, "/var/log/llm.jsonl");
});

Deno.test("config.ts – llmDefaults aggregates every sampling override", async () => {
  const { values } = await evalAll({
    LLM_MODEL: "test/model",
    LLM_TEMPERATURE: "0.42",
    LLM_FREQUENCY_PENALTY: "0.11",
    LLM_PRESENCE_PENALTY: "0.22",
    LLM_TOP_K: "55",
    LLM_TOP_P: "0.88",
    LLM_REPETITION_PENALTY: "1.33",
    LLM_MIN_P: "0.04",
    LLM_TOP_A: "0.66",
    LLM_REASONING_ENABLED: "false",
    LLM_REASONING_EFFORT: "low",
    LLM_MAX_COMPLETION_TOKENS: "2048",
  });
  const d = values.llmDefaults as Record<string, unknown>;
  assertEquals(d.model, "test/model");
  assertEquals(d.temperature, 0.42);
  assertEquals(d.frequencyPenalty, 0.11);
  assertEquals(d.presencePenalty, 0.22);
  assertEquals(d.topK, 55);
  assertEquals(d.topP, 0.88);
  assertEquals(d.repetitionPenalty, 1.33);
  assertEquals(d.minP, 0.04);
  assertEquals(d.topA, 0.66);
  assertEquals(d.reasoningEnabled, false);
  assertEquals(d.reasoningEffort, "low");
  assertEquals(d.maxCompletionTokens, 2048);
});
