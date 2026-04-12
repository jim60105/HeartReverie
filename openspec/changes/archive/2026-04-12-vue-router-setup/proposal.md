## Why

The Vue SPA currently has no router — the entire application renders as a single view with chapter navigation managed via URL hash fragments (`#chapter=N`). This prevents deep-linking to specific stories or chapters, makes the URL non-descriptive, and blocks future multi-page expansion. Adding Vue Router with resource-oriented story routes (`/:series/:story/chapter/:number`) enables bookmark-friendly URLs, browser history navigation, and a scalable route structure for future pages.

## What Changes

- Add `vue-router` as a project dependency
- Create a router instance with HTML5 history mode
- Design resource-oriented routes: `/:series/:story` for story view, `/:series/:story/chapter/:number` for direct chapter access
- Replace hash-based chapter tracking (`#chapter=N`) with router-driven navigation
- Add SPA fallback in the Hono backend so that unmatched frontend paths serve `index.html` instead of 404
- Refactor `useChapterNav` and `useStorySelector` composables to sync state bidirectionally with route params
- Remove legacy `#chapter=N` hash URL support entirely

## Capabilities

### New Capabilities
- `vue-router`: Client-side routing configuration, route definitions, navigation guards, and SPA history management

### Modified Capabilities
- `chapter-navigation`: Replace hash-based chapter tracking with router-driven navigation; sync `currentIndex` from route params
- `story-selector`: Sync selected series/story from route params; navigate via `router.push()` instead of internal state mutation
- `unified-server`: Add SPA fallback middleware to serve `index.html` for unmatched non-API, non-asset paths

## Impact

- **Dependencies**: `vue-router` added to `reader-src/package.json`
- **Frontend code**: `main.ts`, `App.vue`, `useChapterNav`, `useStorySelector`, `useFileReader` composables modified
- **Backend code**: `writer/app.ts` needs SPA fallback route before the static file catch-all
- **URL scheme**: Frontend routes must avoid `/api/*`, `/plugins/*`, `/assets/*`, `/js/*` prefixes reserved by backend
- **Breaking**: Old `#chapter=N` hash URLs will stop working — no backward compatibility redirect
- **Build**: Vite config may need `base` adjustment if not already `/`
