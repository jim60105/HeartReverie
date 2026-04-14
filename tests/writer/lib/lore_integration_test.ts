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
import { join } from "@std/path";
import { resolveLoreVariables } from "../../../writer/lib/lore.ts";

// ── Helpers ──

/** Write a Markdown file with optional frontmatter into a directory. */
async function writePassageFile(dir: string, name: string, body: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, name), body);
}

/** Build a passage string with frontmatter. */
function passage(
  opts: { tags?: string[]; priority?: number; enabled?: boolean },
  content: string,
): string {
  const lines = ["---"];
  if (opts.tags) lines.push(`tags: [${opts.tags.join(", ")}]`);
  if (opts.priority !== undefined) lines.push(`priority: ${opts.priority}`);
  if (opts.enabled !== undefined) lines.push(`enabled: ${opts.enabled}`);
  lines.push("---", content);
  return lines.join("\n");
}

const SEP = "\n\n---\n\n";

// ── 8.1: Storage + Retrieval — all three scopes ──

Deno.test("lore integration 8.1: storage + retrieval across all scopes", async (t) => {
  const tmpDir = await Deno.makeTempDir();
  try {
    // Set up three-scope hierarchy with _lore/ co-located dirs
    await writePassageFile(
      join(tmpDir, "_lore"),
      "world-setting.md",
      passage({ tags: ["world"], priority: 100, enabled: true }, "World setting"),
    );
    await writePassageFile(
      join(tmpDir, "testSeries", "_lore", "characters"),
      "hero.md",
      passage({ tags: ["protagonist"], priority: 200, enabled: true }, "Hero description"),
    );
    await writePassageFile(
      join(tmpDir, "testSeries", "testStory", "_lore"),
      "quest.md",
      passage({ tags: ["plot"], priority: 50, enabled: true }, "Quest details"),
    );

    const { variables: vars } = await resolveLoreVariables(tmpDir, "testSeries", "testStory");

    await t.step("lore_all is sorted by priority descending (200 → 100 → 50)", () => {
      const expected = ["Hero description", "World setting", "Quest details"].join(SEP);
      assertEquals(vars.lore_all, expected);
    });

    await t.step("lore_world contains World setting", () => {
      assertEquals(vars["lore_world"], "World setting");
    });

    await t.step("lore_protagonist contains Hero description", () => {
      assertEquals(vars["lore_protagonist"], "Hero description");
    });

    await t.step("lore_characters (directory tag) contains Hero description", () => {
      assertEquals(vars["lore_characters"], "Hero description");
    });

    await t.step("lore_hero (filename tag) contains Hero description", () => {
      assertEquals(vars["lore_hero"], "Hero description");
    });

    await t.step("lore_plot contains Quest details", () => {
      assertEquals(vars["lore_plot"], "Quest details");
    });

    await t.step("lore_quest (filename tag) contains Quest details", () => {
      assertEquals(vars["lore_quest"], "Quest details");
    });

    await t.step("lore_tags contains all discovered tags including filename tags", () => {
      const tags = (vars.lore_tags as string[]).sort();
      // world, world_setting (filename), protagonist, characters, hero (filename), plot, quest (filename)
      assertEquals(tags.includes("world"), true);
      assertEquals(tags.includes("protagonist"), true);
      assertEquals(tags.includes("characters"), true);
      assertEquals(tags.includes("hero"), true);
      assertEquals(tags.includes("plot"), true);
      assertEquals(tags.includes("quest"), true);
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ── 8.2: Tag filtering with normalized names ──

Deno.test("lore integration 8.2: tag normalization in variable names", async (t) => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await writePassageFile(
      join(tmpDir, "_lore"),
      "a.md",
      passage({ tags: ["my-tag"], priority: 0, enabled: true }, "Hyphen tag"),
    );
    await writePassageFile(
      join(tmpDir, "_lore"),
      "b.md",
      passage({ tags: ["UPPER Case"], priority: 0, enabled: true }, "Upper tag"),
    );
    await writePassageFile(
      join(tmpDir, "_lore"),
      "c.md",
      passage({ tags: ["tag!@#"], priority: 0, enabled: true }, "Special tag"),
    );

    const { variables: vars } = await resolveLoreVariables(tmpDir);

    await t.step("hyphen tag → lore_my_tag", () => {
      assertEquals(vars["lore_my_tag"], "Hyphen tag");
    });

    await t.step("UPPER Case → lore_upper_case", () => {
      assertEquals(vars["lore_upper_case"], "Upper tag");
    });

    await t.step("tag!@# → lore_tag", () => {
      assertEquals(vars["lore_tag"], "Special tag");
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ── 8.3: Disabled passages excluded ──

Deno.test("lore integration 8.3: disabled passages excluded from output", async (t) => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await writePassageFile(
      join(tmpDir, "_lore"),
      "enabled.md",
      passage({ tags: ["test"], priority: 0, enabled: true }, "Visible"),
    );
    await writePassageFile(
      join(tmpDir, "_lore"),
      "disabled.md",
      passage({ tags: ["test"], priority: 0, enabled: false }, "Hidden"),
    );

    const { variables: vars } = await resolveLoreVariables(tmpDir);

    await t.step("lore_all contains Visible but not Hidden", () => {
      assertStringIncludes(vars.lore_all as string, "Visible");
      assertEquals((vars.lore_all as string).includes("Hidden"), false);
    });

    await t.step("lore_test contains Visible but not Hidden", () => {
      assertStringIncludes(vars["lore_test"] as string, "Visible");
      assertEquals((vars["lore_test"] as string).includes("Hidden"), false);
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ── 8.4: Scope isolation — no cross-scope double-counting ──

Deno.test("lore integration 8.4: scope isolation and combination", async (t) => {
  const tmpDir = await Deno.makeTempDir();
  try {
    await writePassageFile(
      join(tmpDir, "_lore"),
      "setting.md",
      passage({ tags: ["lore"], priority: 10, enabled: true }, "Global lore"),
    );
    await writePassageFile(
      join(tmpDir, "S1", "_lore"),
      "setting.md",
      passage({ tags: ["lore"], priority: 5, enabled: true }, "Series lore"),
    );

    await t.step("with series: lore_lore contains both passages", async () => {
      const { variables: vars } = await resolveLoreVariables(tmpDir, "S1");
      const loreLore = vars["lore_lore"] as string;
      assertStringIncludes(loreLore, "Global lore");
      assertStringIncludes(loreLore, "Series lore");
    });

    await t.step("with series: lore_all contains both exactly once", async () => {
      const { variables: vars } = await resolveLoreVariables(tmpDir, "S1");
      const all = vars.lore_all as string;
      // Count occurrences: each should appear exactly once
      assertEquals(all.split("Global lore").length - 1, 1);
      assertEquals(all.split("Series lore").length - 1, 1);
    });

    await t.step("with series: lore_all is sorted by priority", async () => {
      const { variables: vars } = await resolveLoreVariables(tmpDir, "S1");
      const expected = ["Global lore", "Series lore"].join(SEP);
      assertEquals(vars.lore_all, expected);
    });

    await t.step("without series: only global passages returned", async () => {
      const { variables: vars } = await resolveLoreVariables(tmpDir);
      assertEquals(vars.lore_all, "Global lore");
      assertEquals(vars["lore_lore"], "Global lore");
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

// ── 8.5: Regression — empty and edge cases ──

Deno.test("lore integration 8.5: empty lore directory and edge cases", async (t) => {
  await t.step("empty directories with nonexistent series/story do not throw", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      await Deno.mkdir(join(tmpDir, "_lore"), { recursive: true });

      const { variables: vars } = await resolveLoreVariables(tmpDir, "nonexistent", "nonexistent");
      assertEquals(vars.lore_all, "");
      assertEquals(vars.lore_tags, []);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("completely missing playground dir does not throw", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const { variables: vars } = await resolveLoreVariables(join(tmpDir, "no-such-dir"));
      assertEquals(vars.lore_all, "");
      assertEquals(vars.lore_tags, []);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("passage with no frontmatter uses defaults and still works", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      await writePassageFile(
        join(tmpDir, "_lore"),
        "bare.md",
        "Plain content with no frontmatter at all.",
      );

      const { variables: vars } = await resolveLoreVariables(tmpDir);
      assertEquals(vars.lore_all, "Plain content with no frontmatter at all.");
      // bare.md has filename tag "bare"
      assertEquals((vars.lore_tags as string[]).includes("bare"), true);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
});
