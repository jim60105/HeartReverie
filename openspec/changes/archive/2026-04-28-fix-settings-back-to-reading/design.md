## Context

The reader frontend is a Vue 3 SPA (Vite + Vue Router 4 in `createWebHistory` mode) with two top-level "modes": **reading** routes (`/`, `/:series/:story`, `/:series/:story/chapter/:N`) and **settings** routes (`/settings/*`). `SettingsLayout.vue` provides a sidebar that lets the user freely move among settings tabs (`/settings/prompt-editor`, `/settings/lore`, `/settings/llm`) and a `← 返回閱讀` button intended to leave the settings area.

The current implementation (`SettingsLayout.vue:17-23`) does:

```ts
function goBack() {
  if (router.options.history.state.back) {
    router.back();
  } else {
    router.push({ name: "home" });
  }
}
```

`router.back()` walks browser history one entry. Once the user has moved between settings tabs, the previous entry is another settings tab, not a reading route. The button therefore fails its label's promise, and the user sees flashes of intermediate settings panels while pressing it repeatedly.

The fix replaces history-based navigation with **destination-based navigation**: track the most recent reading route the user was on, and navigate there directly when the back button is pressed.

## Goals / Non-Goals

**Goals:**
- A single click of `← 返回閱讀` always exits the `/settings/*` area, regardless of how the user moved between settings tabs.
- The destination is the **last reading route** the user occupied — preserving their reading context (current story / chapter) — or `/` (home) when no prior reading route exists in this session.
- The mechanism is small, framework-idiomatic (Vue Router navigation guard), and covered by unit tests so the regression cannot silently return.

**Non-Goals:**
- Not changing browser-history behavior in general. Browser back/forward and other links remain governed by Vue Router defaults.
- Not persisting the last reading route across page reloads / browser sessions. In-memory state for the current SPA session is sufficient.
- Not changing route definitions, redirects, or the settings tab structure.
- Not addressing other navigation buttons or unrelated UX issues in the settings area.
- Not migrating data or shipping compatibility shims — the project has zero released users (per propose.md).

## Decisions

### Decision 1: Track via a `router.afterEach` global navigation guard

**Choice**: Install a single `router.afterEach((to) => { ... })` guard at app bootstrap (e.g., in `reader-src/src/main.ts`) that, whenever the destination's path does NOT start with `/settings`, captures the route into a module-level `Ref` exposed by a small composable (e.g., `reader-src/src/composables/useLastReadingRoute.ts`).

**Rationale**:
- `afterEach` fires after every successful navigation including the initial one, so the user's first reading view is recorded automatically.
- A single guard at startup is a one-liner addition; no per-component plumbing.
- Storing the captured value in a module-level `ref<RouteLocationRaw | null>(null)` keeps it reactive (so future tests / UI can read it without prop drilling) and survives route changes within the SPA.
- `RouteLocationRaw` (specifically the `name + params + query` form) is the recommended type to push for re-navigation: it survives route-record changes better than raw fullPath strings.

**Alternatives rejected**:
- *Storing fullPath only*: simpler, but if a route record is renamed in the future, replaying it could 404. Storing `{ name, params, query }` is more robust and tiny.
- *Pinia store*: overkill for one ref; the project doesn't use Pinia today.
- *`beforeEach` guard*: wrong lifecycle — we'd record the route the user is leaving, not the one they're staying on.
- *Storing inside `SettingsLayout` itself*: only fires when the layout is mounted, missing the very first reading route the user is on before they open settings.

### Decision 2: Capture criterion is path-prefix, not route-name

**Choice**: A route is considered a "reading route" iff its path is **neither** exactly `/settings` **nor** starts with `/settings/`. Equivalently: `to.path !== "/settings" && !to.path.startsWith("/settings/")`. We deliberately do NOT enumerate route names like `home | story | chapter`, and we do NOT use the loose `startsWith("/settings")` predicate (which would mis-classify a hypothetical valid story slug like `/settings-archive/my-story`).

