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

import { assertEquals } from "@std/assert";
import { parse as parseToml } from "@std/toml";

Deno.test("default.toml palette matches theme.css custom properties", async () => {
  // Parse the TOML file
  const tomlContent = await Deno.readTextFile("themes/default.toml");
  const parsed = parseToml(tomlContent) as Record<string, unknown>;
  const palette = parsed.palette as Record<string, string>;

  // Parse the CSS file — extract all custom properties from :root
  const cssContent = await Deno.readTextFile("reader-src/src/styles/theme.css");
  const cssProps = new Map<string, string>();
  // Multi-line aware: match property declarations that may span lines
  const propRegex = /--([\w-]+)\s*:\s*([\s\S]+?)\s*;/g;
  let match;
  while ((match = propRegex.exec(cssContent)) !== null) {
    // Normalize multi-line values: collapse newlines + leading whitespace into single space
    const value = match[2]!.replace(/\n\s*/g, " ").trim();
    cssProps.set(match[1]!, value);
  }

  // Verify every CSS property is in the TOML palette and vice versa
  for (const [key, value] of cssProps) {
    const tomlValue = palette[key];
    assertEquals(
      tomlValue?.trim(),
      value.trim(),
      `CSS property --${key} value mismatch: CSS="${value}" TOML="${tomlValue}"`,
    );
  }

  for (const key of Object.keys(palette)) {
    assertEquals(
      cssProps.has(key),
      true,
      `TOML palette key "${key}" has no matching CSS custom property in theme.css`,
    );
  }

  // Verify count matches
  assertEquals(Object.keys(palette).length, cssProps.size, "Palette key count mismatch");
});
