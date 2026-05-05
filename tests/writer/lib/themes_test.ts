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

import { assertEquals, assertExists } from "@std/assert";
import { loadThemes, getTheme, listThemes } from "../../../writer/lib/themes.ts";

const VALID_TOML = `
id = "test-theme"
label = "Test Theme"
colorScheme = "dark"
backgroundImage = "url('/assets/heart.webp')"

[palette]
panel-bg = "#123456"
text-main = "rgba(0, 0, 0, 1)"
`;

async function withTmpDir(
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await Deno.makeTempDir();
  try {
    await fn(dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("themes: parses a valid TOML file", async () => {
  await withTmpDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/test-theme.toml`, VALID_TOML);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 1);
    assertEquals(result.skipped, 0);
    const theme = getTheme("test-theme");
    assertExists(theme);
    assertEquals(theme.id, "test-theme");
    assertEquals(theme.label, "Test Theme");
    assertEquals(theme.colorScheme, "dark");
    assertEquals(theme.backgroundImage, "url('/assets/heart.webp')");
    assertEquals(theme.palette["--panel-bg"], "#123456");
    assertEquals(theme.palette["--text-main"], "rgba(0, 0, 0, 1)");
  });
});

Deno.test("themes: rejects id/filename mismatch", async () => {
  await withTmpDir(async (dir) => {
    const toml = `
id = "other-name"
label = "Mismatch"
[palette]
text-main = "#000"
`;
    await Deno.writeTextFile(`${dir}/test-theme.toml`, toml);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 0);
    assertEquals(result.skipped, 1);
    assertEquals(getTheme("other-name"), null);
    assertEquals(getTheme("test-theme"), null);
  });
});

Deno.test("themes: skips malformed TOML without throwing", async () => {
  await withTmpDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/broken.toml`, "this is [[ not valid toml");
    await Deno.writeTextFile(`${dir}/test-theme.toml`, VALID_TOML);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 1);
    assertEquals(result.skipped, 1);
  });
});

Deno.test("themes: ignores non-.toml files", async () => {
  await withTmpDir(async (dir) => {
    await Deno.writeTextFile(`${dir}/README.md`, "# Hello");
    await Deno.writeTextFile(`${dir}/notes.txt`, "notes");
    await Deno.writeTextFile(`${dir}/test-theme.toml`, VALID_TOML);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 1);
    assertEquals(result.skipped, 0);
  });
});

Deno.test("themes: missing directory yields empty index", async () => {
  const result = await loadThemes("/nonexistent-dir-that-does-not-exist-xyz");
  assertEquals(result.loaded, 0);
  assertEquals(result.skipped, 0);
  assertEquals(listThemes(), []);
});

Deno.test("themes: rejects off-origin backgroundImage (https://)", async () => {
  await withTmpDir(async (dir) => {
    const toml = `
id = "bad-bg"
label = "Bad Background"
backgroundImage = "https://example.com/bg.jpg"
[palette]
text-main = "#000"
`;
    await Deno.writeTextFile(`${dir}/bad-bg.toml`, toml);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 0);
    assertEquals(result.skipped, 1);
  });
});

Deno.test("themes: rejects protocol-relative backgroundImage (//)", async () => {
  await withTmpDir(async (dir) => {
    const toml = `
id = "proto-rel"
label = "Protocol Relative"
backgroundImage = "//cdn.example.com/bg.jpg"
[palette]
text-main = "#000"
`;
    await Deno.writeTextFile(`${dir}/proto-rel.toml`, toml);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 0);
    assertEquals(result.skipped, 1);
  });
});

Deno.test("themes: rejects relative path backgroundImage", async () => {
  await withTmpDir(async (dir) => {
    const toml = `
id = "relative"
label = "Relative Path"
backgroundImage = "assets/bg.jpg"
[palette]
text-main = "#000"
`;
    await Deno.writeTextFile(`${dir}/relative.toml`, toml);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 0);
    assertEquals(result.skipped, 1);
  });
});

Deno.test("themes: accepts url() with same-origin path", async () => {
  await withTmpDir(async (dir) => {
    const toml = `
id = "valid-path"
label = "Valid Path"
backgroundImage = "url('/assets/heart.webp')"
[palette]
text-main = "#000"
`;
    await Deno.writeTextFile(`${dir}/valid-path.toml`, toml);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 1);
    assertEquals(result.skipped, 0);
    const theme = getTheme("valid-path");
    assertExists(theme);
    assertEquals(theme.backgroundImage, "url('/assets/heart.webp')");
  });
});

Deno.test("themes: accepts url() with data: URI", async () => {
  await withTmpDir(async (dir) => {
    const toml = `
id = "data-url"
label = "Data URL"
backgroundImage = "url('data:image/png;base64,iVBORw0KGgo')"
[palette]
text-main = "#000"
`;
    await Deno.writeTextFile(`${dir}/data-url.toml`, toml);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 1);
    assertEquals(result.skipped, 0);
    const theme = getTheme("data-url");
    assertExists(theme);
    assertEquals(theme.backgroundImage, "url('data:image/png;base64,iVBORw0KGgo')");
  });
});

Deno.test("themes: accepts CSS gradient backgroundImage", async () => {
  await withTmpDir(async (dir) => {
    const toml = `
id = "gradient"
label = "Gradient BG"
backgroundImage = "linear-gradient(160deg, #F5F0E6 0%, #EDE7DB 40%, #E8E0D2 100%)"
[palette]
text-main = "#000"
`;
    await Deno.writeTextFile(`${dir}/gradient.toml`, toml);
    const result = await loadThemes(dir);
    assertEquals(result.loaded, 1);
    assertEquals(result.skipped, 0);
    const theme = getTheme("gradient");
    assertExists(theme);
    assertEquals(
      theme.backgroundImage,
      "linear-gradient(160deg, #F5F0E6 0%, #EDE7DB 40%, #E8E0D2 100%)",
    );
  });
});

Deno.test("themes: listThemes returns alphabetically sorted list", async () => {
  await withTmpDir(async (dir) => {
    const makeToml = (id: string, label: string) => `
id = "${id}"
label = "${label}"
[palette]
text-main = "#000"
`;
    await Deno.writeTextFile(`${dir}/zebra.toml`, makeToml("zebra", "Zebra"));
    await Deno.writeTextFile(`${dir}/alpha.toml`, makeToml("alpha", "Alpha"));
    await Deno.writeTextFile(`${dir}/mid.toml`, makeToml("mid", "Mid"));
    await loadThemes(dir);
    const list = listThemes();
    assertEquals(list, [
      { id: "alpha", label: "Alpha" },
      { id: "mid", label: "Mid" },
      { id: "zebra", label: "Zebra" },
    ]);
  });
});
