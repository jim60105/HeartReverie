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

/**
 * config.ts evaluates all constants at module load time, so we use a
 * subprocess to get a fresh module evaluation with controlled env vars.
 */
async function evalConfig(env: Record<string, string>): Promise<string> {
  const script = `
    const { PROMPT_FILE } = await import("./writer/lib/config.ts");
    console.log(PROMPT_FILE);
  `;
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ["eval", "--", script],
    cwd: resolve(import.meta.dirname!, "../../.."),
    env: { ...env, NO_COLOR: "1" },
    stdout: "piped",
    stderr: "piped",
  });
  const { stdout } = await cmd.output();
  return new TextDecoder().decode(stdout).trim();
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
