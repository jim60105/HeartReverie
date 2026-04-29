## ADDED Requirements

### Requirement: ContentArea gates ChapterContent on pluginsSettled

`reader-src/src/components/ContentArea.vue` SHALL render `<ChapterContent>` only when both `currentContent` (from `useChapterNav()`) is non-empty AND `pluginsSettled` (from `usePlugins()`) is `true`. When `currentContent` is non-empty but `pluginsSettled` is `false`, `ContentArea` SHALL render a minimal loading placeholder so the reader does not show a half-rendered chapter. When `currentContent` is empty, the existing welcome content SHALL render unchanged. The gate SHALL apply uniformly to backend mode and FSA mode. Note that the gate intentionally uses `pluginsSettled` (not `pluginsReady`) so that a plugin-load failure still allows chapter content to render against the empty handler set.

#### Scenario: ChapterContent waits for pluginsSettled on initial load
- **WHEN** the user reloads the page at a chapter URL and `currentContent` becomes non-empty before `pluginsSettled` is `true`
- **THEN** `ContentArea` SHALL render the loading placeholder and SHALL NOT mount `<ChapterContent>` until `pluginsSettled` flips

#### Scenario: ChapterContent mounts on plugin failure
- **WHEN** `pluginsSettled` flips to `true` because plugin loading failed (with `pluginsReady` still `false`) and `currentContent` is non-empty
- **THEN** `<ChapterContent>` SHALL mount and render against the empty `frontend-render` handler set

#### Scenario: Welcome state is unaffected
- **WHEN** `currentContent` is empty (no story loaded)
- **THEN** the welcome section SHALL render regardless of `pluginsSettled`

### Requirement: ChapterContent v-html token list keys on renderEpoch

`reader-src/src/components/ChapterContent.vue` SHALL render its rendered-token list with a `v-for` whose `:key` includes the current `renderEpoch` value (e.g. `:key="\`${idx}-${renderEpoch}\`"`). This ensures that when `renderEpoch` increments, every `<div v-html="token.content">` (and `<VentoErrorCard>`) is unmounted and remounted, even if the underlying token content is byte-identical to the previous render.

This is required because `ContentArea.vue`'s sidebar-relocation watch externally mutates the DOM (moving `.plugin-sidebar` children out of the `v-html` div via `appendChild`). Vue's `v-html` directive only resets `innerHTML` when the bound string changes; for a byte-identical re-render, Vue would otherwise skip the patch and the externally-removed `.plugin-sidebar` would never reappear. Including `renderEpoch` in the key forces a full remount, restoring the panel for the relocation watch to move.

Additionally, when `ChapterContent` toggles out of edit mode via `cancelEdit` (the user pressed 取消), the v-if-gated tokens template is re-mounted and recreates `.plugin-sidebar` nodes inside chapter content. Because cancel does NOT mutate chapter content, no other reactive signal would notify `ContentArea`'s sidebar-relocation watch. `cancelEdit` SHALL therefore call `bumpRenderEpoch()` (exposed by `useChapterNav()`) so the relocation watch re-runs, clears the stale sidebar copies, and moves the freshly-recreated panels into place. Without this bump the user ends up with duplicated panels (originals in sidebar plus new copies in content) after pressing 取消.

#### Scenario: Byte-identical re-render restores externally-mutated v-html children
- **WHEN** the rendered-token list is identical to the previous render but `renderEpoch` increments
- **THEN** `ChapterContent` SHALL remount each token element so that any DOM children removed externally (e.g. by the sidebar relocation watch) are recreated from the v-html string

#### Scenario: Cancel from edit mode does not duplicate sidebar panels
- **WHEN** the user clicks 編輯 to enter edit mode and then 取消 to leave without saving
- **THEN** `cancelEdit` SHALL call `bumpRenderEpoch()` so `ContentArea`'s sidebar relocation watch re-runs, leaving exactly one set of `.plugin-sidebar` panels in the sidebar and zero in chapter content

### Requirement: ContentArea sidebar relocation tracks render invalidation

