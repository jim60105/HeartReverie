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
import { join } from "@std/path";
import {
  collectPassagesFromScope,
  computeEffectiveTags,
  concatenateContent,
  filterByTag,
  filterEnabled,
  generateLoreVariables,
  identifyScope,
  normalizeTag,
  parseFrontmatter,
  resolveDirectoryTag,
  resolveLoreVariables,
  sortPassages,
} from "../../../writer/lib/lore.ts";
import type { LorePassage } from "../../../writer/lib/lore.ts";

// ── Helpers ──

/** Create a minimal LorePassage for pure-function tests. */
function makePassage(overrides: Partial<LorePassage> = {}): LorePassage {
  return {
    filename: "test.md",
    filepath: "/fake/test.md",
    relativePath: "test.md",
    scope: "global",
    directory: "global",
    frontmatter: { tags: [], priority: 0, enabled: true },
    effectiveTags: [],
    content: "test content",
    ...overrides,
  };
}

/** Write a Markdown file with optional frontmatter into a directory. */
async function writePassageFile(dir: string, name: string, body: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true });
  await Deno.writeTextFile(join(dir, name), body);
}

// ── parseFrontmatter ──

Deno.test("parseFrontmatter", async (t) => {
  await t.step("parses complete frontmatter with tags, priority, enabled", () => {
    const raw = [
      "---",
      "tags: [character, npc]",
      "priority: 5",
      "enabled: false",
      "---",
      "Body text here.",
    ].join("\n");
    const { frontmatter, content } = parseFrontmatter(raw);
    assertEquals(frontmatter.tags, ["character", "npc"]);
    assertEquals(frontmatter.priority, 5);
    assertEquals(frontmatter.enabled, false);
    assertEquals(content, "Body text here.");
  });

  await t.step("returns defaults when no frontmatter present", () => {
    const raw = "Just some plain text.";
    const { frontmatter, content } = parseFrontmatter(raw);
    assertEquals(frontmatter.tags, []);
    assertEquals(frontmatter.priority, 0);
    assertEquals(frontmatter.enabled, true);
    assertEquals(content, "Just some plain text.");
  });

  await t.step("defaults invalid types: string tags, string priority, string enabled", () => {
    const raw = [
      "---",
      'tags: "invalid"',
      'priority: "high"',
      'enabled: "yes"',
      "---",
      "Body.",
    ].join("\n");
    const { frontmatter } = parseFrontmatter(raw);
    assertEquals(frontmatter.tags, []);
    assertEquals(frontmatter.priority, 0);
    assertEquals(frontmatter.enabled, true);
  });

  await t.step("parses block-style YAML array for tags", () => {
    const raw = [
      "---",
      "tags:",
      "  - alpha",
      "  - beta",
      "  - gamma",
      "---",
      "Block tags body.",
    ].join("\n");
    const { frontmatter, content } = parseFrontmatter(raw);
    assertEquals(frontmatter.tags, ["alpha", "beta", "gamma"]);
    assertEquals(content, "Block tags body.");
  });

  await t.step("handles empty content after frontmatter", () => {
    const raw = [
      "---",
      "tags: [x]",
      "priority: 1",
      "enabled: true",
      "---",
      "",
    ].join("\n");
    const { frontmatter, content } = parseFrontmatter(raw);
    assertEquals(frontmatter.tags, ["x"]);
    assertEquals(frontmatter.priority, 1);
    assertEquals(content, "");
  });

  await t.step("ignores extra/unknown fields without error", () => {
    const raw = [
      "---",
      "tags: [lore]",
      "priority: 2",
      "enabled: true",
      "author: unknown",
      "version: 3",
      "---",
      "Extra fields body.",
    ].join("\n");
    const { frontmatter, content } = parseFrontmatter(raw);
    assertEquals(frontmatter.tags, ["lore"]);
    assertEquals(frontmatter.priority, 2);
    assertEquals(frontmatter.enabled, true);
    assertEquals(content, "Extra fields body.");
  });
});

// ── normalizeTag ──

Deno.test("normalizeTag", async (t) => {
  await t.step("simple tag passes through unchanged", () => {
    assertEquals(normalizeTag("character"), "character");
  });

  await t.step("hyphens converted to underscores", () => {
    assertEquals(normalizeTag("comic-relief"), "comic_relief");
  });

  await t.step("spaces to underscores and lowercased", () => {
    assertEquals(normalizeTag("Hello World"), "hello_world");
  });

  await t.step("non-ascii characters stripped", () => {
    assertEquals(normalizeTag("café"), "caf");
  });

  await t.step("reserved name 'all' returns null", () => {
    assertEquals(normalizeTag("all"), null);
  });

  await t.step("reserved name 'tags' returns null", () => {
    assertEquals(normalizeTag("tags"), null);
  });

  await t.step("empty after normalization returns null", () => {
    assertEquals(normalizeTag("@#$"), null);
  });
});

