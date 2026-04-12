## Context

The HeartReverie reader frontend currently uses the `⚙️ Prompt` button in `AppHeader.vue` to open `PromptEditor.vue` as a fixed-position side panel (33vw, right-aligned, z-index 1000). The `PromptPreview.vue` opens similarly on the left side. Both panels are rendered via `<Teleport to="body">` with a backdrop overlay managed by `AppHeader`.

The frontend now has Vue Router (HTML5 history mode) with routes for reading (`/`, `/:series/:story`, `/:series/:story/chapter/:chapter`). The architecture supports lazy-loaded route components via `MainLayout`.

We want to introduce a Settings page at `/settings` as a top-level routed view (sibling to the reader), with the Prompt Editor as its first tab at `/settings/prompt-editor`. The design must accommodate future tabs (e.g., model config, theme, plugin settings).

**Existing components involved:**
- `AppHeader.vue` — owns the `⚙️ Prompt` button, `showEditor`/`showPreview` state, and Teleported panels
- `PromptEditor.vue` — fixed side panel with close/preview emits
- `PromptPreview.vue` — fixed side panel with close emit
- `router/index.ts` — Vue Router config with `MainLayout` routes
- `App.vue` — `<PassphraseGate>` wrapping `<router-view />`

## Goals / Non-Goals

**Goals:**
- Create a dedicated Settings page with left sidebar tab navigation at `/settings`
- Move the Prompt Editor from a modal overlay to a full-page tab at `/settings/prompt-editor`
- Integrate Prompt Preview inline within the prompt-editor tab (side-by-side or toggle) instead of a separate overlay
- Replace the `⚙️ Prompt` header button with a gear icon that navigates to `/settings/prompt-editor`
- Provide a `← 返回閱讀` back button to return to the reader
- Design the tab system for easy extension with future settings tabs
- Reuse the existing dark theme CSS variables for consistent styling

**Non-Goals:**
- Adding any new settings tabs beyond the Prompt Editor in this change
- Changing the backend API endpoints for prompt template CRUD or preview
- Modifying the `usePromptEditor` or `useAuth` composable interfaces
- Mobile-responsive redesign of the settings page (basic responsiveness only)
- Adding settings persistence (localStorage/backend) — future concern

## Decisions

### Decision 1: Settings as a sibling top-level route with nested children

The Settings page will be a new route tree at `/settings` with `SettingsLayout.vue` as its component. Tabs are implemented as **nested child routes**:

```
/settings                    → redirect to /settings/prompt-editor
/settings/prompt-editor      → PromptEditorPage.vue
/settings/future-tab         → (future)
```

**Why nested routes over dynamic component switching:**
- Each tab gets its own URL for direct access and browser history
- Vue Router handles lazy loading of tab components automatically
- Adding a new tab = adding a route + sidebar entry (no switch/case logic)
- The `SettingsLayout` uses `<router-view>` for tab content

**Alternative considered:** Single `/settings` route with dynamic `<component :is>` switching — rejected because it doesn't support direct URL access to individual tabs and requires manual lazy-loading.

### Decision 2: SettingsLayout with left sidebar navigation

The `SettingsLayout.vue` component renders:
1. A **left sidebar** (~200px) with a back button and tab links
2. A **content area** (flex: 1) with `<router-view />` for the active tab

The sidebar uses `<router-link>` elements with `active-class` for highlighting the current tab. The sidebar is a simple vertical list — no collapsing or hamburger needed initially.

**Why left sidebar over horizontal tabs:**
- Vertical tab lists scale better as tabs are added
- More natural for settings/admin pages
- Horizontal tabs would compete with the reader header for vertical space

### Decision 3: Refactor PromptEditor from modal to page component

Create a new `PromptEditorPage.vue` wrapper that:
- Imports the existing `usePromptEditor` composable (no changes needed)
- Renders the editor UI filling the settings content area (not fixed-position)
- Renders `PromptPreview` inline as a toggleable side panel within the content area (flex layout: editor left, preview right) instead of a Teleported overlay
- Removes the `close` emit and `✕` button (navigation handles exit)
- Keeps the `preview` functionality as an inline toggle

The original `PromptEditor.vue` can be kept temporarily for backward compatibility or removed if we fully commit to the routed approach.

**Why a wrapper page instead of modifying PromptEditor directly:**
- Lower risk — the existing component continues working during migration
- The page wrapper handles layout concerns (filling the content area) while the editor handles editing logic
- Could evolve to keep PromptEditor as a reusable component if needed elsewhere

### Decision 4: Gear icon navigation in AppHeader

Replace the `⚙️ Prompt` text button with a `⚙️` gear icon button that calls `router.push({ name: 'settings-prompt-editor' })`. The button shows only in backend mode (same as current behavior).

Remove the `showEditor`, `showPreview` state, `<Teleport>` panels, and backdrop overlay from `AppHeader.vue`. This significantly simplifies the component.

### Decision 5: Back navigation uses router.back() with fallback

The `← 返回閱讀` button in the settings sidebar:
1. If `router.options.history.state.back` exists → `router.back()` (returns to exact reader position)
2. Otherwise → `router.push({ name: 'home' })` (fallback for direct URL access)

This preserves the user's reading position when navigating settings → reader.

## Risks / Trade-offs

- **[Context loss]** Navigating away from the reader to settings means the reader component may unmount → the singleton composables (`useChapterNav`, `useStorySelector`) preserve state at module level, so reader state survives navigation. **Mitigation**: Module-level refs ensure state persistence across route changes.

- **[Prompt Preview needs series/story context]** PromptPreview requires `series` and `story` props for the API call. In the settings page, these aren't available from route params. **Mitigation**: `PromptEditorPage` reads `getBackendContext()` from `useChapterNav()` — the module-level state retains the current series/story even after navigating away from the reader.

- **[Breaking change for keyboard users]** Users accustomed to quickly toggling the editor via the header button now have a full page navigation. **Mitigation**: The gear icon is still in the same header position; `router.back()` returns to exact reader state.

- **[Mobile layout]** The left sidebar may not work well on small screens. **Mitigation**: Basic responsive CSS (sidebar collapses to top tabs or hamburger on mobile) — but full mobile redesign is a non-goal for this change.
