## 1. Dependencies and Setup

- [x] 1.1 Install `vue-router` package: `cd reader-src && npm install vue-router`
- [x] 1.2 Create `reader-src/src/router/index.ts` with `createRouter()` and `createWebHistory()`, define named routes: `home` (`/`), `story` (`/:series/:story`), `chapter` (`/:series/:story/chapter/:chapter`), and catch-all `/:pathMatch(.*)*` redirecting to `/` — all rendering `MainLayout` via `<router-view>`
- [x] 1.3 Update `reader-src/src/main.ts` to import and install the router via `app.use(router)` before `app.mount()`

## 2. App and Layout Integration

- [x] 2.1 Update `App.vue` to replace `<MainLayout />` with `<router-view />` inside `PassphraseGate`
- [x] 2.2 Ensure `MainLayout.vue` receives route params via `useRoute()` or props, and passes them to child composables

## 3. Composable Refactoring — useChapterNav

- [x] 3.1 Import `useRouter()` and `useRoute()` in `useChapterNav.ts`; add route-aware chapter index initialization from `:chapter` param
- [x] 3.2 Replace `history.replaceState()` hash sync with `router.replace()` URL update in backend mode; skip router interaction in FSA mode
- [x] 3.3 Remove `hashchange` event listener and `#chapter=N` hash parsing; replace with a `watch` on the route's `:chapter` param to sync `currentIndex` when route changes externally (browser back/forward)
- [x] 3.4 Update `next()` and `previous()` methods to call `router.replace()` after updating `currentIndex` in backend mode
- [x] 3.5 Update `loadFromBackend(series, name)` to call `router.push()` to navigate to `/:series/:story` when loading a new story
- [x] 3.6 Update `reloadToLast()` to update the route to the last chapter via `router.replace()` in backend mode

## 4. Composable Refactoring — useStorySelector

- [x] 4.1 Import `useRouter()` and `useRoute()` in `useStorySelector.ts`; add a `watch` on route params `:series` and `:story` to sync `selectedSeries` and `selectedStory` refs
- [x] 4.2 Update story selection to navigate via `router.push()` instead of relying on component emit

## 5. Component Updates

- [x] 5.1 Update `StorySelector.vue`: replace `emit('load', ...)` with `router.push()` for story navigation; remove the `load` event emit definition
- [x] 5.2 Update `MainLayout.vue` or parent components: remove `@load` event handler for story selector since navigation is now route-based
- [x] 5.3 Update `App.vue` `handleUnlocked()`: if route has `:series/:story` params, trigger story loading from route params after plugin init

## 6. Backend SPA Fallback

- [x] 6.1 Add SPA fallback route in `writer/app.ts`: after `serveStatic`, add a `app.get('*')` handler that serves `index.html` for GET requests not matching `/api/`, `/plugins/`, `/assets/`, `/js/` prefixes
- [x] 6.2 Add Vite dev server proxy rule for SPA fallback (or confirm Vite already handles it via `historyApiFallback`)

## 7. Vite Configuration

- [x] 7.1 Verify `vite.config.ts` `base` is `/` (default) — no change needed if already correct
- [x] 7.2 Add Vite dev server `historyApiFallback` or equivalent configuration so dev mode serves `index.html` for unknown routes

## 8. Tests

- [x] 8.1 Add unit tests for router configuration: verify route definitions, named routes, param typing
- [x] 8.2 Update `useChapterNav` tests: mock router, verify `router.replace()` called on chapter navigation in backend mode, verify router NOT called in FSA mode
- [x] 8.3 Update `useStorySelector` tests: mock router, verify `router.push()` called on story selection
- [x] 8.4 Add backend test for SPA fallback: verify `GET /unknown/path` returns `index.html` content, verify `GET /api/stories` is NOT affected
- [x] 8.5 Update existing component tests to wrap with router mock where needed

## 9. Cleanup and Verification

- [x] 9.1 Remove all `#chapter=N` hash-related code from `useChapterNav` (hash write, hash read, hashchange listener) — confirm no remaining references
- [x] 9.2 Run full test suite (`npm run test` in reader-src, `deno test` for backend) and verify all tests pass
- [x] 9.3 Build production bundle (`npm run build` in reader-src) and verify no build errors
- [x] 9.4 Verify Vite dev proxy still works for `/api/`, `/plugins/`, `/assets/`, `/js/` paths
