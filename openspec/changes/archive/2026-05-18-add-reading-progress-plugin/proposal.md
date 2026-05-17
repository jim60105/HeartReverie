## Why

HeartReverie currently has no way for readers to resume where they left off after closing their browser or switching devices. Users reading long multi-chapter stories must manually scroll to find their place every time. A server-synced reading progress plugin enables seamless cross-device continuity with zero LLM cost overhead.

## What Changes

- Add a new `reading-progress` full-stack plugin in `plugins/reading-progress/` that tracks per-story reading position (chapter index + scroll ratio + optional W3C Text Fragment anchor) and syncs it to a server-side JSON file store.
- Backend: `PUT/GET/DELETE /api/plugins/reading-progress/progress/:series/:story` routes with strict-monotonic revision counter, per-key in-process mutex, atomic file writes, and a bulk `POST .../import-local` ingestion endpoint for migrating localStorage data.
- Frontend: subscribes to `chapter:dom:ready`, `chapter:dom:dispose`, `chapter:change`, `story:switch` hooks; throttled scroll sync; scroll restoration with ResizeObserver stabilization and Text Fragment anchoring; multi-device conflict detection UX (inline dialog prompting cross-device chapter jump).
- Settings page with progress list/delete management UI and "import local progress" flow (dry-run preview → confirm → write).
- **BREAKING**: `selectionAnchor` uses `TextFragmentAnchor` object structure (`{ prefix?, textStart, textEnd?, suffix? }`) rather than a plain string.

## Capabilities

### New Capabilities

- `reading-progress`: Single-user cross-device reading progress sync — backend storage, frontend tracking hooks, scroll restoration, multi-device conflict UX, settings management, and local-to-server migration.

### Modified Capabilities

- `plugin-core`: Add explicit convention that plugins MAY create persistent data directories under `${PLAYGROUND_DIR}/_plugins/<plugin-name>/` and document that `registerRoutes` paths MUST use `${basePath}/...` prefix to inherit `/api/*` middleware.

## Impact

- **New files**: `plugins/reading-progress/{plugin.json, backend.ts, frontend.js, README.md}` plus backend and frontend test files.
- **Storage**: Creates `${PLAYGROUND_DIR}/_plugins/reading-progress/progress/<series>/<story>.json` files at runtime.
- **APIs**: New REST endpoints under `/api/plugins/reading-progress/` protected by existing passphrase middleware.
- **Dependencies**: No new external dependencies; uses existing Deno std library, Hono framework, and engine plugin APIs.
- **Privacy**: Progress data is PII-adjacent (tracks reading habits); stored server-side only, no telemetry. README must disclose deletion path and multi-user sharing caveat.
- **Breaking**: Revision contract is strict-monotonic; clients receiving `{ conflict: true }` must update `cachedRevision` to `serverRevision`.
