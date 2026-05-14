// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU AFFERO GENERAL PUBLIC LICENSE as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

import { assert, assertEquals } from "@std/assert";
import { join, fromFileUrl, dirname } from "@std/path";

const here = dirname(fromFileUrl(import.meta.url));
const scriptPath = join(here, "..", "introspect-hooks.ts");

Deno.test({
  name: "introspect-hooks CLI",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async (t) => {
    await t.step("exits 0 and emits valid JSON shape, no passphrase leak", async () => {
      const sentinel = "passphrase-sentinel-9f3a";
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "--allow-read",
          "--allow-write",
          "--allow-env",
          "--allow-net",
          "--allow-run",
          scriptPath,
        ],
        env: {
          PASSPHRASE: sentinel,
          PLUGIN_DIR: "",
          LOG_LEVEL: "error",
        },
        clearEnv: false,
        stdout: "piped",
        stderr: "piped",
      });
      const out = await cmd.output();
      const stdout = new TextDecoder().decode(out.stdout);
      const stderr = new TextDecoder().decode(out.stderr);
      assertEquals(out.code, 0, `non-zero exit; stderr=${stderr}`);

      const json = JSON.parse(stdout);
      for (const k of ["backend", "manifestDeclarations", "stripTags", "pipelineFields", "generatedAt"]) {
        assert(k in json, `missing key '${k}' in CLI output`);
      }
      assert(!stdout.includes(sentinel), "passphrase sentinel leaked to stdout");
      assert(!stderr.includes(sentinel), "passphrase sentinel leaked to stderr");
    });
  },
});
