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

import { assert, assertEquals, assertFalse } from "@std/assert";

Deno.test("polish plugin.json is valid JSON with correct structure", async () => {
  const raw = await Deno.readTextFile("plugins/polish/plugin.json");
  const manifest = JSON.parse(raw);

  assertEquals(manifest.name, "polish");
  assertEquals(manifest.type, "full-stack");
  assertEquals(manifest.frontendModule, "./frontend.js");
  assert(Array.isArray(manifest.actionButtons));
  assertEquals(manifest.actionButtons.length, 1);
  assertEquals(manifest.actionButtons[0].id, "polish");
  assertEquals(manifest.actionButtons[0].visibleWhen, "last-chapter-backend");
  assert(typeof manifest.actionButtons[0].label === "string");
  assert(manifest.actionButtons[0].label.length > 0);
  assert(manifest.actionButtons[0].label.length <= 40);
});

Deno.test("polish-instruction.md is SFW — no forbidden content", async () => {
  const content = await Deno.readTextFile(
    "plugins/polish/polish-instruction.md",
  );
  const forbidden = [
    /18\+/i,
    /NSFW/i,
    /RPJB/i,
    /no content restrictions/i,
    /jailbreak/i,
    /bypass/i,
    /DO NOT DISCLOSE/i,
  ];
  for (const pattern of forbidden) {
    assertFalse(
      pattern.test(content),
      `polish-instruction.md must not match ${pattern}`,
    );
  }
});

Deno.test("polish-instruction.md has correct Vento message structure", async () => {
  const content = await Deno.readTextFile(
    "plugins/polish/polish-instruction.md",
  );

  const systemMatches = content.match(/\{\{\s*message\s+"system"\s*\}\}/g);
  assertEquals(
    systemMatches?.length,
    1,
    'Expected exactly one {{ message "system" }} block',
  );

  const userMatches = content.match(/\{\{\s*message\s+"user"\s*\}\}/g);
  assertEquals(
    userMatches?.length,
    1,
    'Expected exactly one {{ message "user" }} block',
  );

  assert(content.includes("{{ draft }}"), "Must include {{ draft }} variable");
  assert(content.includes("<draft>"), "Must wrap draft in <draft> tags");
  assert(content.includes("</draft>"), "Must close </draft> tags");
});

Deno.test("polish frontend.js exists and exports register", async () => {
  const stat = await Deno.stat("plugins/polish/frontend.js");
  assert(stat.isFile, "frontend.js must be a file");

  const content = await Deno.readTextFile("plugins/polish/frontend.js");
  assert(
    content.includes("export function register"),
    "Must export register function",
  );
  assert(
    content.includes("action-button:click"),
    "Must subscribe to action-button:click",
  );
  assert(
    content.includes("replace: true"),
    "Must pass replace: true to runPluginPrompt",
  );
});
