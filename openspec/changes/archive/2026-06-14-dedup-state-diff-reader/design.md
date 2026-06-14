## Context

Two micro-formats are duplicated across the route layer:

1. **State-diff loading** — `readTextFile(NNN-state-diff.yaml)` → `parseYaml` → validate `parsed?.entries` is an array — appears verbatim at:
   - `writer/routes/chapters.ts:59-67` (batch mode, inside a per-file loop)
   - `writer/routes/chapters.ts:104-121` (single chapter read)
   - `writer/routes/ws-subscribe.ts:84-98` (poll loop; logs via `logWsError("diff-read", err)`)
   The chapters copies swallow all errors; the ws-subscribe copy logs them — already drifted.

2. **Chapter-file listing** — `/^\d+\.md$/` filter + numeric sort — is re-implemented inline in:
   - `writer/routes/ws-subscribe.ts:57-69` (readDir → filter → sort; on ANY readDir error it does `logWsError("dir-read", err); return;`)
   - `writer/routes/export.ts` (approx line 87; verify the exact shape)
   …even though `writer/lib/story-chapter-io.ts:108-121` `listChapterFiles(dir)` is the canonical helper (returns `[]` on `NotFound`, **throws** otherwise).

Types: `StateDiffPayload` is defined at `writer/types/story.ts:56` and re-exported from `writer/types.ts:59`. Logger interface in `writer/lib/logger*.ts`.

Constraints: TS strict, double quotes, semicolons, JSDoc, AGPL header on new files. Pre-release, 0 users — no migration concerns.

## Goals / Non-Goals

**Goals:**
- One `readStateDiff(dirPath, chapterNum, logger?)` helper used by all three diff-read sites, returning `StateDiffPayload | undefined` and logging non-`NotFound` failures through the optional logger.
- One `listChapterFiles()` used by ws-subscribe (and export, if semantics match), eliminating the inline listings.
- A unit test for `readStateDiff` covering valid / missing / malformed / no-entries.

**Non-Goals:**
- Touching `writer/routes/ws-chat.ts` (the `consolidate-delete-last-chapter` change removes its inline listing).
- Changing the on-disk diff format or the `StateDiffPayload` shape.
- Changing the 1-second polling architecture of ws-subscribe.

## Decisions

- **Helper signature**: `readStateDiff(dirPath: string, chapterNum: number, logger?: Pick<Logger, "warn">): Promise<StateDiffPayload | undefined>`. The optional `Pick<Logger, "warn">` lets every caller pass any object with a `warn` method (or omit it). Verify the exact `Logger` interface and adapt the `Pick<>` so the goal — "accept any object with a `warn` method" — holds. Rationale: the helper owns the NotFound-vs-other classification once, so the "log parse/permission errors but stay silent on NotFound" contract lives in exactly one place.
- **ws-subscribe diff logging adapter**: pass a `{ warn }` adapter that routes through the existing `logWsError("diff-read", …)`, OR the module's own WS logger if one exists. Inspect the top of `ws-subscribe.ts` to choose the least-contorted adapter; the only firm requirement is that non-NotFound errors still get logged on the WS path.
- **ws-subscribe listing wrapper**: `listChapterFiles` returns `[]` on NotFound and **throws** otherwise, whereas the inline copy returned early via `logWsError("dir-read", err)` on ANY readDir error. Wrap the call in a try/catch that does `logWsError("dir-read", err); return;` to preserve the early-return-on-error behavior exactly.
- **export.ts conversion is conditional**: convert to `listChapterFiles` only if export's listing has identical semantics (filter `\d+\.md`, numeric sort, tolerate-missing-dir). If it differs in any semantic way, leave it and document why in the commit message. This avoids silently changing export output.

## Risks / Trade-offs

- [ws-subscribe loses its read-error logging] → The helper's optional logger and the listing try/catch wrapper both preserve logging; a reviewer focus point is that ws-subscribe remains the consumer that historically logged read failures.
- [export.ts semantics differ] → Conditional conversion; if different, leave it and note it (a STOP-and-continue condition, not a hard stop).
- [Import cycle `story-chapter-io` ↔ `types`/`logger`] → If a cycle appears, STOP and report with the cycle path.
- [Drift if `consolidate-delete-last-chapter` / `log-swallowed-backend-errors` already landed] → Reconcile against their diffs first; the helper already implements the desired end state for the logging behavior the `log-swallowed-backend-errors` change describes.

## Migration Plan

Not applicable — pre-release, 0 users. No on-disk or wire-shape change; the call-site swaps are behavior-preserving (modulo the now-consistent non-NotFound logging).

## Dependencies / Coordination

- **Depends on `consolidate-delete-last-chapter`**: it removes the inline chapter listing from `ws-chat.ts`. Do not re-fix that listing here.
- **Coordinated with `log-swallowed-backend-errors`**: that change narrows the `chapters.ts` state-diff catches to log non-NotFound errors. If it landed first, fold its logging into this helper (which takes the optional logger) and remove the call-site logging; if this change lands first, the helper is the desired end state and the other change's state-diff step becomes a no-op verification. Either ordering converges on "non-NotFound errors are logged on every state-diff read path."

## Open Questions

- Whether export.ts's inline listing matches `listChapterFiles` semantics — resolved at implementation time by inspection; if not, it is left unchanged and noted.
