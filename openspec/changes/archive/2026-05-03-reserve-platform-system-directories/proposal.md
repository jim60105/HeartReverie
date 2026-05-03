## Why

When HeartReverie runs across Linux, Windows, and macOS-backed volumes, platform-generated system directories can appear inside `playground/` or story directories (for example `lost+found`, `$RECYCLE.BIN`, and `System Volume Information`). Current filters are not explicit enough for all such names, so OS metadata directories can leak into story-selection APIs and lore scans as if they were user content.

## What Changes

- Reserve a cross-platform set of system directory names alongside underscore-prefixed system directories: `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, and `.fseventsd`.
- Exclude those reserved names from `GET /api/stories` and `GET /api/stories/:series` directory listings so they never appear in the reader's series/story selectors.
- Exclude those reserved names while traversing playground series/story directories for lore tag aggregation (`GET /api/lore/tags`), so platform filesystem metadata is never treated as lore-bearing scope.
- Extend reserved-name validation for route params so API endpoints that accept series/story identifiers reject all reserved literals consistently.
- Update backend tests covering story listing, reserved-name validation, and lore tag scanning to lock the expanded reservation behavior.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `writer-backend`: Broaden system-reserved directory handling to include a cross-platform reserved-literal set for listing and series/story path validation behavior.
- `lore-api`: Restrict lore tag traversal to user content directories by excluding platform-generated reserved directories from series/story scope discovery.

## Impact

Affected areas include:
- Backend route handlers: `writer/routes/stories.ts`, `writer/routes/lore.ts`
- Path validation helpers: `writer/lib/middleware.ts` (and any shared reserved-name helper extracted from it)
- Backend tests under `tests/writer/routes/` and related validation tests
- API behavior for story listing and lore-tag aggregation endpoints
