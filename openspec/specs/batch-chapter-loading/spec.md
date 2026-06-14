# Batch Chapter Loading

## Purpose

Provides a single-request batch endpoint to load all chapter numbers and contents for a story, eliminating N+1 HTTP request patterns during story loading.

## Requirements

### Requirement: Batch chapter content endpoint
The server SHALL support an optional `include=content` query parameter on `GET /api/stories/:series/:name/chapters`. When this parameter is present, the response SHALL be an array of objects `[{number, content}]` containing all chapter numbers and their full text content in numeric order.

#### Scenario: Batch load all chapters with content
- **WHEN** a client sends `GET /api/stories/myseries/mystory/chapters?include=content`
- **THEN** the server SHALL return HTTP 200 with a JSON array of `{number: number, content: string}` objects, sorted by chapter number ascending, containing the full content of each chapter file

#### Scenario: Empty story returns empty array
- **WHEN** a client sends `GET /api/stories/myseries/mystory/chapters?include=content` for a story with no chapter files
- **THEN** the server SHALL return HTTP 200 with an empty JSON array `[]`

#### Scenario: Story not found returns 404
- **WHEN** a client sends `GET /api/stories/nonexistent/story/chapters?include=content` for a non-existent story directory
- **THEN** the server SHALL return HTTP 404 with a Problem Details JSON error

### Requirement: Backward-compatible default response
When the `include` query parameter is absent or set to a value other than `content`, the endpoint SHALL return the original response format: a JSON array of chapter numbers (`number[]`).

#### Scenario: Default response without query parameter
- **WHEN** a client sends `GET /api/stories/myseries/mystory/chapters` without any query parameters
- **THEN** the server SHALL return HTTP 200 with a JSON array of chapter numbers (e.g., `[1, 2, 3]`)

#### Scenario: Unknown include value falls back to default
- **WHEN** a client sends `GET /api/stories/myseries/mystory/chapters?include=unknown`
- **THEN** the server SHALL return HTTP 200 with a JSON array of chapter numbers (same as no parameter)

### Requirement: Frontend uses batch loading
The `useChapterNav` composable's `loadFromBackendInternal()` function SHALL use the batch endpoint (`?include=content`) to load all chapters in a single HTTP request, rather than making individual requests per chapter. The built frontend output in `reader-dist/` SHALL reflect the current source code in `reader-src/`.

#### Scenario: Story loading makes single batch request for chapter data
- **WHEN** the frontend loads a story with 100 chapters via `loadFromBackend()`
- **THEN** the composable SHALL make exactly 1 HTTP request to the batch endpoint (`/chapters?include=content`) for initial chapter data (no per-chapter fetch loop) and populate `chapters.value` with all 100 chapter data objects

#### Scenario: No duplicate batch requests on initial page load
- **WHEN** a user navigates directly to a story chapter URL (e.g., `/series/story/chapter/1`) and the passphrase gate unlocks (whether auto-verified from stored passphrase or manual entry)
- **THEN** during the initial load window (from unlock to first stable render, before any polling interval elapses), the frontend SHALL make exactly 1 request matching `/api/stories/:series/:story/chapters*` — the batch endpoint — and zero individual `/chapters/:num` content requests

#### Scenario: Story switching makes single batch request
- **WHEN** the user navigates from one story to another via browser back/forward or route change
- **THEN** the frontend SHALL make exactly 1 batch request for the new story's chapters

### Requirement: State-diff sidecar reads use a single shared helper

Reading and validating a chapter's `NNN-state-diff.yaml` sidecar SHALL be performed exclusively through a single shared helper `readStateDiff(dirPath, chapterNum, logger?)` in `writer/lib/story-chapter-io.ts`. The helper SHALL read the `NNN-state-diff.yaml` file for the given zero-padded chapter number, parse it as YAML, and return the parsed `StateDiffPayload` only when it has an `entries` array; it SHALL return `undefined` when the file is absent, unparseable, or malformed (missing or non-array `entries`). When a failure is anything other than `Deno.errors.NotFound`, the helper SHALL log it at warn level through the optional `logger` argument (when provided) with context including the operation and the chapter number; a `NotFound` failure SHALL be silent. No route handler SHALL retain an inline `readTextFile` + `parseYaml` + `entries`-validation block for the state-diff sidecar — every HTTP and WebSocket read path (the batch-list mode and single-chapter read in `chapters.ts`, and the poll loop in `ws-subscribe.ts`) SHALL call this helper. The WebSocket poll path SHALL pass a logger adapter so its historical read-error logging is preserved.

#### Scenario: Valid diff file is returned
- **WHEN** `readStateDiff(dir, n)` reads a `NNN-state-diff.yaml` whose parsed content has an `entries` array
- **THEN** the helper SHALL return the parsed `StateDiffPayload`

#### Scenario: Missing diff file returns undefined silently
- **WHEN** `readStateDiff(dir, n, logger)` is called and the `NNN-state-diff.yaml` file does not exist (`Deno.errors.NotFound`)
- **THEN** the helper SHALL return `undefined` and SHALL NOT call `logger.warn`

#### Scenario: Malformed YAML is logged and returns undefined
- **WHEN** `readStateDiff(dir, n, logger)` is called and the file contains malformed YAML (or the read fails with a non-NotFound error)
- **THEN** the helper SHALL return `undefined` and SHALL call `logger.warn` exactly once with the operation and chapter-number context

#### Scenario: Valid YAML without an entries array returns undefined
- **WHEN** `readStateDiff(dir, n)` reads valid YAML that has no `entries` array
- **THEN** the helper SHALL return `undefined`

#### Scenario: WebSocket poll path preserves read-error logging
- **WHEN** the `ws-subscribe.ts` poll loop reads a state-diff sidecar via `readStateDiff` and the read fails with a non-NotFound error
- **THEN** the failure SHALL still be logged on the WebSocket path via the logger adapter passed to the helper
