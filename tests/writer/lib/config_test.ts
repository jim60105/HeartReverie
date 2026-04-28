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
import { resolve } from "@std/path";

// config.ts evaluates all constants at module load time, so we use a
// subprocess to get a fresh module evaluation with controlled env vars.

async function evalScript(env: Record<string, string>, script: string): Promise<{ stdout: string; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--", script],
    cwd: resolve(import.meta.dirname!, "../../.."),
    env: { ...env, NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout, stderr } = await cmd.output();
  return {
    stdout: new TextDecoder().decode(stdout).trim(),
    stderr: new TextDecoder().decode(stderr),
  };
}

async function evalConfig(env: Record<string, string>): Promise<string> {
  const script = `
    const { PROMPT_FILE } = await import("./writer/lib/config.ts");
    console.log(PROMPT_FILE);
  `;
  const { stdout } = await evalScript(env, script);
  return stdout;
}

async function evalReasoningEnv(env: Record<string, string>): Promise<{
  enabled: boolean;
  effort: string;
  omit: boolean;
  stderr: string;
}> {
  const script = `
    const c = await import("./writer/lib/config.ts");
    console.log(JSON.stringify({
      enabled: c.LLM_REASONING_ENABLED,
      effort: c.LLM_REASONING_EFFORT,
      omit: c.LLM_REASONING_OMIT,
    }));
  `;
  const { stdout, stderr } = await evalScript(env, script);
  const parsed = JSON.parse(stdout);
  return { ...parsed, stderr };
}

Deno.test("PROMPT_FILE defaults to _prompts/system.md when env var is unset", async () => {
  const result = await evalConfig({});
  assert(result.endsWith("_prompts/system.md"), `Expected path ending with _prompts/system.md, got: ${result}`);
  assert(result.includes("playground"), `Expected path containing playground, got: ${result}`);
});

Deno.test("PROMPT_FILE uses env var when set (absolute path)", async () => {
  const result = await evalConfig({ PROMPT_FILE: "/custom/path/prompt.md" });
  assertEquals(result, "/custom/path/prompt.md");
});

Deno.test("PROMPT_FILE resolves relative path against ROOT_DIR", async () => {
  const result = await evalConfig({ PROMPT_FILE: "my/custom.md" });
  assert(result.endsWith("my/custom.md"), `Expected path ending with my/custom.md, got: ${result}`);
  assert(!result.startsWith("my"), `Expected absolute path, got: ${result}`);
});

Deno.test("LLM_REASONING_ENABLED defaults to true when unset", async () => {
  const r = await evalReasoningEnv({});
  assertEquals(r.enabled, true);
});

Deno.test("LLM_REASONING_ENABLED accepts truthy tokens (case/whitespace)", async () => {
  for (const tok of ["true", "True", "TRUE", "1", "yes", "  on  ", "YES"]) {
    const r = await evalReasoningEnv({ LLM_REASONING_ENABLED: tok });
    assertEquals(r.enabled, true, `expected true for ${JSON.stringify(tok)}`);
  }
});

Deno.test("LLM_REASONING_ENABLED accepts falsey tokens (case/whitespace)", async () => {
  for (const tok of ["false", "FALSE", "0", "no", "off", "  No  "]) {
    const r = await evalReasoningEnv({ LLM_REASONING_ENABLED: tok });
    assertEquals(r.enabled, false, `expected false for ${JSON.stringify(tok)}`);
  }
});

Deno.test("LLM_REASONING_ENABLED falls back on empty string", async () => {
  const r = await evalReasoningEnv({ LLM_REASONING_ENABLED: "" });
  assertEquals(r.enabled, true);
});

Deno.test("LLM_REASONING_ENABLED warns and falls back on unrecognized value", async () => {
  const r = await evalReasoningEnv({ LLM_REASONING_ENABLED: "falsey" });
  assertEquals(r.enabled, true);
  assert(
    r.stderr.includes("LLM_REASONING_ENABLED") && r.stderr.toLowerCase().includes("warn"),
    `Expected warn log mentioning the variable; got stderr: ${r.stderr}`,
  );
});

Deno.test("LLM_REASONING_OMIT defaults to false and parses booleans", async () => {
  assertEquals((await evalReasoningEnv({})).omit, false);
  assertEquals((await evalReasoningEnv({ LLM_REASONING_OMIT: "true" })).omit, true);
  assertEquals((await evalReasoningEnv({ LLM_REASONING_OMIT: "0" })).omit, false);
});

Deno.test("LLM_REASONING_EFFORT defaults to high when unset", async () => {
  const r = await evalReasoningEnv({});
  assertEquals(r.effort, "high");
});

Deno.test("LLM_REASONING_EFFORT accepts every valid value (case-sensitive)", async () => {
  for (const v of ["none", "minimal", "low", "medium", "high", "xhigh"]) {
    const r = await evalReasoningEnv({ LLM_REASONING_EFFORT: v });
    assertEquals(r.effort, v);
  }
});

Deno.test("LLM_REASONING_EFFORT warns and falls back on invalid value", async () => {
  const r = await evalReasoningEnv({ LLM_REASONING_EFFORT: "extreme" });
  assertEquals(r.effort, "high");
  assert(
    r.stderr.includes("LLM_REASONING_EFFORT") && r.stderr.toLowerCase().includes("warn"),
    `Expected warn log mentioning the variable; got stderr: ${r.stderr}`,
  );
});

Deno.test("LLM_REASONING_EFFORT rejects mixed-case (case-sensitive)", async () => {
  const r = await evalReasoningEnv({ LLM_REASONING_EFFORT: "HIGH" });
  assertEquals(r.effort, "high");
});
