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

import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { join } from "@std/path";
import { stub } from "@std/testing/mock";
import {
  readStoryLlmConfig,
  resolveStoryLlmConfig,
  StoryConfigNotFoundError,
  StoryConfigValidationError,
  validateStoryLlmConfig,
  writeStoryLlmConfig,
} from "../../../writer/lib/story-config.ts";
import type { LlmConfig } from "../../../writer/types.ts";

const defaults: LlmConfig = {
  model: "default-model",
  temperature: 0.1,
  frequencyPenalty: 0.13,
  presencePenalty: 0.52,
  topK: 10,
  topP: 0,
  repetitionPenalty: 1.2,
  minP: 0,
  topA: 1,
  reasoningEnabled: true,
  reasoningEffort: "high",
};

Deno.test("validateStoryLlmConfig", async (t) => {
  await t.step("strips unknown keys", () => {
    const out = validateStoryLlmConfig({ temperature: 0.7, foo: "bar", __proto__: 1 });
    assertEquals(out, { temperature: 0.7 });
  });

  await t.step("drops null/undefined fields", () => {
    const out = validateStoryLlmConfig({
      model: null,
      temperature: undefined,
      topK: 5,
    });
    assertEquals(out, { topK: 5 });
  });

  await t.step("rejects non-string model", () => {
    assertThrows(
      () => validateStoryLlmConfig({ model: 42 }),
      StoryConfigValidationError,
    );
  });

  await t.step("rejects empty model", () => {
    assertThrows(
      () => validateStoryLlmConfig({ model: "" }),
      StoryConfigValidationError,
    );
  });

  await t.step("rejects non-finite numeric field", () => {
    assertThrows(
      () => validateStoryLlmConfig({ temperature: "hot" }),
      StoryConfigValidationError,
    );
    assertThrows(
      () => validateStoryLlmConfig({ topK: Number.NaN }),
      StoryConfigValidationError,
    );
    assertThrows(
      () => validateStoryLlmConfig({ topP: Number.POSITIVE_INFINITY }),
      StoryConfigValidationError,
    );
  });

  await t.step("rejects non-object input", () => {
    assertThrows(() => validateStoryLlmConfig("x"), StoryConfigValidationError);
    assertThrows(() => validateStoryLlmConfig([1, 2]), StoryConfigValidationError);
  });

  await t.step("treats null/undefined as empty", () => {
    assertEquals(validateStoryLlmConfig(null), {});
    assertEquals(validateStoryLlmConfig(undefined), {});
  });

  await t.step("accepts every whitelisted field", () => {
    const full = {
      model: "m",
      temperature: 0.5,
      frequencyPenalty: 0.1,
      presencePenalty: 0.2,
      topK: 20,
      topP: 0.9,
      repetitionPenalty: 1.1,
      minP: 0.05,
      topA: 0.8,
      reasoningEnabled: false,
      reasoningEffort: "low" as const,
    };
    assertEquals(validateStoryLlmConfig(full), full);
  });

  await t.step("drops null/undefined for reasoning fields", () => {
    assertEquals(
      validateStoryLlmConfig({
        reasoningEnabled: null,
        reasoningEffort: undefined,
      }),
      {},
    );
  });

  await t.step("accepts boolean reasoningEnabled (true and false)", () => {
    assertEquals(validateStoryLlmConfig({ reasoningEnabled: true }), {
      reasoningEnabled: true,
    });
    assertEquals(validateStoryLlmConfig({ reasoningEnabled: false }), {
      reasoningEnabled: false,
    });
  });

  await t.step("rejects non-boolean reasoningEnabled", () => {
    for (const v of ["yes", 1, 0, {}, []]) {
      assertThrows(
        () => validateStoryLlmConfig({ reasoningEnabled: v }),
        StoryConfigValidationError,
        "reasoningEnabled",
      );
    }
  });

  await t.step("accepts each of the six reasoning effort values", () => {
    for (const effort of ["none", "minimal", "low", "medium", "high", "xhigh"] as const) {
      assertEquals(validateStoryLlmConfig({ reasoningEffort: effort }), {
        reasoningEffort: effort,
      });
    }
  });

  await t.step("rejects unknown reasoningEffort", () => {
    assertThrows(
      () => validateStoryLlmConfig({ reasoningEffort: "extreme" }),
      StoryConfigValidationError,
      "reasoningEffort",
    );
  });

  await t.step("rejects mixed-case reasoningEffort (case-sensitive)", () => {
    assertThrows(
      () => validateStoryLlmConfig({ reasoningEffort: "HIGH" }),
      StoryConfigValidationError,
      "reasoningEffort",
    );
  });

  await t.step("rejects non-string reasoningEffort", () => {
    for (const v of [1, true, {}, []]) {
      assertThrows(
        () => validateStoryLlmConfig({ reasoningEffort: v }),
        StoryConfigValidationError,
        "reasoningEffort",
      );
    }
  });

  await t.step("strips foreign keys when reasoning fields are present", () => {
    assertEquals(
      validateStoryLlmConfig({
        reasoningEnabled: true,
        reasoningEffort: "medium",
        bogus: 1,
      }),
      { reasoningEnabled: true, reasoningEffort: "medium" },
    );
  });
});

