## Why

The `← 返回閱讀` button in `SettingsLayout.vue` currently calls `router.back()`, which walks one step in browser history. When the user has navigated between settings tabs (e.g., `/settings/prompt-editor` → `/settings/lore` → `/settings/llm`), pressing the button lands them on the previous **settings tab**, not the reading view they came from. The button's label promises a return to reading, so this is a broken contract: the user has to press it multiple times (and may briefly see flickers of other settings panels) to actually exit the settings area.

## What Changes

- **BREAKING (spec only — no released users)**: The `Back-to-reader navigation` requirement in `settings-page` is rewritten so the back button always exits the `/settings/*` area in a single click and lands on the reading view the user was last on (or `/` as a fallback), regardless of intra-settings navigation history.
- Introduce a frontend navigation guard / composable that records the user's most recent reading route — i.e., the most recent route whose path does NOT start with `/settings` — into module-level state. Direct navigation to `/settings/*` (no prior reading route) leaves the recorded value empty.
- `SettingsLayout.vue`'s `goBack()` is rewritten to navigate to the recorded reading route via `router.push()` (using the stored fully-qualified location), falling back to `router.push({ name: "home" })` when no reading route has been recorded.
- Existing test `reader-src/src/components/__tests__/SettingsLayout.test.ts` is updated to cover the new behavior; new tests are added for the guard/composable and the multi-tab traversal scenario.

## Capabilities

### New Capabilities
<!-- None — the fix lives inside the existing settings-page capability. -->

### Modified Capabilities
- `settings-page`: replace the `Back-to-reader navigation` requirement so the back button always exits `/settings/*` to the last reading route (or home), independent of intra-settings tab navigation.

## Impact

- **Code**: `reader-src/src/components/SettingsLayout.vue` (rewrite `goBack`), one new module/composable for tracking the last reading route (e.g., `reader-src/src/composables/useLastReadingRoute.ts` or a tiny `lib/last-reading-route.ts`), `reader-src/src/router/index.ts` or `reader-src/src/main.ts` to install the navigation guard once at app startup.
- **Tests**: `reader-src/src/components/__tests__/SettingsLayout.test.ts` (update existing back-button assertions), one new test file for the route-tracking helper.
- **APIs / dependencies**: none. No backend changes.
- **Backward compatibility**: not relevant — the project has no released users.
