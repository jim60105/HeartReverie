## Why

The Prompt Editor (編排器) and Prompt Preview currently render as modal overlays from the reader header. As we plan to add more configuration and management panels (e.g., model settings, plugin config, theme preferences), a dedicated Settings page with tabbed navigation provides a scalable home for these features. Moving the editor to its own route also eliminates the overlay UX pattern, giving the editor full-page real estate and enabling direct URL access via `/settings/prompt-editor`.

## What Changes

- Add a new `SettingsLayout` component that renders a left sidebar tab navigation + `<router-view>` for the active tab content
- Add Vue Router routes: `/settings` (redirects to first tab), `/settings/prompt-editor` (renders PromptEditor as a full-page tab)
- Refactor `PromptEditor.vue` from a Teleported modal panel into a standalone routed page component, removing the modal backdrop and close button in favor of persistent sidebar navigation
- Refactor `PromptPreview.vue` similarly — it becomes accessible within the prompt-editor tab (inline or sub-route) rather than a separate modal
- Replace the `⚙️ Prompt` button in `AppHeader.vue` with a `⚙️` gear icon that navigates to `/settings/prompt-editor` via `router.push()`
- Add a `← 返回閱讀` back button in the Settings layout that navigates back to the previous reader route (or `/` if no history)
- The Settings page shares the same `PassphraseGate` authentication as the reader (already handled by `App.vue`)

## Capabilities

### New Capabilities
- `settings-page`: Settings page layout, sidebar tab navigation, route definitions, and back-to-reader navigation. Designed for extensibility with future tabs.

### Modified Capabilities
- `vue-router`: Add `/settings` parent route with child routes for each tab (`/settings/prompt-editor`). Update catch-all to not interfere with settings routes.
- `prompt-editor`: Refactor from modal overlay to full-page routed component within the Settings layout. Remove close/emit pattern; content fills the settings content area.
- `prompt-preview`: Adapt from standalone modal to inline integration within the prompt-editor settings tab (accessible via button, rendered in the same content area rather than a Teleported overlay).
- `vue-component-architecture`: Update component hierarchy to include `SettingsLayout` as a top-level routed component alongside `MainLayout`.
- `page-layout`: Add CSS variables and styles for the settings sidebar, settings content area, and active tab indicator.

## Impact

- **Frontend components**: `AppHeader.vue` (remove modal triggers), `PromptEditor.vue` (refactor to page), `PromptPreview.vue` (refactor to inline), new `SettingsLayout.vue`, new `SettingsSidebar.vue`
- **Router**: `router/index.ts` gains `/settings` parent route with lazy-loaded `SettingsLayout` and child routes
- **Composables**: `usePromptEditor` may need minor adjustments (no close emit); a new `useSettings` composable could manage active tab state
- **Styles**: New CSS for settings layout (sidebar + content area), reusing existing theme variables
- **Backend**: No changes required — the SPA fallback already handles `/settings/*` routes
- **Dependencies**: None — uses existing vue-router