// ── identifyScope ──

Deno.test("identifyScope", async (t) => {
  await t.step("global scope", () => {
    assertEquals(identifyScope("global/file.md"), { scope: "global" });
  });

  await t.step("series scope", () => {
    assertEquals(identifyScope("series/fantasy/file.md"), {
      scope: "series",
      series: "fantasy",
    });
  });

  await t.step("story scope", () => {
    assertEquals(identifyScope("story/fantasy/quest/file.md"), {
      scope: "story",
      series: "fantasy",
      story: "quest",
    });
  });

  await t.step("subdir does not change global scope", () => {
    assertEquals(identifyScope("global/chars/file.md"), { scope: "global" });
  });

  await t.step("unknown prefix returns null", () => {
    assertEquals(identifyScope("unknown/file.md"), null);
  });

  await t.step("too few path parts returns null", () => {
    assertEquals(identifyScope("file.md"), null);
  });
});

// ── resolveDirectoryTag ──

Deno.test("resolveDirectoryTag", async (t) => {
  await t.step("global scope root → null", () => {
    assertEquals(resolveDirectoryTag("global/file.md", "global"), null);
  });

  await t.step("global subdir → directory name", () => {
    assertEquals(resolveDirectoryTag("global/characters/alice.md", "global"), "characters");
  });

  await t.step("series scope root → null", () => {
    assertEquals(resolveDirectoryTag("series/fantasy/file.md", "series"), null);
  });

  await t.step("series subdir → directory name", () => {
    assertEquals(resolveDirectoryTag("series/fantasy/npcs/bob.md", "series"), "npcs");
  });

  await t.step("story scope root → null", () => {
    assertEquals(resolveDirectoryTag("story/s/t/file.md", "story"), null);
  });

  await t.step("story subdir → directory name", () => {
    assertEquals(resolveDirectoryTag("story/s/t/locations/tavern.md", "story"), "locations");
  });
});

// ── computeEffectiveTags ──

Deno.test("computeEffectiveTags", async (t) => {
  await t.step("union of frontmatter tags and directory tag, deduplicated", () => {
    assertEquals(computeEffectiveTags(["a", "b"], "c"), ["a", "b", "c"]);
  });

  await t.step("null directory tag → frontmatter tags only", () => {
    assertEquals(computeEffectiveTags(["x", "y"], null), ["x", "y"]);
  });

  await t.step("empty frontmatter tags + directory tag → [directory tag]", () => {
    assertEquals(computeEffectiveTags([], "loc"), ["loc"]);
  });

  await t.step("duplicate between frontmatter and directory is deduplicated (case-insensitive)", () => {
    assertEquals(computeEffectiveTags(["Chars"], "chars"), ["chars"]);
  });
});

// ── filterEnabled ──

Deno.test("filterEnabled", async (t) => {
  await t.step("returns only enabled passages from a mix", () => {
    const passages = [
      makePassage({ filename: "a.md", frontmatter: { tags: [], priority: 0, enabled: true } }),
      makePassage({ filename: "b.md", frontmatter: { tags: [], priority: 0, enabled: false } }),
      makePassage({ filename: "c.md", frontmatter: { tags: [], priority: 0, enabled: true } }),
    ];
    const result = filterEnabled(passages);
    assertEquals(result.length, 2);
    assertEquals(result[0]!.filename, "a.md");
    assertEquals(result[1]!.filename, "c.md");
  });

  await t.step("all enabled → all returned", () => {
    const passages = [
      makePassage({ frontmatter: { tags: [], priority: 0, enabled: true } }),
      makePassage({ frontmatter: { tags: [], priority: 0, enabled: true } }),
    ];
    assertEquals(filterEnabled(passages).length, 2);
  });

  await t.step("all disabled → empty", () => {
    const passages = [
      makePassage({ frontmatter: { tags: [], priority: 0, enabled: false } }),
      makePassage({ frontmatter: { tags: [], priority: 0, enabled: false } }),
    ];
    assertEquals(filterEnabled(passages).length, 0);
  });
});

// ── filterByTag ──

Deno.test("filterByTag", async (t) => {
  await t.step("returns passages that have the tag", () => {
    const passages = [
      makePassage({ filename: "a.md", effectiveTags: ["npc", "lore"] }),
      makePassage({ filename: "b.md", effectiveTags: ["location"] }),
      makePassage({ filename: "c.md", effectiveTags: ["npc"] }),
    ];
    const result = filterByTag(passages, "npc");
    assertEquals(result.length, 2);
    assertEquals(result[0]!.filename, "a.md");
    assertEquals(result[1]!.filename, "c.md");
  });

  await t.step("tag not present → empty result", () => {
    const passages = [
      makePassage({ effectiveTags: ["x"] }),
    ];
    assertEquals(filterByTag(passages, "missing").length, 0);
  });

  await t.step("case-insensitive matching", () => {
    const passages = [
      makePassage({ effectiveTags: ["hero"] }),
    ];
    assertEquals(filterByTag(passages, "Hero").length, 1);
  });
});