**Rationale**:
- The settings hierarchy is the only special case in the router. The reading area is everything else (home, story, chapter, and any future reading-side route a developer adds).
- Future-proofs against new reading routes being introduced — they automatically count as reading routes without touching the guard.
- The `/settings` prefix-with-trailing-slash check distinguishes the settings tree (`/settings`, `/settings/lore`, `/settings/llm/...`) from any current or future top-level reading slug that happens to start with the literal substring `settings` (e.g., a series named `settings-archive` rendered at `/settings-archive/my-story`).
- The `/settings` prefix is already a load-bearing convention in the router config (`path: "/settings"` parent route at `router/index.ts:50-54`), so reusing it doesn't introduce a new coupling.

**Implementation note**: tests must include a regression case for a story-shaped path whose first segment merely starts with `settings` (e.g., `/settings-archive/my-story`) and assert it IS captured as a reading route.

**Risk acknowledged**: if someone later adds a reading route under `/settings/...` (very unlikely given the existing convention), the guard would mis-classify it. We accept this — the convention is documented in code and AGENTS.md.

### Decision 3: Storage location — module-level `ref` exported via a composable

**Choice**: Create `reader-src/src/composables/useLastReadingRoute.ts` with:

```ts
import { ref, type Ref } from "vue";
import type { RouteLocationRaw, RouteLocationNormalizedLoaded } from "vue-router";

const lastReadingRoute = ref<RouteLocationRaw | null>(null);

export function useLastReadingRoute(): {
  lastReadingRoute: Ref<RouteLocationRaw | null>;
  recordReadingRoute(to: RouteLocationNormalizedLoaded): void;
  clear(): void;
} {
  return {
    lastReadingRoute,
    recordReadingRoute(to) {
      if (to.path === "/settings" || to.path.startsWith("/settings/")) return;
      // Store the minimal portable shape so route-record changes don't break replay.
      // `path` is included as a fallback for routes that may lack a `name` (defensive
      // — all current reading routes are named, but unnamed routes are valid in vue-router).
      lastReadingRoute.value = to.name
        ? {
            name: to.name as string,
            params: { ...to.params },
            query: { ...to.query },
            hash: to.hash,
          }
        : {
            path: to.path,
            query: { ...to.query },
            hash: to.hash,
          };
    },
    clear() {
      lastReadingRoute.value = null;
    },
  };
}
```

**Rationale**: Module-level `ref` is the lightest singleton-shaped state. It's reactive, importable from anywhere, and trivially resettable in tests via `clear()`.

**Note**: the `clear()` export is used by tests to isolate cases. Production code never calls it.

### Decision 4: `goBack()` rewrite

**Choice**: `SettingsLayout.vue`'s `goBack` becomes:

```ts
const { lastReadingRoute } = useLastReadingRoute();

function goBack() {
  const target = lastReadingRoute.value;
  if (target) {
    router.push(target);
  } else {
    router.push({ name: "home" });
  }
}
```

**Rationale**: Simple, deterministic, no history-walking. The fallback is `{ name: "home" }` (matching the existing fallback). We use `router.push()` rather than `router.replace()` so the user can still hit the browser back button to return to settings if they want.

