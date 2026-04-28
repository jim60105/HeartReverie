## MODIFIED Requirements

### Requirement: Back-to-reader navigation

The sidebar SHALL include a `← 返回閱讀` back button at the top. Clicking the button SHALL exit the `/settings/*` area in a single navigation, regardless of the user's intra-settings tab history.

The frontend SHALL maintain an in-memory record of the **last reading route** the user occupied — defined as the most recently navigated-to route whose path is **neither** exactly `/settings` **nor** starts with `/settings/`. (A loose `startsWith("/settings")` predicate MUST NOT be used: it would mis-classify valid top-level reading paths whose first segment merely starts with the literal substring `settings`, such as a series slug `settings-archive` rendered at `/settings-archive/my-story`.) The record SHALL be updated by a `router.afterEach` global navigation guard installed once at application bootstrap, and the guard MUST be registered BEFORE the router-induced initial navigation completes (i.e., before `app.use(router)`) so that direct entry to a reading URL is captured. The record SHALL store the route's portable identifier (`name`, `params`, `query`, and `hash`; or `path`, `query`, and `hash` as a defensive fallback for unnamed routes), NOT a fullPath string. The record SHALL be in-memory only (it is not persisted across page reloads or browser sessions).

When the user clicks `← 返回閱讀`:
- If a last reading route has been recorded, the application SHALL call `router.push()` with the recorded route location.
- If no last reading route has been recorded (e.g., the user opened a `/settings/*` URL directly with no prior reading navigation in this SPA session), the application SHALL navigate to `/` (the home route) as the fallback.

The button SHALL NOT call `router.back()` and SHALL NOT walk browser history in any form. Browser back/forward buttons remain governed by Vue Router's default history behavior — only the in-app back button is destination-driven.

#### Scenario: Back button returns to last reading route after intra-settings navigation

- **WHEN** the user navigates `/storyA/storyB/chapter/3` → `/settings/prompt-editor` → `/settings/lore` → `/settings/llm` and then clicks `← 返回閱讀`
- **THEN** the application SHALL navigate to `/storyA/storyB/chapter/3` in a single transition, without passing through `/settings/lore` or `/settings/prompt-editor`

#### Scenario: Back button returns to home when no reading route was recorded

- **WHEN** the user opens `/settings/llm` as the first route in the SPA session (e.g., direct URL entry, fresh page load) and clicks `← 返回閱讀`
- **THEN** the application SHALL navigate to `/` (home) as the fallback

#### Scenario: Last reading route is updated when the user re-enters reading then re-enters settings

- **WHEN** the user navigates `/` → `/settings/llm` → `/storyA` → `/settings/lore` and then clicks `← 返回閱讀`
- **THEN** the application SHALL navigate to `/storyA` (the most recent non-`/settings` route), not to `/`

#### Scenario: Settings tab navigation does not overwrite the last reading route

- **WHEN** the user navigates `/storyA` → `/settings/prompt-editor` → `/settings/llm`
- **THEN** the recorded last reading route SHALL still be `/storyA` after the second settings navigation, because neither `/settings/prompt-editor` nor `/settings/llm` matches the reading-route criterion (their paths start with `/settings/`)

#### Scenario: Top-level paths whose first segment starts with the substring `settings` ARE reading routes

- **WHEN** the user navigates to a story-shaped path such as `/settings-archive/my-story` (which matches the `story` route, NOT a settings route)
- **THEN** the navigation guard SHALL record this route as a reading route (because its path is neither exactly `/settings` nor starts with `/settings/`)

#### Scenario: Captured route shape is portable

- **WHEN** the navigation guard captures a reading route
- **THEN** the captured value SHALL be an object exposing at minimum `name`, `params`, `query`, and `hash`, suitable as input to `router.push()`, rather than a raw fullPath string
