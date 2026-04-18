## Context

HeartReverie stores each story as a directory of numbered Markdown chapter files under `playground/<series>/<story>/NNN.md`. Existing routes in `writer/routes/stories.ts` and `writer/routes/chapters.ts` can list and read individual chapters, but there is no endpoint that produces a single consolidated artifact. LLM output often contains plugin-owned XML tags (e.g., `<thinking>`, `<user_message>`, `<imgthink>`) that must be filtered out before a story is fit for human consumption; these tags are already declared by each plugin's `promptStripTags` array and collected by `PluginManager.getStripTagPatterns()` in `writer/lib/plugin-manager.ts`.

The frontend story selector (`reader-src/src/components/StorySelector.vue` + `reader-src/src/composables/useStorySelector.ts`) is the natural place to expose an export action because it already tracks the currently selected `series` and `story`.

There are currently zero external users, so no backward-compatibility or URL-stability constraints apply.

## Goals / Non-Goals

**Goals:**
- Deliver a single authenticated endpoint that exports a story as one of three formats: Markdown, JSON, plain text.
- Reuse the existing plugin tag-stripping pipeline so exported output matches what a reader sees, not raw LLM transcripts.
- Provide a frontend control in the story selector that triggers a browser download with a meaningful filename.
- Keep the endpoint safe against path traversal and resource exhaustion, consistent with the rest of the `/api/*` surface.

**Non-Goals:**
- EPUB or PDF output (complex dependencies; revisit later).
- Bulk export of multiple stories or entire series in one request.
- Server-side persistence of exports, import/round-trip support, or any write-side operations.
- Streaming or chunked responses — exports are small (bounded by chapter count) and can be assembled in memory.

## Decisions

### Endpoint shape: `GET /api/stories/:series/:name/export?format=<fmt>`
- **Why**: Matches the existing RESTful pattern used by `/api/stories/:series/:name/chapters`. Query-string format selection avoids endpoint proliferation and plays well with `<a href>`-triggered downloads.
- **Alternatives considered**: Path-based format (`/export/md`) — rejected because query params make it trivial to add formats later and keep the route table small. `POST /export` with a body — rejected because GET is cacheable and directly usable from an `<a>` tag.

### Format set: `md` (default), `json`, `txt`
- **md**: concatenates chapters under a top-level `# <series> / <name>` heading and `## Chapter N` subheadings, separated by blank lines. Plugin tags stripped.
- **json**: `{ series, name, exportedAt (ISO-8601), chapters: [{ number, content }] }` where `content` is already tag-stripped Markdown.
- **txt**: same structure as `md` but Markdown syntax removed. Use a minimal, dependency-free stripper (remove `#`, `*`, `_`, backticks, link syntax, image syntax, HTML tags) rather than adding a Markdown-to-text library for a cosmetic feature.
- **Alternatives considered**: Adding an HTML format — deferred; the reader already renders HTML in-browser and a static HTML export adds sanitization complexity without a clear use case.

### Tag stripping
- Combine patterns from BOTH `promptStripTags` and `displayStripTags` across all plugin manifests before stripping. The existing `PluginManager.getStripTagPatterns()` helper (used by `buildPromptFromStory` in `writer/lib/story.ts`) only reads `promptStripTags` — it does NOT currently cover `displayStripTags`. Exported content must look like what a reader sees in-browser, which means `displayStripTags` (e.g., imgthink) must also be removed in addition to `promptStripTags`.
- **Implementation**: add a new helper `PluginManager.getCombinedStripTagPatterns()` to `writer/lib/plugin-manager.ts` that merges patterns from both `promptStripTags` and `displayStripTags` declarations (deduplicated) and returns a single combined `RegExp | null`, reusing the same regex-vs-plain-tag handling already in `getStripTagPatterns()`. The export route calls this new helper. Leaving `getStripTagPatterns()` unchanged preserves current prompt-assembly behaviour (backend prompt stripping continues to use only `promptStripTags`, which is correct because display-only tags like frontend renderers do not affect LLM context).
- **Alternatives considered**:
  - Extend `getStripTagPatterns()` itself to include both fields — rejected because `buildPromptFromStory` intentionally scopes stripping to prompt-facing tags; widening it would change prompt assembly semantics.
  - Call both existing accessors and merge in the route — would require a second accessor for `displayStripTags` that does not yet exist, duplicating the regex/plain-tag handling. Creating a single combined helper keeps the logic in one place.
  - Introduce a new "export-strip-tags" hook — rejected as overkill; the union of existing declarations is the right set.

### Chapter selection
- Only files matching `/^\d+\.md$/` at the top of the story directory are included, sorted numerically. Underscore-prefixed siblings (`_lore/` etc.) are naturally excluded because they are directories, and their chapter regex would not match even if they were files.
- Empty chapters (zero-length after trim) are omitted from all three formats to avoid dangling headers.

### Response headers
- `Content-Type`: `text/markdown; charset=utf-8` / `application/json; charset=utf-8` / `text/plain; charset=utf-8`.
- `Content-Disposition: attachment; filename="<series>-<name>.<ext>"` with RFC 5987 `filename*=UTF-8''...` fallback so non-ASCII series/story names download with a readable name.

### Auth & rate limiting
- Covered automatically by the existing `/api/*` auth middleware and global 300 req/min rate limiter registered in `writer/app.ts`. No dedicated rate-limit rule is added; export is cheap and unlikely to be abused by a single-user deployment.

### Frontend integration
- Add an "匯出" (Export) summary row inside the story-selector dropdown with three buttons (Markdown / JSON / TXT).
- Implementation: a helper in `useStorySelector.ts` (or a new small composable) builds the URL `/api/stories/.../export?format=...`, fetches with auth headers, reads the response as a `Blob`, and triggers a download by creating a temporary object URL + `<a download>` click. This avoids direct `<a href>` because we must pass the `X-Passphrase` header.

### Path safety & error handling
- Reuse `safePath(series, name)` from `AppDeps` to reject traversal. Reuse `validateParams` middleware for parameter shape.
- Return RFC 9457 Problem Details on errors: 400 invalid format / invalid path, 401 missing auth (handled by middleware), 404 story not found, 500 read failure.

## Risks / Trade-offs

- **Risk**: Large stories with many chapters could produce big responses and spike memory. → **Mitigation**: Apply the same implicit ceiling pattern used by `buildPromptFromStory` (which caps at 200 chapters) — export will NOT cap by default because the user's intent is a full archive, but we note this as an open question and will add a safeguard if real stories exceed a few MB.
- **Risk**: Plain-text conversion is lossy and our home-grown stripper may leave artifacts (e.g., nested emphasis). → **Mitigation**: Document that `txt` is a best-effort reading format; users wanting fidelity can use `md`.
- **Risk**: Filename escaping for `Content-Disposition` can be mis-handled by browsers. → **Mitigation**: Emit both ASCII-safe `filename=` and RFC 5987 `filename*=UTF-8''<percent-encoded>`.
- **Trade-off**: JSON export embeds Markdown as a string rather than a structured AST. Keeps the format simple and stable; downstream tooling can re-parse if needed.

## Migration Plan

No data migration required — this is additive. Rollback is trivial: remove the route registration and the UI button. Existing clients are unaffected because the new endpoint is net-new.

## Open Questions

- Should exports include a front-matter metadata block (e.g., series, story, exportedAt) at the top of the `md` format for round-trip friendliness? Current decision: no, keep it clean; JSON already carries that metadata.
- Should the export respect the same empty-chapter detection used by `buildPromptFromStory` (trim-based) or be byte-exact? Current decision: trim-based, matching the prompt pipeline to produce consistent output.