`reader-src/src/components/ContentArea.vue` SHALL relocate every `.plugin-sidebar` element produced inside `<ChapterContent>` into the `<Sidebar>` element. The relocation effect SHALL track `currentContent`, `isLastChapter`, `pluginsReady`, AND `renderEpoch` (from `useChapterNav()`) as dependencies — at minimum the union sufficient to re-run whenever the chapter view is re-rendered for any reason. The effect SHALL run with `flush: "post"` and SHALL `await nextTick()` before reading `.plugin-sidebar` so Vue's `v-html` patches have completed. The effect SHALL clear the `<Sidebar>` contents at the start of every run so stale panels from a previous chapter or a previous render cannot leak. The effect SHALL skip the relocation step entirely when `pluginsSettled` is `false` or `currentContent` is empty.

#### Scenario: Sidebar relocation re-runs after byte-identical edit
- **WHEN** the user edits the current chapter to byte-identical content and saves
- **THEN** the rendered chapter view is invalidated, `renderEpoch` increments, and the relocation watch SHALL re-run, populating `<Sidebar>` with the freshly-rendered `.plugin-sidebar` panels

#### Scenario: Sidebar is cleared when navigating to a chapter without plugin panels
- **WHEN** the user navigates from a chapter whose render produced `.plugin-sidebar` panels to a chapter whose render does not
- **THEN** the `<Sidebar>` SHALL be empty after the watch settles — no leaked panels from the previous chapter

#### Scenario: Sidebar relocation re-runs after pluginsReady transitions
- **WHEN** `pluginsReady` flips from `false` to `true` while `currentContent` is non-empty (e.g. async plugin registration completes after the initial render)
- **THEN** the relocation watch SHALL re-run and SHALL relocate any newly-produced `.plugin-sidebar` panels into `<Sidebar>`

## MODIFIED Requirements

### Requirement: Component hierarchy

The Vue application SHALL follow a single root hierarchy with two top-level routed layouts: `App.vue` → `PassphraseGate` → (router-view renders either `MainLayout` or `SettingsLayout` based on current route).

**MainLayout branch**: `MainLayout` → (`AppHeader`, `ContentArea`, `Sidebar`, `ChatInput`, `StorySelector`, `ChapterContent`, `VentoErrorCard`). `MainLayout` SHALL orchestrate the grid layout and conditionally render child components based on application state. The `AppHeader` within `MainLayout` SHALL replace the previous `⚙️ Prompt` button with a gear icon that navigates to the `/settings` route via `router.push('/settings')`. The `AppHeader` SHALL NOT contain `showEditor`, `showPreview` state, or `<Teleport>` directives for editor/preview overlays.

**ContentArea SHALL gate `<ChapterContent>` on the conjunction of `currentContent` (non-empty) AND `pluginsSettled` (true). When `currentContent` is non-empty but plugins have not yet settled, ContentArea SHALL render a minimal loading placeholder instead of `<ChapterContent>`. ContentArea SHALL also relocate `.plugin-sidebar` elements into `<Sidebar>` via an explicit `watch` whose dependencies cover every render-invalidation signal (`currentContent`, `isLastChapter`, `pluginsReady`, `renderEpoch`).**

**SettingsLayout branch**: `SettingsLayout` → (sidebar with tab navigation, `<router-view />` content area rendering `PromptEditorPage`). `SettingsLayout` is a top-level routed component alongside `MainLayout`, not nested within it. `PromptEditorPage` wraps `PromptEditor` and inline `PromptPreview`.

The component hierarchy SHALL NOT include plugin-specific components such as `StatusBar`, `OptionsPanel`, or `VariableDisplay` — these are rendered as HTML strings by their respective plugins' `frontend.js` modules and injected via `v-html` in `html` tokens. `App.vue` SHALL be the mount point registered via `createApp()`. `PassphraseGate` SHALL gate all content behind authentication.

This change does NOT relocate ownership of deep-link backend chapter loading. `App.vue#handleUnlocked` continues to await `Promise.all([initPlugins(), applyBackground()])` before any `loadFromBackend()` call, which is sufficient ordering given the new readiness gate. A future change MAY relocate that ownership to the route watcher; doing so is explicitly out of scope here.

#### Scenario: App mounts root component
- **WHEN** the application entry point (`main.ts`) is executed
- **THEN** `createApp(App)` SHALL mount `App.vue` to the `#app` element in `index.html`

#### Scenario: PassphraseGate blocks unauthenticated access
- **WHEN** the user has not authenticated
- **THEN** `PassphraseGate` SHALL render the passphrase overlay and SHALL NOT render `MainLayout`, `SettingsLayout`, or any child components