**Rejected alternative** — using `router.go(-N)` to walk past consecutive settings entries: brittle (we'd have to count) and produces the flicker the spec wants to eliminate.

### Decision 5: Guard installation point

**Choice**: Install the guard inside `reader-src/src/main.ts`, **immediately after `createApp(...)` and BEFORE `app.use(router)`** (i.e., before the router-induced initial navigation completes). Concretely:

```ts
import { useLastReadingRoute } from "@/composables/useLastReadingRoute";
// ...
const app = createApp(App);
const { recordReadingRoute } = useLastReadingRoute();
router.afterEach((to) => {
  recordReadingRoute(to);
});
app.use(router);
app.mount("#app");
```

**Rationale**: Vue Router 4 performs an initial async navigation triggered by `app.use(router)`. Registering `afterEach` BEFORE that call guarantees the guard fires for the very first navigation — including direct entry to a reading URL like `/storyA/storyB/chapter/3`. Registering it after `app.use(router)` introduces a timing window in which the initial navigation may already have completed, in which case the user's first reading route would be missed and the back button would incorrectly fall back to `/`.

**Alternative considered**: install in `router/index.ts`. Equally workable, but `main.ts` is a more conventional bootstrap location and keeps router config declarative.

### Decision 6: Test coverage

**Choice**: Two test files.

1. **New** `reader-src/src/composables/__tests__/useLastReadingRoute.test.ts` — unit tests of the composable in isolation:
   - `recordReadingRoute` captures a non-settings route into the ref.
   - `recordReadingRoute` does NOT update the ref when given a `/settings/...` route.
   - `recordReadingRoute` overwrites a previous capture with a newer non-settings route.
   - `clear()` resets the ref to `null`.
   - The captured shape is `{ name, params, query, hash }` (NOT a stringified path).

2. **Updated** `reader-src/src/components/__tests__/SettingsLayout.test.ts`:
   - Replace the existing back-button assertion. Old assertion expected `router.back()` to be called; the new assertions verify:
     - When `lastReadingRoute` is non-null, clicking the button calls `router.push` with the captured location.
     - When `lastReadingRoute` is null (direct entry), clicking the button calls `router.push({ name: "home" })`.
     - Multi-tab scenario: simulate user navigating `/storyA → /settings/prompt-editor → /settings/llm` (the second navigation must NOT overwrite the captured `/storyA`); clicking the button still returns to `/storyA`.
     - Re-entry scenario (matches Scenario 3 in the delta spec): simulate `/` → `/settings/llm` → `/storyA` → `/settings/lore` and assert the captured route is `/storyA` (the guard re-captured on re-entry, then the second settings navigation did NOT overwrite).
     - Predicate edge case: simulate a story-shaped path whose first segment merely starts with `settings` (e.g., `/settings-archive/my-story`) and assert it IS captured (proves the predicate isn't a loose `startsWith("/settings")`).

These two files together prove both the unit behavior of the helper and the wired-up behavior of the layout.

### Decision 7: No persistence

**Choice**: The captured route is in-memory only; a hard refresh (or opening `/settings/*` in a new tab) starts with `null` and falls back to home.

**Rationale**: The settings flow is short-lived. Persisting via `sessionStorage` would add complexity (serialization of `RouteLocationRaw`, stale state across tabs). Falling back to home on direct entry matches the existing spec's fallback behavior.

## Risks / Trade-offs

- **Risk**: Future routes under `/settings/...` that are conceptually "reading" would be misclassified. Mitigated by code convention (settings ⇔ `/settings` prefix) and by documentation in `AGENTS.md`. Probability low; impact small (button still lands somewhere reasonable, just not optimal).
- **Risk**: The guard runs on every route change, including ones that fail mid-flight. `afterEach` only fires for successful navigations, so this is fine; failed navigations leave `lastReadingRoute` untouched, which is the desired behavior.
- **Trade-off**: The button no longer mirrors browser back semantics. We've decided this is correct — the button's label promises a return to **reading**, not to the previous history entry.
- **Trade-off**: Module-level singleton state is harder to reset between tests than a Pinia store. Mitigated by exporting an explicit `clear()` from the composable, used in test setup. Production code never calls `clear()`.
- **Risk**: `router.push()` to a stale `RouteLocationRaw` (e.g., a chapter that no longer exists because the user deleted it via another flow) will syntactically match the `chapter` route pattern and mount its component. The catch-all `/:pathMatch(.*)*` does NOT fire in that case — it only fires for paths that match no route at all. The reader component is responsible for handling missing-data states (existing behavior). This proposal does not introduce that failure mode (the same staleness exists today via direct URL entry and via `router.back()`), and we explicitly leave the data-staleness handling to the reader components. If staleness becomes a UX problem in practice, a follow-up change should add explicit missing-data redirects in the reader components, not in this navigation layer.
- **Trade-off**: The button uses `router.push()` (Decision 4), so a sequence like `/storyA → /settings/prompt-editor → /settings/llm → click button` produces the browser-history stack `[/storyA, /settings/prompt-editor, /settings/llm, /storyA]`. The user can still browser-back into the settings tree, which we consider a feature (lets them resume a settings session). If this loop becomes confusing in user testing, switching to `router.replace()` is a one-line follow-up change — it doesn't alter the spec requirements, only the trade-off in Decision 4.