// ── sortPassages ──

Deno.test("sortPassages", async (t) => {
  await t.step("sorts by priority descending", () => {
    const passages = [
      makePassage({ filename: "low.md", frontmatter: { tags: [], priority: 1, enabled: true } }),
      makePassage({ filename: "high.md", frontmatter: { tags: [], priority: 10, enabled: true } }),
      makePassage({ filename: "mid.md", frontmatter: { tags: [], priority: 5, enabled: true } }),
    ];
    const sorted = sortPassages(passages);
    assertEquals(sorted[0]!.filename, "high.md");
    assertEquals(sorted[1]!.filename, "mid.md");
    assertEquals(sorted[2]!.filename, "low.md");
  });

  await t.step("same priority → alphabetical by filename", () => {
    const passages = [
      makePassage({ filename: "beta.md", frontmatter: { tags: [], priority: 0, enabled: true } }),
      makePassage({ filename: "alpha.md", frontmatter: { tags: [], priority: 0, enabled: true } }),
      makePassage({ filename: "gamma.md", frontmatter: { tags: [], priority: 0, enabled: true } }),
    ];
    const sorted = sortPassages(passages);
    assertEquals(sorted[0]!.filename, "alpha.md");
    assertEquals(sorted[1]!.filename, "beta.md");
    assertEquals(sorted[2]!.filename, "gamma.md");
  });

  await t.step("mixed priorities and filenames", () => {
    const passages = [
      makePassage({ filename: "z.md", frontmatter: { tags: [], priority: 3, enabled: true } }),
      makePassage({ filename: "a.md", frontmatter: { tags: [], priority: 3, enabled: true } }),
      makePassage({ filename: "m.md", frontmatter: { tags: [], priority: 10, enabled: true } }),
    ];
    const sorted = sortPassages(passages);
    assertEquals(sorted[0]!.filename, "m.md");
    assertEquals(sorted[1]!.filename, "a.md");
    assertEquals(sorted[2]!.filename, "z.md");
  });
});

// ── concatenateContent ──

Deno.test("concatenateContent", async (t) => {
  await t.step("joins multiple passages with separator", () => {
    const passages = [
      makePassage({ content: "AAA" }),
      makePassage({ content: "BBB" }),
    ];
    assertEquals(concatenateContent(passages), "AAA\n\n---\n\nBBB");
  });

  await t.step("single passage has no separator", () => {
    assertEquals(concatenateContent([makePassage({ content: "Only" })]), "Only");
  });

  await t.step("empty list → empty string", () => {
    assertEquals(concatenateContent([]), "");
  });
});

// ── collectPassagesFromScope (filesystem) ──

