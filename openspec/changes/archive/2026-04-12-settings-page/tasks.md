## 1. Router Configuration

- [x] 1.1 Add `/settings` parent route with redirect to `/settings/prompt-editor` and lazy-loaded `SettingsLayout` component in `router/index.ts`
- [x] 1.2 Add `/settings/prompt-editor` child route rendering `PromptEditorPage.vue` within the settings layout
- [x] 1.3 Verify catch-all route does not interfere with `/settings/*` routes (order after settings)

## 2. Settings Layout

- [x] 2.1 Create `SettingsLayout.vue` with left sidebar (~200px) and `<router-view />` content area using flexbox
- [x] 2.2 Implement sidebar tab navigation with `<router-link>` items driven by route children config
- [x] 2.3 Apply `active-class` on `<router-link>` for current tab highlight (left-border accent + background)
- [x] 2.4 Add `← 返回閱讀` back button in sidebar: `router.back()` with fallback to `router.push({ name: 'home' })`

## 3. CSS Theme Variables

- [x] 3.1 Add settings-specific CSS custom properties to theme file: `--settings-sidebar-width`, `--settings-sidebar-bg`, `--settings-sidebar-active-bg`, `--settings-sidebar-active-border`, `--settings-content-padding`
- [x] 3.2 Style `SettingsLayout.vue` scoped styles using the new CSS variables for sidebar and content area

## 4. Prompt Editor Page

- [x] 4.1 Create `PromptEditorPage.vue` wrapper component that imports `usePromptEditor` composable and renders editor + inline preview toggle
- [x] 4.2 Refactor `PromptEditor.vue`: remove fixed positioning, close button, close emit; editor fills parent content area
- [x] 4.3 Refactor `PromptPreview.vue`: remove fixed positioning, Teleport, backdrop, close emit; render inline within flex layout
- [x] 4.4 Implement preview toggle in `PromptEditorPage.vue` (side-by-side flex layout: editor left, preview right)
- [x] 4.5 Wire `PromptPreview` series/story context via `useChapterNav().getBackendContext()` instead of route params

## 5. AppHeader Simplification

- [x] 5.1 Replace `⚙️ Prompt` text button in `AppHeader.vue` with gear icon that calls `router.push({ name: 'settings-prompt-editor' })`
- [x] 5.2 Remove `showEditor`, `showPreview` state, `<Teleport>` panels, and backdrop overlay from `AppHeader.vue`

## 6. Component Architecture Updates

- [x] 6.1 Update `App.vue` if needed to ensure `PassphraseGate` wraps both `MainLayout` and `SettingsLayout` routes
- [x] 6.2 Verify module-level singleton composable state (useChapterNav, useStorySelector) persists across reader ↔ settings navigation

## 7. Tests

- [x] 7.1 Add unit test for `/settings` route redirect to `/settings/prompt-editor`
- [x] 7.2 Add unit test for `SettingsLayout.vue` rendering sidebar and router-view
- [x] 7.3 Add unit test for sidebar active-class on current route
- [x] 7.4 Add unit test for back button navigation (router.back with fallback)
- [x] 7.5 Add unit test for `PromptEditorPage.vue` rendering editor and preview toggle
- [x] 7.6 Add unit test for `PromptEditor.vue` filling content area (no fixed positioning)
- [x] 7.7 Add unit test for `PromptPreview.vue` inline rendering (no Teleport/backdrop)
- [x] 7.8 Add unit test for `AppHeader.vue` gear icon navigation to settings route
- [x] 7.9 Verify existing reader/writer tests still pass after refactor
