import { errorMessage } from "../../writer/lib/errors.ts";
import type { PluginRouteContext } from "../../writer/types.ts";
import { join } from "@std/path";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

interface TextFragmentAnchor {
  prefix?: string;
  textStart: string;
  textEnd?: string;
  suffix?: string;
}

interface ClientProgressEntry {
  chapterIndex: number;
  scrollRatio: number;
  lastReadAt: string;
  selectionAnchor?: TextFragmentAnchor | null;
  clientId?: string;
  ifMatchRevision?: number;
}

interface StoredEntry {
  series: string;
  story: string;
  chapterIndex: number;
  scrollRatio: number;
  lastReadAt: string;
  selectionAnchor: TextFragmentAnchor | null;
  clientId?: string;
  serverUpdatedAt: string;
  revision: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_BODY_BYTES = 4096;
const MAX_ANCHOR_FIELD_LEN = 32;
const MAX_NAME_LEN = 128;

const RESERVED_NAMES = new Set([
  "CON", "PRN", "AUX", "NUL",
  "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
  "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidName(name: string): boolean {
  if (!name || name.length > MAX_NAME_LEN) return false;
  if (name === "." || name.includes("..") || name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (RESERVED_NAMES.has(name.toUpperCase())) return false;
  return true;
}

function isNonNegativeInteger(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isValidAnchor(a: unknown): a is TextFragmentAnchor {
  if (typeof a !== "object" || a === null || Array.isArray(a)) return false;
  const obj = a as Record<string, unknown>;
  if (typeof obj.textStart !== "string" || obj.textStart.length > MAX_ANCHOR_FIELD_LEN) return false;
  for (const key of ["prefix", "textEnd", "suffix"] as const) {
    if (key in obj && obj[key] !== undefined) {
      if (typeof obj[key] !== "string" || (obj[key] as string).length > MAX_ANCHOR_FIELD_LEN) return false;
    }
  }
  return true;
}

function validateBody(body: unknown): { ok: true; entry: ClientProgressEntry } | { ok: false; reason: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;

  if (!isNonNegativeInteger(obj.chapterIndex)) {
    return { ok: false, reason: "chapterIndex must be a non-negative integer" };
  }
  if (typeof obj.scrollRatio !== "number" || obj.scrollRatio < 0 || obj.scrollRatio > 1) {
    return { ok: false, reason: "scrollRatio must be a number between 0 and 1" };
  }
  if (typeof obj.lastReadAt !== "string" || obj.lastReadAt.length === 0) {
    return { ok: false, reason: "lastReadAt must be a non-empty string" };
  }
  if (Number.isNaN(Date.parse(obj.lastReadAt))) {
    return { ok: false, reason: "lastReadAt must be a valid ISO 8601 date" };
  }
  if ("selectionAnchor" in obj && obj.selectionAnchor !== null && obj.selectionAnchor !== undefined) {
    if (!isValidAnchor(obj.selectionAnchor)) {
      return { ok: false, reason: "selectionAnchor is invalid or fields exceed 32 chars" };
    }
  }
  if ("clientId" in obj && obj.clientId !== undefined && typeof obj.clientId !== "string") {
    return { ok: false, reason: "clientId must be a string" };
  }
  if ("ifMatchRevision" in obj && obj.ifMatchRevision !== undefined) {
    if (!isNonNegativeInteger(obj.ifMatchRevision)) {
      return { ok: false, reason: "ifMatchRevision must be a non-negative integer" };
    }
  }
  return { ok: true, entry: obj as unknown as ClientProgressEntry };
}

// ---------------------------------------------------------------------------
// Per-(series,story) mutex + revision counter
// ---------------------------------------------------------------------------

type MutexRecord = { revision: number; mutex: Promise<void> };

function acquireMutex(
  locks: Map<string, MutexRecord>,
  key: string,
): { release: () => void; record: MutexRecord } {
  let rec = locks.get(key);
  if (!rec) {
    rec = { revision: 0, mutex: Promise.resolve() };
    locks.set(key, rec);
  }

  let release!: () => void;
  const prev = rec.mutex;
  rec.mutex = new Promise<void>((resolve) => {
    release = resolve;
  });

  // Caller must `await prev` before proceeding
  const record = rec;
  return {
    release,
    record,
    // We attach prev so the caller can await it
    ...({ prev } as { prev: Promise<void> }),
  } as { release: () => void; record: MutexRecord; prev: Promise<void> };
}

// ---------------------------------------------------------------------------
// Atomic file write
// ---------------------------------------------------------------------------

async function atomicWrite(filePath: string, data: string): Promise<void> {
  const tmp = `${filePath}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, data);
  await Deno.rename(tmp, filePath);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const text = await Deno.readTextFile(filePath);
    return JSON.parse(text) as T;
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Export: register (no-op — this plugin has no backend hooks, only routes)
// ---------------------------------------------------------------------------

export function register(): void {
  // reading-progress uses registerRoutes exclusively; no backend hooks needed.
}

// ---------------------------------------------------------------------------
// Export: registerRoutes
// ---------------------------------------------------------------------------

export async function registerRoutes(ctx: PluginRouteContext): Promise<void> {
  const { app, basePath, logger, config } = ctx;
  const baseDir = join(config.PLAYGROUND_DIR, "_plugins", "reading-progress", "progress");

  await Deno.mkdir(baseDir, { recursive: true });
  logger.debug("reading-progress baseDir ready", { baseDir });

  const locks = new Map<string, MutexRecord>();

  // Resolve the file path for a (series, story) pair
  function progressPath(series: string, story: string): string {
    return join(baseDir, series, `${story}.json`);
  }

  // ------------------------------------------------------------------
  // PUT /progress/:series/:story
  // ------------------------------------------------------------------
  app.put(`${basePath}/progress/:series/:story`, async (c) => {
    const series = decodeURIComponent(c.req.param("series")!);
    const story = decodeURIComponent(c.req.param("story")!);

    if (!isValidName(series) || !isValidName(story)) {
      return c.json({ error: "invalid_identity" }, 400);
    }

    // Read raw body and enforce size limit
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return c.json({ error: "payload_too_large" }, 413);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const validation = validateBody(parsed);
    if (!validation.ok) {
      return c.json({ error: "validation_error", detail: validation.reason }, 400);
    }
    const input = validation.entry;

    const key = `${series}\0${story}`;
    const acquired = acquireMutex(locks, key) as unknown as {
      release: () => void;
      record: MutexRecord;
      prev: Promise<void>;
    };

    await acquired.prev;

    try {
      const filePath = progressPath(series, story);
      const existing = await readJsonFile<StoredEntry>(filePath);

      // Reconcile revision: max(in-memory counter, file revision) + 1
      const fileRevision = existing?.revision ?? 0;
      acquired.record.revision = Math.max(acquired.record.revision, fileRevision);
      const nextRevision = acquired.record.revision + 1;

      // Conflict detection
      let conflict = false;
      if (
        input.ifMatchRevision !== undefined &&
        existing !== null &&
        input.ifMatchRevision !== existing.revision
      ) {
        conflict = true;
      }

      const serverUpdatedAt = new Date().toISOString();
      const entry: StoredEntry = {
        series,
        story,
        chapterIndex: input.chapterIndex,
        scrollRatio: input.scrollRatio,
        lastReadAt: input.lastReadAt,
        selectionAnchor: input.selectionAnchor ?? null,
        clientId: input.clientId,
        serverUpdatedAt,
        revision: nextRevision,
      };

      await Deno.mkdir(join(baseDir, series), { recursive: true });
      await atomicWrite(filePath, JSON.stringify(entry, null, 2));
      acquired.record.revision = nextRevision;

      logger.debug("PUT progress", { series, story, revision: nextRevision, conflict });

      if (conflict) {
        return c.json({
          ok: true,
          revision: nextRevision,
          serverUpdatedAt,
          conflict: true,
          serverRevision: nextRevision,
        });
      }

      return c.json({ ok: true, revision: nextRevision, serverUpdatedAt });
    } catch (err: unknown) {
      const message = errorMessage(err);
      logger.debug("PUT progress failed", { series, story, error: message });
      return c.json({ error: "internal_error" }, 500);
    } finally {
      acquired.release();
    }
  });

  // ------------------------------------------------------------------
  // GET /progress/:series/:story
  // ------------------------------------------------------------------
  app.get(`${basePath}/progress/:series/:story`, async (c) => {
    const series = decodeURIComponent(c.req.param("series")!);
    const story = decodeURIComponent(c.req.param("story")!);

    if (!isValidName(series) || !isValidName(story)) {
      return c.json({ error: "invalid_identity" }, 400);
    }

    try {
      const entry = await readJsonFile<StoredEntry>(progressPath(series, story));
      if (!entry) {
        return c.json(null, 200);
      }
      return c.json(entry);
    } catch (err: unknown) {
      const message = errorMessage(err);
      logger.debug("GET progress failed", { series, story, error: message });
      return c.json({ error: "internal_error" }, 500);
    }
  });

  // ------------------------------------------------------------------
  // DELETE /progress/:series/:story
  // ------------------------------------------------------------------
  app.delete(`${basePath}/progress/:series/:story`, async (c) => {
    const series = decodeURIComponent(c.req.param("series")!);
    const story = decodeURIComponent(c.req.param("story")!);

    if (!isValidName(series) || !isValidName(story)) {
      return c.json({ error: "invalid_identity" }, 400);
    }

    try {
      await Deno.remove(progressPath(series, story));
      logger.debug("DELETE progress", { series, story });
      return c.json({ ok: true });
    } catch (err: unknown) {
      if (err instanceof Deno.errors.NotFound) {
        return c.json({ error: "not_found" }, 404);
      }
      const message = errorMessage(err);
      logger.debug("DELETE progress failed", { series, story, error: message });
      return c.json({ error: "internal_error" }, 500);
    }
  });

  // ------------------------------------------------------------------
  // GET /progress  (list all)
  // ------------------------------------------------------------------
  app.get(`${basePath}/progress`, async (c) => {
    const entries: StoredEntry[] = [];
    try {
      for await (const seriesDir of Deno.readDir(baseDir)) {
        if (!seriesDir.isDirectory) continue;
        const seriesPath = join(baseDir, seriesDir.name);
        for await (const file of Deno.readDir(seriesPath)) {
          if (!file.isFile || !file.name.endsWith(".json")) continue;
          try {
            const text = await Deno.readTextFile(join(seriesPath, file.name));
            entries.push(JSON.parse(text) as StoredEntry);
          } catch (err: unknown) {
            const message = errorMessage(err);
            logger.debug("Skipping corrupt progress file", {
              series: seriesDir.name,
              file: file.name,
              error: message,
            });
          }
        }
      }
    } catch (err: unknown) {
      if (!(err instanceof Deno.errors.NotFound)) {
        const message = errorMessage(err);
        logger.debug("List progress failed", { error: message });
        return c.json({ error: "internal_error" }, 500);
      }
    }

    return c.json(entries);
  });

  // ------------------------------------------------------------------
  // POST /import-local
  // ------------------------------------------------------------------
  app.post(`${basePath}/import-local`, async (c) => {
    const raw = await c.req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES * 100) {
      return c.json({ error: "payload_too_large" }, 413);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return c.json({ error: "validation_error", detail: "body must be a JSON object" }, 400);
    }

    const body = parsed as Record<string, unknown>;
    if (!Array.isArray(body.entries)) {
      return c.json({ error: "validation_error", detail: "entries must be an array" }, 400);
    }

    const dryRun = body.dryRun === true;
    const clientEntries = body.entries as unknown[];

    const written: string[] = [];
    const conflicts: string[] = [];
    const skipped: string[] = [];

    for (const raw of clientEntries) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        skipped.push("(invalid)");
        continue;
      }
      const obj = raw as Record<string, unknown>;
      const series = typeof obj.series === "string" ? obj.series : "";
      const story = typeof obj.story === "string" ? obj.story : "";

      if (!isValidName(series) || !isValidName(story)) {
        skipped.push(`${series || "(empty)"}/${story || "(empty)"}`);
        continue;
      }

      const validation = validateBody(obj);
      if (!validation.ok) {
        skipped.push(`${series}/${story}`);
        continue;
      }
      const input = validation.entry;

      const label = `${series}/${story}`;
      const filePath = progressPath(series, story);
      const existing = await readJsonFile<StoredEntry>(filePath);

      // Skip if identical (same series+story+clientId+lastReadAt)
      if (
        existing &&
        existing.clientId === input.clientId &&
        existing.lastReadAt === input.lastReadAt
      ) {
        skipped.push(label);
        continue;
      }

      if (existing) {
        conflicts.push(label);
      }

      if (dryRun) {
        // In dry-run, treat non-skipped entries as "would write"
        if (!existing) {
          written.push(label);
        }
        continue;
      }

      // Write mode: acquire mutex, assign revision (LWW)
      const key = `${series}\0${story}`;
      const acquired = acquireMutex(locks, key) as unknown as {
        release: () => void;
        record: MutexRecord;
        prev: Promise<void>;
      };
      await acquired.prev;

      try {
        // Re-read inside mutex for accurate revision
        const fresh = await readJsonFile<StoredEntry>(filePath);
        const fileRevision = fresh?.revision ?? 0;
        acquired.record.revision = Math.max(acquired.record.revision, fileRevision);
        const nextRevision = acquired.record.revision + 1;

        const serverUpdatedAt = new Date().toISOString();
        const entry: StoredEntry = {
          series,
          story,
          chapterIndex: input.chapterIndex,
          scrollRatio: input.scrollRatio,
          lastReadAt: input.lastReadAt,
          selectionAnchor: input.selectionAnchor ?? null,
          clientId: input.clientId,
          serverUpdatedAt,
          revision: nextRevision,
        };

        await Deno.mkdir(join(baseDir, series), { recursive: true });
        await atomicWrite(filePath, JSON.stringify(entry, null, 2));
        acquired.record.revision = nextRevision;
        written.push(label);

        logger.debug("import-local wrote", { series, story, revision: nextRevision });
      } catch (err: unknown) {
        const message = errorMessage(err);
        logger.debug("import-local write failed", { series, story, error: message });
      } finally {
        acquired.release();
      }
    }

    if (dryRun) {
      return c.json({ wouldWrite: written.length, conflicts: conflicts.length, skipped: skipped.length });
    }
    return c.json({ written: written.length, conflicts: conflicts.length, skipped: skipped.length });
  });

  logger.debug("reading-progress routes registered");
}