Deno.test("readStoryLlmConfig / writeStoryLlmConfig round-trip", async (t) => {
  const tmpDir = await Deno.makeTempDir({ prefix: "story-config-test-" });
  try {
    await t.step("returns {} when file is absent", async () => {
      assertEquals(await readStoryLlmConfig(tmpDir), {});
    });

    await t.step("round-trip writes to _config.json and reads back", async () => {
      const persisted = await writeStoryLlmConfig(tmpDir, {
        temperature: 0.9,
        topK: 5,
        nope: "strip",
      });
      assertEquals(persisted, { temperature: 0.9, topK: 5 });

      const onDisk = await Deno.readTextFile(join(tmpDir, "_config.json"));
      const parsed = JSON.parse(onDisk);
      assertEquals(parsed, { temperature: 0.9, topK: 5 });

      assertEquals(await readStoryLlmConfig(tmpDir), { temperature: 0.9, topK: 5 });
    });

    await t.step("write empty object clears overrides", async () => {
      const persisted = await writeStoryLlmConfig(tmpDir, {});
      assertEquals(persisted, {});
      assertEquals(await readStoryLlmConfig(tmpDir), {});
    });

    await t.step("malformed JSON throws validation error", async () => {
      await Deno.writeTextFile(join(tmpDir, "_config.json"), "{ not json ");
      await assertRejects(
        () => readStoryLlmConfig(tmpDir),
        StoryConfigValidationError,
      );
    });

    await t.step("empty config file returns {}", async () => {
      await Deno.writeTextFile(join(tmpDir, "_config.json"), "   \n");
      assertEquals(await readStoryLlmConfig(tmpDir), {});
    });
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeStoryLlmConfig rejects missing story dir", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "story-config-nf-" });
  try {
    const missing = join(tmpDir, "does-not-exist");
    await assertRejects(
      () => writeStoryLlmConfig(missing, { temperature: 0.5 }),
      StoryConfigNotFoundError,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeStoryLlmConfig rejects non-directory story path", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "story-config-file-" });
  const storyFile = join(tmpDir, "story.md");
  try {
    await Deno.writeTextFile(storyFile, "not a directory");
    await assertRejects(
      () => writeStoryLlmConfig(storyFile, { temperature: 0.7 }),
      StoryConfigNotFoundError,
    );
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("readStoryLlmConfig rethrows non-notfound file errors", async () => {
  const readStub = stub(Deno, "readTextFile", () => {
    throw new Deno.errors.PermissionDenied("denied");
  });
  try {
    await assertRejects(
      () => readStoryLlmConfig("/irrelevant"),
      Deno.errors.PermissionDenied,
    );
  } finally {
    readStub.restore();
  }
});

Deno.test("writeStoryLlmConfig rethrows unexpected stat errors", async () => {
  const statStub = stub(Deno, "stat", () => {
    throw new Error("stat failed");
  });
  try {
    await assertRejects(
      () => writeStoryLlmConfig("/irrelevant", { temperature: 0.7 }),
      Error,
      "stat failed",
    );
  } finally {
    statStub.restore();
  }
});

Deno.test("writeStoryLlmConfig removes temp file when rename fails", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "story-config-rename-" });
  const renameStub = stub(Deno, "rename", () => {
    throw new Error("rename failed");
  });
  try {
    await assertRejects(
      () => writeStoryLlmConfig(tmpDir, { temperature: 0.8 }),
      Error,
      "rename failed",
    );
    const entries: string[] = [];
    for await (const entry of Deno.readDir(tmpDir)) {
      entries.push(entry.name);
    }
    assertEquals(entries.some((name) => name.endsWith(".tmp")), false);
  } finally {
    renameStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("writeStoryLlmConfig ignores chmod failures after rename", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "story-config-chmod-" });
  const chmodStub = stub(Deno, "chmod", () => {
    throw new Error("chmod unsupported");
  });
  try {
    const persisted = await writeStoryLlmConfig(tmpDir, { temperature: 0.65 });
    assertEquals(persisted, { temperature: 0.65 });
    const onDisk = JSON.parse(await Deno.readTextFile(join(tmpDir, "_config.json")));
    assertEquals(onDisk, { temperature: 0.65 });
  } finally {
    chmodStub.restore();
    await Deno.remove(tmpDir, { recursive: true });
  }
});

Deno.test("resolveStoryLlmConfig merges defaults with overrides", async () => {
  const tmpDir = await Deno.makeTempDir({ prefix: "story-config-merge-" });
  try {
    // No file → returns defaults as-is
    assertEquals(await resolveStoryLlmConfig(tmpDir, defaults), defaults);

    // With overrides → merged
    await writeStoryLlmConfig(tmpDir, { temperature: 0.9, model: "override-model" });
    const merged = await resolveStoryLlmConfig(tmpDir, defaults);
    assertEquals(merged.temperature, 0.9);
    assertEquals(merged.model, "override-model");
    assertEquals(merged.topK, defaults.topK);
    assertEquals(merged.frequencyPenalty, defaults.frequencyPenalty);
  } finally {
    await Deno.remove(tmpDir, { recursive: true });
  }
});