#### Scenario: MainLayout renders after authentication on reader routes
- **WHEN** the user successfully authenticates and is on a reader route (`/`, `/:series/:story`, or `/:series/:story/chapter/:chapter`)
- **THEN** `MainLayout` SHALL render and display `AppHeader`, `ContentArea`, `Sidebar`, `ChatInput`, and other child components according to current application state

#### Scenario: SettingsLayout renders on settings routes
- **WHEN** the user navigates to `/settings/prompt-editor`
- **THEN** `SettingsLayout` SHALL render with a sidebar and content area, and the content area SHALL display `PromptEditorPage`

#### Scenario: AppHeader uses gear icon for settings navigation
- **WHEN** the `AppHeader` component is rendered within `MainLayout`
- **THEN** it SHALL display a gear icon button that calls `router.push('/settings')` when clicked, replacing the previous `⚙️ Prompt` button and removing any `showEditor`/`showPreview` state or `<Teleport>` overlay logic

#### Scenario: No plugin-specific Vue components in reader-src
- **WHEN** listing Vue component files in `reader-src/src/components/`
- **THEN** no `StatusBar.vue`, `OptionsPanel.vue`, or `VariableDisplay.vue` SHALL exist — plugin rendering is done by plugin `frontend.js` modules producing HTML strings

#### Scenario: ContentArea defers ChapterContent until plugins are settled
- **WHEN** `currentContent` is non-empty but `pluginsSettled` is still `false`
- **THEN** `ContentArea` SHALL render the loading placeholder element and SHALL NOT mount `<ChapterContent>`

### Requirement: Composables for shared state

Shared reactive state SHALL be encapsulated in composable functions following the `use*()` naming convention. The following composables SHALL be implemented: `useAuth()` (passphrase state and verification), `useChapterNav()` (chapter index, content, navigation, polling, **`renderEpoch` invalidation counter, `refreshAfterEdit(targetChapter)` entry point**), `usePlugins()` (plugin loading, hook dispatcher initialization, **`pluginsReady` and `pluginsSettled` reactive readiness flags**), `useFileReader()` (File System Access API handles, IndexedDB persistence), `useStorySelector()` (series/story reactive selection state), and `usePromptEditor()` (template content, localStorage sync). Composable files SHALL reside in `reader-src/src/composables/` and SHALL export typed return interfaces.

#### Scenario: useAuth composable provides reactive auth state
- **WHEN** a component calls `useAuth()`
- **THEN** it SHALL receive a reactive `isAuthenticated` ref, a `passphrase` ref, and a `verify(passphrase: string): Promise<boolean>` method that calls `GET /api/auth/verify`

#### Scenario: useChapterNav composable manages navigation
- **WHEN** a component calls `useChapterNav()`
- **THEN** it SHALL receive reactive refs for `currentIndex`, `chapters`, `totalChapters`, `isLastChapter`, `currentContent` (a `shallowRef`), and `renderEpoch`, plus functions `goNext()`, `goPrev()`, `loadChapters()`, `refreshAfterEdit(targetChapter)`, and `bumpRenderEpoch()`

#### Scenario: usePlugins composable wraps hook dispatcher
- **WHEN** a component calls `usePlugins()`
- **THEN** it SHALL receive a `hookDispatcher` instance (FrontendHookDispatcher), a reactive `plugins` ref listing loaded plugins, an `initPlugins()` function, and reactive `pluginsReady: Ref<boolean>` and `pluginsSettled: Ref<boolean>` flags

#### Scenario: useFileReader composable wraps FSA and IndexedDB
- **WHEN** a component calls `useFileReader()`
- **THEN** it SHALL receive reactive refs for `directoryHandle` and `files`, and functions `openDirectory()`, `tryRestoreSession()`, `readFile()`

#### Scenario: useStorySelector composable provides cascading state
- **WHEN** a component calls `useStorySelector()`
- **THEN** it SHALL receive reactive refs for `seriesList`, `selectedSeries`, `storyList`, `selectedStory`, and functions `loadSeries()`, `loadStories()`

#### Scenario: usePromptEditor composable syncs with localStorage
- **WHEN** a component calls `usePromptEditor()`
- **THEN** it SHALL receive a reactive `templateContent` ref that auto-syncs with localStorage, and functions `saveTemplate()`, `loadTemplate()`, `previewTemplate()`
