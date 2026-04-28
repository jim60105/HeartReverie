## 1. Last-reading-route composable

- [x] 1.1 Create `reader-src/src/composables/useLastReadingRoute.ts` exposing a module-level `ref<RouteLocationRaw | null>` plus three functions: `lastReadingRoute` (the ref), `recordReadingRoute(to: RouteLocationNormalizedLoaded)`, and `clear()` (resets the ref to `null`, used by tests). The `recordReadingRoute` predicate MUST be `to.path === "/settings" || to.path.startsWith("/settings/")` (a loose `startsWith("/settings")` is forbidden because it mis-classifies valid story slugs like `/settings-archive/my-story`). When recording, prefer the named-route shape `{ name: to.name, params: { ...to.params }, query: { ...to.query }, hash: to.hash }`; if `to.name` is absent, fall back to `{ path: to.path, query: { ...to.query }, hash: to.hash }`. Include AGPL-3.0-or-later header and a JSDoc on each function.
- [x] 1.2 Export the composable in the same module-singleton style used by other composables in `reader-src/src/composables/` (the ref must live at module scope so multiple `useLastReadingRoute()` callers share it).

## 2. Wire the navigation guard

- [x] 2.1 In `reader-src/src/main.ts`, register `router.afterEach((to) => recordReadingRoute(to))` **BEFORE `app.use(router)`** (Vue Router 4 triggers an initial navigation as part of `app.use(router)`; registering after it can miss the initial route on direct entry). Do NOT install the guard inside `router/index.ts` (keep the router module declarative).

## 3. Rewrite the back button

- [x] 3.1 In `reader-src/src/components/SettingsLayout.vue`, replace the existing `goBack()` body so it reads the `lastReadingRoute` ref via `useLastReadingRoute()` and calls `router.push(lastReadingRoute.value)` when non-null, or `router.push({ name: "home" })` otherwise. Remove the existing `if (router.options.history.state.back) { router.back(); }` branch entirely.
- [x] 3.2 Remove the now-unused references to `router.back()` and `router.options.history.state` from the file.

## 4. Tests for the composable

- [x] 4.1 Create `reader-src/src/composables/__tests__/useLastReadingRoute.test.ts` with at least these cases (all using `clear()` in `beforeEach` to isolate the module-level singleton):
  - `recordReadingRoute` updates the ref when given a non-`/settings` route (e.g., a route at `/storyA/storyB/chapter/3`).
  - `recordReadingRoute` is a no-op when given a route whose path is exactly `/settings` — ref retains its previous value (start case: previously-set; another start case: `null`).
  - `recordReadingRoute` is a no-op when given a route whose path starts with `/settings/` (e.g., `/settings/llm`).
  - **Edge case** — `recordReadingRoute` DOES update the ref when given a path whose first segment merely starts with the substring `settings` (e.g., `/settings-archive/my-story`). This proves the predicate is `=== "/settings" || startsWith("/settings/")`, not the loose `startsWith("/settings")`.
  - `recordReadingRoute` overwrites the ref when called repeatedly with different non-`/settings` routes (newest wins).
  - The captured object for a named route exposes `name`, `params`, `query`, and `hash` (NOT a fullPath string).
  - The captured object for an unnamed route exposes `path`, `query`, and `hash`.
  - `clear()` resets the ref to `null`.

## 5. Tests for SettingsLayout

- [x] 5.1 Update `reader-src/src/components/__tests__/SettingsLayout.test.ts` (using `clear()` in `beforeEach` to isolate the singleton):
  - Remove the existing assertion that the click calls `router.back()`.
  - Add: clicking the button when `lastReadingRoute.value` is null calls `router.push({ name: "home" })`.
  - Add: clicking the button when `lastReadingRoute.value` is set to a chapter route (e.g., `{ name: "chapter", params: { series: "storyA", story: "storyB", chapter: "3" }, query: {}, hash: "" }`) calls `router.push` with that exact location.
  - Add a multi-tab scenario test (matches Scenario 1 in the delta spec): call `recordReadingRoute` with a chapter route, then with two `/settings/...` routes in succession, then click the button — it must navigate to the chapter route, NOT the most recent settings route.
  - Add a re-entry scenario test (matches Scenario 3 in the delta spec): call `recordReadingRoute` with `/`, then `/settings/llm`, then `/storyA`, then `/settings/lore`, then click the button — it must navigate to `/storyA`, proving the guard re-captured on re-entry to a reading route AND that the second settings navigation did NOT overwrite.
- [x] 5.2 Verify all SettingsLayout tests still pass with the rest of the suite untouched (e.g., the sidebar tab navigation tests, the layout tests).

## 6. Documentation

- [x] 6.1 If `AGENTS.md` mentions the settings back button or the convention that `/settings/*` is the only settings prefix, add or update one short note under the relevant frontend section: "The settings area is identified by the `/settings` path or the `/settings/` path-prefix; the in-app `← 返回閱讀` button uses this rule to find the user's last reading route, not browser history. A loose `startsWith('/settings')` MUST NOT be used because it would misclassify valid top-level slugs like `/settings-archive/...`." If no such section exists, skip this task with a note.

## 7. Verification

- [x] 7.1 Run `deno task test:frontend` and confirm all tests pass (including the new and updated ones).
- [x] 7.2 Run `cd reader-src && npx --no -- vue-tsc --noEmit` and confirm no type errors are introduced.
- [x] 7.3 Run `openspec validate fix-settings-back-to-reading --strict` and confirm the change validates clean.
- [x] 7.4 Manually verify (where possible) by running the dev server and walking through the multi-tab scenario from the spec to confirm the button truly skips intermediate settings panels in a single click.

## 8. Post-critique additions

- [x] 8.1 Add a real-router bootstrap integration test (`reader-src/src/composables/__tests__/useLastReadingRoute.bootstrap.test.ts`) that uses `createRouter` + `createMemoryHistory` to verify: initial-navigation capture works when the guard is registered before `app.use(router)`, direct entry to `/settings/...` leaves the ref `null`, intra-settings navigation preserves the last reading capture, and `/settings-archive/...` is captured (predicate edge case at the router-resolution layer, not just at the predicate level). Per rubber-duck finding #1 — the original tests seeded state directly and would not have caught a regression in the `main.ts` guard registration order.
- [x] 8.2 Prepend AGPL-3.0-or-later license headers to `useLastReadingRoute.ts` and `useLastReadingRoute.test.ts` to match the project convention used in neighboring composables/tests. Per rubber-duck finding #2.
