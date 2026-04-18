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