Deno.test("collectPassagesFromScope", async (t) => {
  await t.step("collects .md files at scope root", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const globalDir = join(tmpDir, "global");
      await writePassageFile(globalDir, "hero.md", [
        "---",
        "tags: [character]",
        "priority: 1",
        "enabled: true",
        "---",
        "The hero.",
      ].join("\n"));

      const passages = await collectPassagesFromScope(globalDir, "global", tmpDir);
      assertEquals(passages.length, 1);
      assertEquals(passages[0]!.filename, "hero.md");
      assertEquals(passages[0]!.content, "The hero.");
      assertEquals(passages[0]!.scope, "global");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("collects files from subdirectories", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const globalDir = join(tmpDir, "global");
      const subDir = join(globalDir, "npcs");
      await writePassageFile(subDir, "bob.md", "Bob the NPC.");

      const passages = await collectPassagesFromScope(globalDir, "global", tmpDir);
      assertEquals(passages.length, 1);
      assertEquals(passages[0]!.filename, "bob.md");
      assertEquals(passages[0]!.effectiveTags, ["npcs"]);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("nonexistent directory → empty array", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const passages = await collectPassagesFromScope(join(tmpDir, "nope"), "global", tmpDir);
      assertEquals(passages.length, 0);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("disabled passages are still collected", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const globalDir = join(tmpDir, "global");
      await writePassageFile(globalDir, "off.md", [
        "---",
        "enabled: false",
        "---",
        "Disabled.",
      ].join("\n"));

      const passages = await collectPassagesFromScope(globalDir, "global", tmpDir);
      assertEquals(passages.length, 1);
      assertEquals(passages[0]!.frontmatter.enabled, false);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
});

// ── generateLoreVariables ──

Deno.test("generateLoreVariables", async (t) => {
  await t.step("generates lore_all, lore_tags, and per-tag variables", () => {
    const passages = [
      makePassage({
        filename: "a.md",
        filepath: "/a.md",
        content: "Alpha",
        effectiveTags: ["hero"],
        frontmatter: { tags: ["hero"], priority: 1, enabled: true },
      }),
      makePassage({
        filename: "b.md",
        filepath: "/b.md",
        content: "Beta",
        effectiveTags: ["villain"],
        frontmatter: { tags: ["villain"], priority: 0, enabled: true },
      }),
    ];
    const vars = generateLoreVariables(passages);
    assertEquals(vars.lore_all, "Alpha\n\n---\n\nBeta");
    assertEquals((vars.lore_tags as string[]).sort(), ["hero", "villain"]);
    assertEquals(vars["lore_hero"], "Alpha");
    assertEquals(vars["lore_villain"], "Beta");
  });

  await t.step("empty passages → empty variables", () => {
    const vars = generateLoreVariables([]);
    assertEquals(vars.lore_all, "");
    assertEquals(vars.lore_tags, []);
  });

  await t.step("disabled passages excluded from lore_all and tag content", () => {
    const passages = [
      makePassage({
        filename: "on.md",
        filepath: "/on.md",
        content: "Visible",
        effectiveTags: ["lore"],
        frontmatter: { tags: ["lore"], priority: 0, enabled: true },
      }),
      makePassage({
        filename: "off.md",
        filepath: "/off.md",
        content: "Hidden",
        effectiveTags: ["lore"],
        frontmatter: { tags: ["lore"], priority: 0, enabled: false },
      }),
    ];
    const vars = generateLoreVariables(passages);
    assertEquals(vars.lore_all, "Visible");
    assertEquals(vars["lore_lore"], "Visible");
  });

  await t.step("tag hyphens normalized to underscores in variable names", () => {
    const passages = [
      makePassage({
        filename: "a.md",
        filepath: "/a.md",
        content: "Sidekick",
        effectiveTags: ["comic-relief"],
        frontmatter: { tags: ["comic-relief"], priority: 0, enabled: true },
      }),
    ];
    const vars = generateLoreVariables(passages);
    assertEquals(vars["lore_comic_relief"], "Sidekick");
  });

  await t.step("tag with no matching enabled passages → empty string variable", () => {
    const passages = [
      makePassage({
        filename: "off.md",
        filepath: "/off.md",
        content: "Nope",
        effectiveTags: ["ghost"],
        frontmatter: { tags: ["ghost"], priority: 0, enabled: false },
      }),
    ];
    const vars = generateLoreVariables(passages);
    assertEquals(vars["lore_ghost"], "");
  });

  await t.step("scenario tag → lore_scenario variable generated", () => {
    const passages = [
      makePassage({
        filename: "s.md",
        filepath: "/s.md",
        content: "Scene setup",
        effectiveTags: ["scenario"],
        frontmatter: { tags: ["scenario"], priority: 0, enabled: true },
      }),
    ];
    const vars = generateLoreVariables(passages);
    assertEquals(vars["lore_scenario"], "Scene setup");
  });
});

// ── resolveLoreVariables (integration) ──

Deno.test("resolveLoreVariables", async (t) => {
  await t.step("multi-scope resolution: global + series + story", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      await writePassageFile(join(tmpDir, "global"), "world.md", [
        "---",
        "tags: [world]",
        "priority: 10",
        "enabled: true",
        "---",
        "World lore.",
      ].join("\n"));

      await writePassageFile(join(tmpDir, "series", "fantasy"), "magic.md", [
        "---",
        "tags: [magic]",
        "priority: 5",
        "enabled: true",
        "---",
        "Magic system.",
      ].join("\n"));

      await writePassageFile(join(tmpDir, "story", "fantasy", "quest"), "quest.md", [
        "---",
        "tags: [quest]",
        "priority: 1",
        "enabled: true",
        "---",
        "Quest details.",
      ].join("\n"));

      const vars = await resolveLoreVariables(tmpDir, "fantasy", "quest");
      // lore_all should contain all three, sorted by priority desc
      assertEquals(vars.lore_all.includes("World lore."), true);
      assertEquals(vars.lore_all.includes("Magic system."), true);
      assertEquals(vars.lore_all.includes("Quest details."), true);
      assertEquals(vars["lore_world"], "World lore.");
      assertEquals(vars["lore_magic"], "Magic system.");
      assertEquals(vars["lore_quest"], "Quest details.");
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });

  await t.step("no passages → empty variables", async () => {
    const tmpDir = await Deno.makeTempDir();
    try {
      const vars = await resolveLoreVariables(tmpDir);
      assertEquals(vars.lore_all, "");
      assertEquals(vars.lore_tags, []);
    } finally {
      await Deno.remove(tmpDir, { recursive: true });
    }
  });
});
