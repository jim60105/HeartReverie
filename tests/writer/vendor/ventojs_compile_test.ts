// Copyright (C) 2026 Jim Chen <Jim@ChenJ.im>, licensed under AGPL-3.0-or-later
//
// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Pin: detect upstream-incompatible changes to ventojs@^2.3.1. Writer code
// assumes `env.compile(source, path?, defaults?)` is synchronous and returns
// a callable `Template` with `.source` metadata, and that the default filter
// registry is exactly `empty`/`escape`/`unescape`.

import { assert, assertEquals } from "@std/assert";
import vento from "ventojs";

Deno.test("ventojs compile() returns a callable Template synchronously", () => {
  const env = vento();
  const tpl = env.compile("hello {{ name }}");
  assertEquals(typeof tpl, "function");
  assertEquals(typeof tpl.source, "string");
  assert(tpl.source.includes("name"));
});

Deno.test("ventojs default filter registry is empty/escape/unescape only", () => {
  const env = vento();
  const filters = Object.keys(env.filters).sort();
  assertEquals(filters, ["empty", "escape", "unescape"]);
});
