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
import { Hono } from "@hono/hono";
import { register, registerRoutes } from "../../../plugins/reading-progress/backend.ts";
import { join } from "@std/path";

// ---------------------------------------------------------------------------
// Helpers (mirror main test file)
// ---------------------------------------------------------------------------

const BASE = "/api/plugins/reading-progress";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    chapterIndex: 3,
    scrollRatio: 0.42,
    lastReadAt: "2025-01-15T00:00:00Z",
    ...overrides,
  };
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  withContext: () => noopLogger,
};

async function createTestContext() {
  const tempDir = await Deno.makeTempDir();
  const app = new Hono();

  await registerRoutes({
    app,
    basePath: BASE,
    logger: noopLogger as Parameters<typeof registerRoutes>[0]["logger"],
    getSettings: async () => ({}),
    saveSettings: async () => {},
    config: { PLAYGROUND_DIR: tempDir } as Parameters<typeof registerRoutes>[0]["config"],
  });

  return { app, tempDir };
}

function putProgress(app: Hono, series: string, story: string, body: unknown) {
  return app.request(
    `${BASE}/progress/${encodeURIComponent(series)}/${encodeURIComponent(story)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function getProgress(app: Hono, series: string, story: string) {
  return app.request(
    `${BASE}/progress/${encodeURIComponent(series)}/${encodeURIComponent(story)}`,
    { method: "GET" },
  );
}

function deleteProgress(app: Hono, series: string, story: string) {
  return app.request(
    `${BASE}/progress/${encodeURIComponent(series)}/${encodeURIComponent(story)}`,
    { method: "DELETE" },
  );
}

function listProgress(app: Hono) {
  return app.request(`${BASE}/progress`, { method: "GET" });
}

function importLocal(app: Hono, body: unknown) {
  return app.request(`${BASE}/import-local`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// register() — no-op export
// ---------------------------------------------------------------------------

Deno.test("register() is a no-op that does not throw", () => {
  register();
});

// ---------------------------------------------------------------------------
// PUT — additional validation edge cases
// ---------------------------------------------------------------------------

Deno.test("PUT additional validation", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    await t.step("rejects non-JSON body with 400", async () => {
      const res = await app.request(
        `${BASE}/progress/s/t`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "this is not json",
        },
      );
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "invalid_json");
    });

    await t.step("rejects array body with 400", async () => {
      const res = await putProgress(app, "s", "t", [1, 2, 3]);
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "validation_error");
      assertEquals(json.detail, "body must be a JSON object");
    });

    await t.step("rejects scrollRatio < 0", async () => {
      const res = await putProgress(app, "s", "t", validBody({ scrollRatio: -0.1 }));
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "validation_error");
    });

    await t.step("rejects empty lastReadAt", async () => {
      const res = await putProgress(app, "s", "t", validBody({ lastReadAt: "" }));
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.detail, "lastReadAt must be a non-empty string");
    });

    await t.step("rejects invalid ISO date in lastReadAt", async () => {
      const res = await putProgress(app, "s", "t", validBody({ lastReadAt: "not-a-date" }));
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.detail, "lastReadAt must be a valid ISO 8601 date");
    });

    await t.step("rejects non-string clientId", async () => {
      const res = await putProgress(app, "s", "t", validBody({ clientId: 123 }));
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.detail, "clientId must be a string");
    });

    await t.step("rejects non-integer ifMatchRevision", async () => {
      const res = await putProgress(app, "s", "t", validBody({ ifMatchRevision: 1.5 }));
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.detail, "ifMatchRevision must be a non-negative integer");
    });

    await t.step("rejects negative ifMatchRevision", async () => {
      const res = await putProgress(app, "s", "t", validBody({ ifMatchRevision: -1 }));
      assertEquals(res.status, 400);
    });

    await t.step("rejects selectionAnchor that is an array", async () => {
      const res = await putProgress(app, "s", "t", validBody({ selectionAnchor: [1] }));
      assertEquals(res.status, 400);
    });

    await t.step("rejects selectionAnchor with non-string optional field", async () => {
      const res = await putProgress(
        app,
        "s",
        "t",
        validBody({ selectionAnchor: { textStart: "x", prefix: 999 } }),
      );
      assertEquals(res.status, 400);
    });

    await t.step("rejects selectionAnchor with optional field >32 chars", async () => {
      const res = await putProgress(
        app,
        "s",
        "t",
        validBody({ selectionAnchor: { textStart: "x", suffix: "z".repeat(33) } }),
      );
      assertEquals(res.status, 400);
    });

    await t.step("accepts selectionAnchor with all valid optional fields", async () => {
      const res = await putProgress(
        app,
        "s",
        "anchor-ok",
        validBody({
          selectionAnchor: {
            textStart: "hello",
            textEnd: "world",
            prefix: "pre",
            suffix: "suf",
          },
        }),
      );
      assertEquals(res.status, 200);
    });

    await t.step("accepts selectionAnchor as null", async () => {
      const res = await putProgress(app, "s", "anchor-null", validBody({ selectionAnchor: null }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.ok, true);
    });

    await t.step('rejects reserved name "NUL" (case-insensitive)', async () => {
      const res = await putProgress(app, "nul", "story", validBody());
      assertEquals(res.status, 400);
    });

    await t.step('rejects series name "." (dot) — router normalizes to 404', async () => {
      const res = await putProgress(app, ".", "story", validBody());
      // "." in URL path gets normalized by Hono → 404
      assertEquals(res.status, 404);
    });

    await t.step("rejects series containing null byte", async () => {
      const res = await putProgress(app, "abc\0def", "story", validBody());
      assertEquals(res.status, 400);
    });

    await t.step("rejects chapterIndex as string", async () => {
      const res = await putProgress(app, "s", "t", validBody({ chapterIndex: "three" }));
      assertEquals(res.status, 400);
    });

    await t.step("accepts scrollRatio at exact boundary 0", async () => {
      const res = await putProgress(app, "s", "bound0", validBody({ scrollRatio: 0 }));
      assertEquals(res.status, 200);
    });

    await t.step("accepts scrollRatio at exact boundary 1", async () => {
      const res = await putProgress(app, "s", "bound1", validBody({ scrollRatio: 1 }));
      assertEquals(res.status, 200);
    });

    await t.step("accepts valid string clientId", async () => {
      const res = await putProgress(app, "s", "cid", validBody({ clientId: "browser-1" }));
      assertEquals(res.status, 200);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// PUT — conflict response shape
// ---------------------------------------------------------------------------

Deno.test("PUT conflict response contains all required fields", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    // Seed at revision 1
    await putProgress(app, "cx", "s1", validBody());
    // Advance to revision 2
    await putProgress(app, "cx", "s1", validBody({ scrollRatio: 0.5 }));

    await t.step(
      "conflict response has ok, revision, serverUpdatedAt, conflict, serverRevision",
      async () => {
        const res = await putProgress(app, "cx", "s1", validBody({ ifMatchRevision: 1 }));
        assertEquals(res.status, 200);
        const json = await res.json();
        assertEquals(json.ok, true);
        assertEquals(json.conflict, true);
        assertEquals(typeof json.revision, "number");
        assertEquals(typeof json.serverUpdatedAt, "string");
        assertEquals(json.serverRevision, json.revision);
      },
    );

    await t.step(
      "ifMatchRevision: 0 on first PUT does not trigger conflict (no existing entry)",
      async () => {
        const res = await putProgress(app, "cx", "new-story", validBody({ ifMatchRevision: 0 }));
        assertEquals(res.status, 200);
        const json = await res.json();
        assertEquals(json.conflict, undefined);
      },
    );
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// Concurrent PUTs to the SAME (series,story) — mutex serialization
// ---------------------------------------------------------------------------

Deno.test("concurrent PUTs are serialized by mutex (no lost updates)", async () => {
  const { app, tempDir } = await createTestContext();

  try {
    // Fire 10 PUTs concurrently, each with a unique scrollRatio
    const N = 10;
    const promises = Array.from(
      { length: N },
      (_, i) =>
        putProgress(
          app,
          "mutex-series",
          "mutex-story",
          validBody({ scrollRatio: i / N, clientId: `m-${i}` }),
        ),
    );
    const responses = await Promise.all(promises);

    const jsons = await Promise.all(responses.map((r) => r.json()));
    const revisions = jsons.map((j: Record<string, unknown>) => j.revision as number);

    // All unique, sequential 1..N
    assertEquals(new Set(revisions).size, N);
    const sorted = [...revisions].sort((a, b) => a - b);
    assertEquals(sorted[0], 1);
    assertEquals(sorted[sorted.length - 1], N);

    // Final state is consistent (file revision = N)
    const getRes = await getProgress(app, "mutex-series", "mutex-story");
    const final = await getRes.json();
    assertEquals(final.revision, N);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// DELETE — additional cases
// ---------------------------------------------------------------------------

Deno.test("DELETE additional cases", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    await t.step("DELETE with invalid series name returns 400", async () => {
      const res = await deleteProgress(app, "a/b", "story");
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "invalid_identity");
    });

    await t.step("DELETE with invalid story name returns 400", async () => {
      const res = await deleteProgress(app, "series", "CON");
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "invalid_identity");
    });

    await t.step("DELETE non-existent progress file returns 404", async () => {
      const res = await deleteProgress(app, "no-such-series", "no-such-story");
      assertEquals(res.status, 404);
      const json = await res.json();
      assertEquals(json.error, "not_found");
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// GET — additional cases
// ---------------------------------------------------------------------------

Deno.test("GET additional cases", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    await t.step("GET with invalid series name returns 400", async () => {
      const res = await getProgress(app, "a\\b", "story");
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "invalid_identity");
    });

    await t.step("GET with invalid story name returns 400", async () => {
      const res = await getProgress(app, "series", "LPT1");
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "invalid_identity");
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// GET list — empty directory
// ---------------------------------------------------------------------------

Deno.test("list returns empty array when no progress exists", async () => {
  const { app, tempDir } = await createTestContext();

  try {
    const res = await listProgress(app);
    assertEquals(res.status, 200);
    const json = await res.json();
    assert(Array.isArray(json));
    assertEquals(json.length, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// GET list — skips corrupt JSON files
// ---------------------------------------------------------------------------

Deno.test("list skips corrupt JSON files and returns valid entries", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    // Seed a valid entry
    await putProgress(app, "valid-series", "valid-story", validBody());

    // Create a corrupt JSON file in the progress directory
    const corruptDir = join(tempDir, "_plugins", "reading-progress", "progress", "corrupt-series");
    await Deno.mkdir(corruptDir, { recursive: true });
    await Deno.writeTextFile(join(corruptDir, "bad.json"), "not valid json {{{");

    await t.step("list includes valid entry and skips corrupt file", async () => {
      const res = await listProgress(app);
      assertEquals(res.status, 200);
      const json = await res.json();
      assert(Array.isArray(json));
      assertEquals(json.length, 1);
      assertEquals(json[0].series, "valid-series");
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// GET list — skips non-directory and non-json entries
// ---------------------------------------------------------------------------

Deno.test("list skips non-directory files in baseDir and non-json files in series dirs", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    // Seed a valid entry
    await putProgress(app, "good", "entry", validBody());

    const progressDir = join(tempDir, "_plugins", "reading-progress", "progress");

    // Create a regular file in baseDir (should be skipped as it's not a directory)
    await Deno.writeTextFile(join(progressDir, "stray-file.txt"), "stray");

    // Create a non-json file inside a series directory
    const seriesDir = join(progressDir, "good");
    await Deno.writeTextFile(join(seriesDir, "notes.txt"), "some notes");

    await t.step("only returns json entries from series subdirectories", async () => {
      const res = await listProgress(app);
      assertEquals(res.status, 200);
      const json = await res.json();
      assert(Array.isArray(json));
      assertEquals(json.length, 1);
      assertEquals(json[0].series, "good");
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// import-local — mixed valid/invalid entries
// ---------------------------------------------------------------------------

Deno.test("import-local mixed entries", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    await t.step("counts invalid entries in skipped", async () => {
      const entries = [
        { series: "ok", story: "s1", ...validBody() },
        // Invalid: array instead of object
        [1, 2, 3],
        // Invalid: missing series name
        { series: "", story: "s2", ...validBody() },
        // Invalid: bad chapterIndex
        {
          series: "ok",
          story: "bad",
          chapterIndex: -1,
          scrollRatio: 0.5,
          lastReadAt: "2025-01-01T00:00:00Z",
        },
        // Valid entry
        { series: "ok", story: "s3", ...validBody({ scrollRatio: 0.8 }) },
      ];
      const res = await importLocal(app, { entries });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.written, 2); // ok/s1 and ok/s3
      assertEquals(json.skipped, 3); // array, empty series, bad chapterIndex
      assertEquals(json.conflicts, 0);
    });

    await t.step("skips entries with missing story name", async () => {
      const entries = [
        { series: "x", story: "", ...validBody() },
      ];
      const res = await importLocal(app, { entries });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.skipped, 1);
      assertEquals(json.written, 0);
    });

    await t.step("skips entries with reserved name as series", async () => {
      const entries = [
        { series: "COM1", story: "s1", ...validBody() },
      ];
      const res = await importLocal(app, { entries });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.skipped, 1);
    });

    await t.step("skips entries with non-string series/story", async () => {
      const entries = [
        { series: 123, story: "s1", ...validBody() },
        { series: "ok", story: null, ...validBody() },
      ];
      const res = await importLocal(app, { entries });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.skipped, 2);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// import-local — validation edge cases
// ---------------------------------------------------------------------------

Deno.test("import-local validation edge cases", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    await t.step("rejects non-JSON body", async () => {
      const res = await app.request(`${BASE}/import-local`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "invalid_json");
    });

    await t.step("rejects array body", async () => {
      const res = await importLocal(app, [1, 2, 3]);
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "validation_error");
      assertEquals(json.detail, "body must be a JSON object");
    });

    await t.step("rejects body without entries array", async () => {
      const res = await importLocal(app, { entries: "not-an-array" });
      assertEquals(res.status, 400);
      const json = await res.json();
      assertEquals(json.error, "validation_error");
      assertEquals(json.detail, "entries must be an array");
    });

    await t.step("rejects oversized import body (>4096*100 bytes)", async () => {
      // 4096 * 100 = 409600 bytes limit; need body bigger than that after JSON.stringify
      const bigBody = {
        entries: [{ series: "x", story: "y", ...validBody({ padding: "z".repeat(500_000) }) }],
      };
      const res = await app.request(`${BASE}/import-local`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bigBody),
      });
      assertEquals(res.status, 413);
      const json = await res.json();
      assertEquals(json.error, "payload_too_large");
    });

    await t.step("empty entries array returns all zeros", async () => {
      const res = await importLocal(app, { entries: [] });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.written, 0);
      assertEquals(json.conflicts, 0);
      assertEquals(json.skipped, 0);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// import-local — dryRun conflict detection
// ---------------------------------------------------------------------------

Deno.test("import-local dryRun reports conflicts without writing", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    // Seed existing entry
    await putProgress(app, "dr", "s1", validBody({ clientId: "orig" }));

    await t.step("dryRun with existing entry that differs reports conflict", async () => {
      const entries = [
        {
          series: "dr",
          story: "s1",
          ...validBody({ clientId: "orig", lastReadAt: "2026-01-01T00:00:00Z" }),
        },
        { series: "dr", story: "new-story", ...validBody() },
      ];
      const res = await importLocal(app, { dryRun: true, entries });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.wouldWrite, 1); // only new-story counted as wouldWrite
      assertEquals(json.conflicts, 1); // dr/s1 conflicts
      assertEquals(json.skipped, 0);
    });

    await t.step("original entry unchanged after dryRun", async () => {
      const res = await getProgress(app, "dr", "s1");
      const json = await res.json();
      assertEquals(json.lastReadAt, "2025-01-15T00:00:00Z");
      assertEquals(json.revision, 1);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// import-local — dryRun skip identical entries
// ---------------------------------------------------------------------------

Deno.test("import-local dryRun skips identical entries", async () => {
  const { app, tempDir } = await createTestContext();

  try {
    // Seed
    await putProgress(app, "idem", "s1", validBody({ clientId: "c1" }));

    // Import identical (same clientId + lastReadAt)
    const entries = [
      { series: "idem", story: "s1", ...validBody({ clientId: "c1" }) },
    ];
    const res = await importLocal(app, { dryRun: true, entries });
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.skipped, 1);
    assertEquals(json.wouldWrite, 0);
    assertEquals(json.conflicts, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// PUT — selectionAnchor stored as null when omitted
// ---------------------------------------------------------------------------

Deno.test("PUT stores selectionAnchor as null when not provided", async () => {
  const { app, tempDir } = await createTestContext();

  try {
    await putProgress(app, "anchor-test", "s1", validBody());
    const res = await getProgress(app, "anchor-test", "s1");
    const json = await res.json();
    assertEquals(json.selectionAnchor, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// PUT — revision recovery from file after mutex map is cold
// ---------------------------------------------------------------------------

Deno.test("revision reconciles from file when mutex record is cold", async () => {
  // Simulate: create a new app context pointing to same tempDir where
  // a progress file already exists with a higher revision.
  const tempDir = await Deno.makeTempDir();

  try {
    // Pre-seed a progress file with revision 10
    const progressDir = join(tempDir, "_plugins", "reading-progress", "progress", "recon");
    await Deno.mkdir(progressDir, { recursive: true });
    await Deno.writeTextFile(
      join(progressDir, "s1.json"),
      JSON.stringify({
        series: "recon",
        story: "s1",
        chapterIndex: 0,
        scrollRatio: 0,
        lastReadAt: "2025-01-01T00:00:00Z",
        selectionAnchor: null,
        serverUpdatedAt: "2025-01-01T00:00:00Z",
        revision: 10,
      }),
    );

    // Create a new app context (cold mutex map)
    const app = new Hono();
    await registerRoutes({
      app,
      basePath: BASE,
      logger: noopLogger as Parameters<typeof registerRoutes>[0]["logger"],
      getSettings: async () => ({}),
      saveSettings: async () => {},
      config: { PLAYGROUND_DIR: tempDir } as Parameters<typeof registerRoutes>[0]["config"],
    });

    // PUT should reconcile revision from the existing file
    const res = await putProgress(app, "recon", "s1", validBody());
    assertEquals(res.status, 200);
    const json = await res.json();
    assertEquals(json.revision, 11);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// PUT — URL-encoded series/story names
// ---------------------------------------------------------------------------

Deno.test("PUT and GET with URL-encoded names containing spaces", async () => {
  const { app, tempDir } = await createTestContext();

  try {
    const res = await putProgress(app, "my series", "my story", validBody());
    assertEquals(res.status, 200);

    const getRes = await getProgress(app, "my series", "my story");
    assertEquals(getRes.status, 200);
    const json = await getRes.json();
    assertEquals(json.series, "my series");
    assertEquals(json.story, "my story");
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// PUT — reserved names cover more variants
// ---------------------------------------------------------------------------

Deno.test("PUT rejects all reserved name variants", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    const reservedNames = ["PRN", "AUX", "COM1", "COM9", "LPT1", "LPT9"];

    for (const name of reservedNames) {
      await t.step(`rejects reserved name "${name}" as story`, async () => {
        const res = await putProgress(app, "series", name, validBody());
        assertEquals(res.status, 400);
      });

      await t.step(`rejects lowercase "${name.toLowerCase()}" as series`, async () => {
        const res = await putProgress(app, name.toLowerCase(), "story", validBody());
        assertEquals(res.status, 400);
      });
    }
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
