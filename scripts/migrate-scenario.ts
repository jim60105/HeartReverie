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

// Usage: deno run --allow-read --allow-write scripts/migrate-scenario.ts [playground-dir]
//
// Migrates scenario.md files from playground/<series>/scenario.md
// to playground/lore/series/<series>/scenario.md with YAML frontmatter.

import { join } from "@std/path";

const FRONTMATTER = `---
tags: [scenario]
priority: 1000
enabled: true
---

`;

const playgroundDir = Deno.args[0] ?? "./playground";

console.log(`Scanning playground directory: ${playgroundDir}`);

let migrated = 0;
let skipped = 0;

for await (const entry of Deno.readDir(playgroundDir)) {
  if (!entry.isDirectory || entry.name.startsWith(".")) continue;

  const sourcePath = join(playgroundDir, entry.name, "scenario.md");

  try {
    await Deno.stat(sourcePath);
  } catch {
    continue;
  }

  const destDir = join(playgroundDir, "lore", "series", entry.name);
  const destPath = join(destDir, "scenario.md");

  try {
    await Deno.stat(destPath);
    console.log(`SKIP: ${destPath} already exists`);
    skipped++;
    continue;
  } catch {
    // Destination does not exist — proceed
  }

  const content = await Deno.readTextFile(sourcePath);
  await Deno.mkdir(destDir, { recursive: true });
  await Deno.writeTextFile(destPath, FRONTMATTER + content);
  console.log(`MIGRATED: ${sourcePath} → ${destPath}`);
  migrated++;
}

console.log(`\nDone. Migrated: ${migrated}, Skipped: ${skipped}`);
