## MODIFIED Requirements

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
