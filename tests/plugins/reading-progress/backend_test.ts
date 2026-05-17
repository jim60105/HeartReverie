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

import { assert, assertEquals, assertExists } from "@std/assert";
import { Hono } from "@hono/hono";
import { registerRoutes } from "../../../plugins/reading-progress/backend.ts";

// ---------------------------------------------------------------------------
// Helpers
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
// 3.1 — Auth tests (SKIPPED)
// ---------------------------------------------------------------------------
// Auth middleware (passphrase check) is mounted by the engine at /api/*,
// not by individual plugins. Plugin unit tests exercise handlers directly
// without auth middleware — auth coverage belongs to integration tests.

// ---------------------------------------------------------------------------
// 3.2 — PUT validation tests
// ---------------------------------------------------------------------------

Deno.test("PUT validation", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    // --- series / story name validation ---

    await t.step("rejects empty series (router 404 — empty path segment)", async () => {
      const res = await putProgress(app, "", "my-story", validBody());
      // Empty string → URL has // → Hono router doesn't match → 404
      assertEquals(res.status, 404);
    });

    await t.step('rejects ".." series (router 404 — path normalization)', async () => {
      const res = await putProgress(app, "..", "my-story", validBody());
      // ".." in URL path gets normalized by Hono → 404
      assertEquals(res.status, 404);
    });

    await t.step('rejects series containing "/"', async () => {
      const res = await putProgress(app, "a/b", "my-story", validBody());
      assertEquals(res.status, 400);
    });

    await t.step('rejects series containing "\\"', async () => {
      const res = await putProgress(app, "a\\b", "my-story", validBody());
      assertEquals(res.status, 400);
    });

    await t.step("rejects series >128 chars", async () => {
      const res = await putProgress(app, "x".repeat(129), "my-story", validBody());
      assertEquals(res.status, 400);
    });

    await t.step("rejects empty story (router 404 — empty path segment)", async () => {
      const res = await putProgress(app, "my-series", "", validBody());
      assertEquals(res.status, 404);
    });

    await t.step('rejects ".." story (router 404 — path normalization)', async () => {
      const res = await putProgress(app, "my-series", "..", validBody());
      assertEquals(res.status, 404);
    });

    await t.step('rejects reserved name "CON"', async () => {
      const res = await putProgress(app, "my-series", "CON", validBody());
      assertEquals(res.status, 400);
    });

    // --- payload validation ---

    await t.step("rejects scrollRatio > 1", async () => {
      const res = await putProgress(app, "s", "t", validBody({ scrollRatio: 1.5 }));
      assertEquals(res.status, 400);
    });

    await t.step("rejects negative chapterIndex", async () => {
      const res = await putProgress(app, "s", "t", validBody({ chapterIndex: -1 }));
      assertEquals(res.status, 400);
    });

    await t.step("rejects non-integer chapterIndex", async () => {
      const res = await putProgress(app, "s", "t", validBody({ chapterIndex: 1.5 }));
      assertEquals(res.status, 400);
    });

    await t.step("rejects missing lastReadAt", async () => {
      const body = { chapterIndex: 0, scrollRatio: 0 };
      const res = await putProgress(app, "s", "t", body);
      assertEquals(res.status, 400);
    });

    await t.step("rejects oversized body (>4096 bytes) with 413", async () => {
      const body = validBody({ padding: "x".repeat(5000) });
      const res = await putProgress(app, "s", "t", body);
      assertEquals(res.status, 413);
    });

    await t.step("rejects selectionAnchor missing textStart", async () => {
      const res = await putProgress(app, "s", "t", validBody({ selectionAnchor: { prefix: "a" } }));
      assertEquals(res.status, 400);
    });

    await t.step("rejects selectionAnchor textStart >32 chars", async () => {
      const res = await putProgress(
        app,
        "s",
        "t",
        validBody({ selectionAnchor: { textStart: "a".repeat(33) } }),
      );
      assertEquals(res.status, 400);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// 3.3 — PUT success tests
// ---------------------------------------------------------------------------

Deno.test("PUT success", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    await t.step("first PUT returns revision 1 with ISO serverUpdatedAt", async () => {
      const res = await putProgress(app, "seriesA", "story1", validBody());
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.revision, 1);
      assertExists(json.serverUpdatedAt);
      // Verify ISO-8601 format
      assert(!isNaN(Date.parse(json.serverUpdatedAt)), "serverUpdatedAt must be valid ISO string");
    });

    await t.step("second PUT returns revision 2 with updated serverUpdatedAt", async () => {
      const res = await putProgress(app, "seriesA", "story1", validBody({ scrollRatio: 0.9 }));
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.revision, 2);
      assertExists(json.serverUpdatedAt);
    });

    await t.step("GET returns what was PUT", async () => {
      const res = await getProgress(app, "seriesA", "story1");
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.series, "seriesA");
      assertEquals(json.story, "story1");
      assertEquals(json.chapterIndex, 3);
      assertEquals(json.scrollRatio, 0.9);
      assertEquals(json.lastReadAt, "2025-01-15T00:00:00Z");
      assertEquals(json.revision, 2);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// 3.4 — ifMatchRevision conflict detection
// ---------------------------------------------------------------------------

Deno.test("ifMatchRevision conflict detection", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    // Seed entry at revision 1
    await putProgress(app, "seriesB", "story1", validBody());

    await t.step("matching ifMatchRevision → no conflict field", async () => {
      const res = await putProgress(
        app,
        "seriesB",
        "story1",
        validBody({ ifMatchRevision: 1 }),
      );
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.conflict, undefined);
      assertEquals(json.revision, 2);
    });

    await t.step("non-matching ifMatchRevision → conflict: true", async () => {
      // Current revision is 2; send ifMatchRevision: 1 (stale)
      const res = await putProgress(
        app,
        "seriesB",
        "story1",
        validBody({ ifMatchRevision: 1 }),
      );
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.conflict, true);
      assertEquals(json.serverRevision, json.revision);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// 3.5 — Concurrent PUT (CRITICAL)
// ---------------------------------------------------------------------------

Deno.test("concurrent PUTs produce unique sequential revisions", async () => {
  const { app, tempDir } = await createTestContext();

  try {
    const N = 50;
    const promises = Array.from({ length: N }, (_, i) =>
      putProgress(app, "concSeries", "concStory", validBody({ clientId: `client-${i}` }))
    );

    const responses = await Promise.all(promises);

    // All must be 200
    for (const res of responses) {
      assertEquals(res.status, 200);
    }

    const jsons = await Promise.all(responses.map((r) => r.json()));
    const revisions = jsons.map((j: Record<string, unknown>) => j.revision as number);

    // All revisions are unique
    assertEquals(new Set(revisions).size, N);

    // Together they form {1..N}
    const sorted = [...revisions].sort((a, b) => a - b);
    assertEquals(sorted, Array.from({ length: N }, (_, i) => i + 1));

    // Final GET shows latest revision
    const getRes = await getProgress(app, "concSeries", "concStory");
    assertEquals(getRes.status, 200);
    const final = await getRes.json();
    assertEquals(final.revision, N);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// 3.6 — GET / DELETE / list
// ---------------------------------------------------------------------------

Deno.test("GET, DELETE, and list operations", async (t) => {
  const { app, tempDir } = await createTestContext();

  try {
    // Seed two entries
    await putProgress(app, "alpha", "ch1", validBody());
    await putProgress(app, "beta", "ch2", validBody({ scrollRatio: 0.1 }));

    await t.step("GET existing returns full entry", async () => {
      const res = await getProgress(app, "alpha", "ch1");
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.series, "alpha");
      assertEquals(json.story, "ch1");
      assertExists(json.revision);
      assertExists(json.serverUpdatedAt);
    });

    await t.step("GET non-existent returns 200 with null body", async () => {
      const res = await getProgress(app, "alpha", "doesnotexist");
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json, null);
    });

    await t.step("DELETE existing returns { ok: true }", async () => {
      const res = await deleteProgress(app, "alpha", "ch1");
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.ok, true);
    });

    await t.step("DELETE non-existent returns 404", async () => {
      const res = await deleteProgress(app, "alpha", "ch1");
      assertEquals(res.status, 404);
    });

    await t.step("list returns remaining entries", async () => {
      const res = await listProgress(app);
      assertEquals(res.status, 200);
      const json = await res.json();
      assert(Array.isArray(json));
      assertEquals(json.length, 1);
      assertEquals(json[0].series, "beta");
      assertEquals(json[0].story, "ch2");
    });

    await t.step("list returns multiple entries", async () => {
      // Add more entries
      await putProgress(app, "gamma", "ch3", validBody({ scrollRatio: 0.5 }));
      await putProgress(app, "delta", "ch4", validBody({ scrollRatio: 0.8 }));

      const res = await listProgress(app);
      assertEquals(res.status, 200);
      const json = await res.json();
      assert(Array.isArray(json));
      assertEquals(json.length, 3);
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// 3.7 — Import-local
// ---------------------------------------------------------------------------

Deno.test("import-local", async (t) => {
  const { app, tempDir } = await createTestContext();

  const importEntries = [
    { series: "imp1", story: "s1", ...validBody({ clientId: "c1" }) },
    { series: "imp2", story: "s2", ...validBody({ clientId: "c2", scrollRatio: 0.1 }) },
    { series: "imp3", story: "s3", ...validBody({ clientId: "c3", scrollRatio: 0.9 }) },
  ];

  try {
    await t.step("dryRun: true reports wouldWrite but creates no files", async () => {
      const res = await importLocal(app, { dryRun: true, entries: importEntries });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.wouldWrite, 3);
      assertEquals(json.conflicts, 0);
      assertEquals(json.skipped, 0);

      // Verify no files were actually created (GET returns null)
      for (const e of importEntries) {
        const get = await getProgress(app, e.series, e.story);
        assertEquals(get.status, 200);
        const body = await get.json();
        assertEquals(body, null);
      }
    });

    await t.step("dryRun: false writes all entries", async () => {
      const res = await importLocal(app, { dryRun: false, entries: importEntries });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.written, 3);
      assertEquals(json.conflicts, 0);
      assertEquals(json.skipped, 0);

      // Verify files exist via GET
      for (const e of importEntries) {
        const get = await getProgress(app, e.series, e.story);
        assertEquals(get.status, 200);
      }
    });

    await t.step("re-import identical payload is idempotent (all skipped)", async () => {
      const res = await importLocal(app, { dryRun: false, entries: importEntries });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.written, 0);
      assertEquals(json.conflicts, 0);
      assertEquals(json.skipped, 3);
    });

    await t.step("import with changed entry overwrites (LWW)", async () => {
      const changed = [
        // Same series/story but different lastReadAt → conflict + overwrite
        { series: "imp1", story: "s1", ...validBody({ clientId: "c1", lastReadAt: "2025-06-01T00:00:00Z" }) },
        // Brand new entry
        { series: "imp4", story: "s4", ...validBody({ clientId: "c4" }) },
      ];

      const res = await importLocal(app, { dryRun: false, entries: changed });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.conflicts, 1);
      assertEquals(json.written, 2); // conflict entry overwritten + new entry
    });
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});
