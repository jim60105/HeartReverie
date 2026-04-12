## Context

The HeartReverie reader is a Vue 3 SPA (`reader-src/`) that currently has no client-side router. All navigation is managed by composables: `useChapterNav` tracks the current chapter index and syncs it to the URL via a `#chapter=N` hash fragment, while `useStorySelector` manages series/story selection purely through reactive refs and emitted events. The backend (Hono) serves API routes under `/api/*`, plugin modules under `/plugins/*`, assets under `/assets/*`, a legacy compatibility route at `/js/utils.js`, and the SPA static files at `/*` via `serveStatic`. There is no SPA fallback — refreshing on a non-root path currently returns a 404 from the static file middleware.

Backend routes that must NOT conflict with frontend routes:
- `/api/*` — All REST API endpoints
- `/plugins/*` — Plugin frontend modules and shared utils
- `/assets/*` — Static assets (background images)
- `/js/utils.js` — Legacy compatibility route

## Goals / Non-Goals

**Goals:**
- Add Vue Router with HTML5 history mode for clean URLs
- Design resource-oriented story routes: `/:series/:story/chapter/:number`
- Enable deep-linking and bookmarking to specific stories/chapters
- Add SPA fallback on the backend so refreshing on a frontend route serves `index.html`
- Remove legacy `#chapter=N` hash URL support entirely (no backward compatibility)
- Keep the FSA (File System Access) local reading mode fully functional alongside backend-mode routing

**Non-Goals:**
- Adding new pages or views beyond the current reader (prompt editor page, settings page, etc.)
- Server-side rendering (SSR) or pre-rendering
- Changing the backend API URL structure
- Adding authentication/route guards at the router level (auth is handled at the API layer)

## Decisions

### Decision 1: HTML5 History Mode

**Choice**: Use `createWebHistory()` for clean `/path/to/story` URLs.

**Alternatives considered**:
- Hash mode (`createWebHashHistory()`) — avoids the SPA fallback issue but produces ugly `/#/series/story` URLs and wastes the hash space already used for `#chapter=N`. Rejected because the whole point is clean, resource-oriented URLs.

**Rationale**: HTML5 history mode produces the cleanest URLs and is standard for SPAs. The backend SPA fallback is a one-line change.

### Decision 2: Route Structure

**Choice**: Nested, resource-oriented routes:

| Route | View | Description |
|-------|------|-------------|
| `/` | Home/Reader | Default entry — shows story selector or FSA chooser |
| `/:series/:story` | Reader | Load story, navigate to chapter 1 (or last chapter) |
| `/:series/:story/chapter/:chapter` | Reader | Load story, navigate to specific chapter |

**Alternatives considered**:
- Flat routes like `/read?series=X&story=Y&chapter=N` — less RESTful, doesn't leverage path hierarchy. Rejected.
- `/stories/:series/:story` prefix — conflicts with `/api/stories/` namespace and adds unnecessary prefix. Rejected.

**Rationale**: `/:series/:story/chapter/:chapter` maps naturally to the resource hierarchy. It avoids conflicting with `/api/stories/*` because the API always has the `/api/` prefix. The `:chapter` param is 1-indexed to match user expectations (Chapter 1, not Chapter 0).

### Decision 3: SPA Fallback Placement in Hono

**Choice**: Add a catch-all `app.get("*")` route AFTER `serveStatic` that serves `index.html` for any request that wasn't matched by API routes, plugin routes, asset routes, or static files.

**Implementation**: In `writer/app.ts`, after the `serveStatic` middleware, add a fallback that reads and serves `index.html` with `text/html` content type. The fallback SHALL only apply to `GET` requests and SHALL NOT match paths that start with `/api/`, `/plugins/`, `/assets/`, or `/js/`.

**Rationale**: Hono's `serveStatic` returns undefined (falls through) when no file exists. A catch-all after it handles SPA deep links.

### Decision 4: Composable Integration Strategy

**Choice**: `useChapterNav` and `useStorySelector` will import the router instance and use `useRoute()` / `useRouter()` to sync state with route params. The composables remain the source of truth for data, but the router becomes the source of truth for navigation state (which series, which story, which chapter).

**Flow**:
1. User navigates to `/:series/:story/chapter/:chapter`
2. Router resolves the route, component mounts
3. `useChapterNav` watches route params → loads story from backend → sets `currentIndex` from `:chapter` param
4. When user clicks next/previous, composable calls `router.replace()` to update URL without full navigation
5. `useStorySelector` watches route params → sets `selectedSeries` and `selectedStory`

**Alternatives considered**:
- Keep composables fully independent from router, sync externally in components — would create complex bidirectional sync logic in templates. Rejected.
- Make router the sole source of truth — would break FSA mode where there's no route params. Rejected.

**Rationale**: Composables already manage complex state. Adding router awareness inside them keeps component templates simple. FSA mode ignores route params entirely.

### Decision 5: FSA Mode Routing

**Choice**: In FSA (File System Access) mode, the URL stays at `/` (root route). No `:series/:story` params are set because the series/story identity comes from the local filesystem, not the backend. Chapter navigation in FSA mode will NOT update the route — it will continue using internal state only.

**Rationale**: FSA mode has no backend-identifiable series/story names. Forcing route params would be misleading. Users who want shareable URLs use backend mode.

### Decision 6: No Legacy Hash Support

**Choice**: Simply remove all `#chapter=N` hash code. No redirect, no backward compatibility.

**Rationale**: The project has no public releases. Legacy hash URLs can be dropped without impact.

## Risks / Trade-offs

- **[Risk] Route params conflict with backend** → Mitigation: Frontend routes use `/:series/:story` while backend uses `/api/stories/:series`. The `/api/` prefix prevents conflicts. The SPA fallback explicitly excludes `/api/`, `/plugins/`, `/assets/`, `/js/` prefixes.
- **[Risk] `serveStatic` matches a frontend route** → Mitigation: `serveStatic` only matches actual files on disk. A path like `/my-series/my-story/chapter/3` won't match any file, so it falls through to the SPA fallback.
- **[Risk] FSA mode users confused by URL not updating** → Mitigation: This matches current behavior. FSA mode never had URL-based state. Accept this trade-off.
- **[Risk] Breaking existing hash bookmarks** → Accepted: no legacy redirect needed since project has no releases.
- **[Trade-off] Router adds ~10KB to bundle** → Acceptable for the functionality gained.

## Open Questions

- None at this time. The route structure and integration strategy are straightforward.
