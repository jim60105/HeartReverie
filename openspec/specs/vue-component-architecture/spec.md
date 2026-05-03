# Vue Component Architecture

## Purpose

Vue 3 component hierarchy, Single File Component structure, composables for shared reactive state, Vite build integration with Deno, and migration of the vanilla JS frontend to a type-safe component-based architecture.

## Requirements

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

### Requirement: Single File Component structure

All Vue components SHALL use the `<script setup lang="ts">` syntax with the Composition API. Each `.vue` file SHALL contain exactly three blocks: `<script setup lang="ts">`, `<template>`, and optionally `<style scoped>`. Components SHALL NOT use the Options API. Component files SHALL reside in `reader-src/src/components/`.

#### Scenario: Component uses script setup with TypeScript
- **WHEN** a developer opens any `.vue` component file
- **THEN** the file SHALL contain a `<script setup lang="ts">` block using Composition API patterns (`ref`, `computed`, `watch`, `onMounted`)

#### Scenario: No Options API usage
- **WHEN** the codebase is searched for Options API patterns (`data()`, `methods:`, `computed:` as object keys, `watch:` as object key)
- **THEN** no Vue component SHALL contain these patterns

#### Scenario: Component file location
- **WHEN** listing component files
- **THEN** all `.vue` files (except `App.vue` at `reader-src/src/App.vue`) SHALL reside under `reader-src/src/components/`

### Requirement: Composables for shared state

Shared reactive state SHALL be encapsulated in composable functions following the `use*()` naming convention. The following composables SHALL be implemented: `useAuth()` (passphrase state and verification), `useChapterNav()` (chapter index, content, navigation, polling, **`renderEpoch` invalidation counter, `refreshAfterEdit(targetChapter)` entry point**), `usePlugins()` (plugin loading, hook dispatcher initialization, **`pluginsReady` and `pluginsSettled` reactive readiness flags**), `useStorySelector()` (series/story reactive selection state), and `usePromptEditor()` (template content, localStorage sync). Composable files SHALL reside in `reader-src/src/composables/` and SHALL export typed return interfaces.

#### Scenario: useAuth composable provides reactive auth state
- **WHEN** a component calls `useAuth()`
- **THEN** it SHALL receive a reactive `isAuthenticated` ref, a `passphrase` ref, and a `verify(passphrase: string): Promise<boolean>` method that calls `GET /api/auth/verify`

#### Scenario: useChapterNav composable manages navigation
- **WHEN** a component calls `useChapterNav()`
- **THEN** it SHALL receive reactive refs for `currentIndex`, `chapters`, `totalChapters`, `isLastChapter`, `currentContent` (a `shallowRef`), and `renderEpoch`, plus functions `next()`, `previous()`, `loadFromBackend()`, `refreshAfterEdit(targetChapter)`, and `bumpRenderEpoch()`

#### Scenario: usePlugins composable wraps hook dispatcher
- **WHEN** a component calls `usePlugins()`
- **THEN** it SHALL receive a `hookDispatcher` instance (FrontendHookDispatcher), a reactive `plugins` ref listing loaded plugins, an `initPlugins()` function, and reactive `pluginsReady: Ref<boolean>` and `pluginsSettled: Ref<boolean>` flags

#### Scenario: useStorySelector composable provides cascading state
- **WHEN** a component calls `useStorySelector()`
- **THEN** it SHALL receive reactive refs for `seriesList`, `selectedSeries`, `storyList`, `selectedStory`, and functions `loadSeries()`, `loadStories()`

#### Scenario: usePromptEditor composable syncs with localStorage
- **WHEN** a component calls `usePromptEditor()`
- **THEN** it SHALL receive a reactive `templateContent` ref that auto-syncs with localStorage, and functions `saveTemplate()`, `loadTemplate()`, `previewTemplate()`

### Requirement: Reactive state management

All mutable UI state SHALL use Vue reactivity primitives: `ref()` for scalar values, `reactive()` for objects, `computed()` for derived values, and `watch()`/`watchEffect()` for side effects. Module-scoped mutable variables (`let state = { ... }`) from the vanilla JS codebase SHALL be replaced entirely by composable-managed reactive state. No component SHALL directly mutate state owned by another component; parent-child communication SHALL use props (down) and emits (up).

#### Scenario: Scalar state uses ref
- **WHEN** a composable or component declares a single-value reactive state (e.g., current chapter index, loading flag)
- **THEN** it SHALL use `ref()` and access the value via `.value` in script and directly in templates

#### Scenario: Derived state uses computed
- **WHEN** state is derived from other reactive values (e.g., `isFirstChapter` from `currentIndex`)
- **THEN** it SHALL be declared with `computed()` and SHALL automatically update when dependencies change

#### Scenario: Module-level reactive singletons are the approved shared state pattern
- **WHEN** a composable needs to share state across multiple components (e.g., `useAuth`, `usePlugins`, `useChapterNav`)
- **THEN** it SHALL declare module-scoped `ref()` or `reactive()` instances outside the composable function body, and the composable function SHALL return references to these module-level reactive objects — this is the approved singleton pattern replacing vanilla JS module-scoped `let` variables

#### Scenario: No non-reactive module-scoped mutable state
- **WHEN** the codebase is searched for module-level `let` assignments for UI state
- **THEN** no composable or component file SHALL contain non-reactive mutable state (plain `let` variables, mutable objects/arrays) at module scope from the vanilla JS codebase — all module-scoped mutable state SHALL use Vue reactivity primitives (`ref()`, `reactive()`, `shallowRef()`)

#### Scenario: Parent-child communication via props and emits
- **WHEN** a child component needs data from its parent
- **THEN** the parent SHALL pass it via props; when the child needs to notify the parent, it SHALL use `emit()` — not direct state mutation or global events

### Requirement: TypeScript strict mode with interface definitions

All frontend TypeScript code SHALL compile under `strict: true` with `noImplicitAny`, `strictNullChecks`, and `noUncheckedIndexedAccess` enabled. All component props SHALL be defined using `defineProps<T>()` with an explicit TypeScript interface. All component emits SHALL be defined using `defineEmits<T>()` with typed event signatures. All composable return types SHALL have explicit interface definitions exported from the composable file. The shared types module (`reader-src/src/types/index.ts`) SHALL NOT contain plugin-specific interfaces such as `StatusBarProps`, `CloseUpEntry`, `OptionItem`, `OptionsPanelProps`, `VariableDisplayProps`, or `OptionsPanelEmits` — these types belong within their respective plugins.

#### Scenario: Props defined with TypeScript interface
- **WHEN** a component accepts props (e.g., `ContentArea` receiving chapter content)
- **THEN** it SHALL use `defineProps<ContentAreaProps>()` where `ContentAreaProps` is an explicitly defined interface

#### Scenario: Emits defined with TypeScript interface
- **WHEN** a component emits events (e.g., `ChatInput` emitting a message submission)
- **THEN** it SHALL use `defineEmits<{ submit: [message: string] }>()` with typed event payloads

#### Scenario: No plugin-specific types in shared types module
- **WHEN** inspecting `reader-src/src/types/index.ts`
- **THEN** no plugin-specific interfaces (such as `StatusBarProps`, `OptionItem`, `VariableDisplayProps`) SHALL be defined — only core application types

#### Scenario: Strict compilation passes
- **WHEN** `deno task build:reader` is executed
- **THEN** the Vite/Vue TypeScript compilation SHALL succeed with zero type errors under strict mode

### Requirement: Vite build integration with Deno

The frontend SHALL be built using Vite with `@vitejs/plugin-vue`. Build tasks SHALL be defined in `deno.json`: `build:reader` (production build) and `dev:reader` (development server with HMR). The Vite config SHALL reside at `reader-src/vite.config.ts`. The build output SHALL target `reader-dist/` directory. The backend's static file serving route SHALL serve from the build output directory in production.

#### Scenario: Production build task
- **WHEN** `deno task build:reader` is executed
- **THEN** Vite SHALL compile all Vue SFCs and TypeScript into bundled JavaScript in `reader-dist/`

#### Scenario: Development server task
- **WHEN** `deno task dev:reader` is executed
- **THEN** Vite SHALL start a development server with Hot Module Replacement for `.vue` files

#### Scenario: Vite config location and plugin
- **WHEN** the Vite configuration is loaded
- **THEN** `reader-src/vite.config.ts` SHALL exist and SHALL include `@vitejs/plugin-vue` in its plugins array

#### Scenario: Build output directory
- **WHEN** a production build completes
- **THEN** the output SHALL be written to `reader-dist/` containing `index.html`, bundled JS, and CSS assets

#### Scenario: Backend serves build output
- **WHEN** the Hono server serves static frontend files in production
- **THEN** it SHALL serve from the Vite build output directory (`reader-dist/`) instead of raw `reader-src/` source files

### Requirement: CSS strategy

Shared theme variables (colors, fonts, spacing, transitions) SHALL be defined in a single CSS custom properties file (`reader-src/src/styles/theme.css`) and imported in `App.vue`. Component-specific styles SHALL use `<style scoped>` to prevent class name collisions. The inline CSS currently in `index.html` SHALL be fully extracted — no inline `<style>` blocks SHALL remain in the production `index.html`. Tailwind CSS SHALL be integrated via PostCSS plugin (replacing CDN script tag).

#### Scenario: Theme variables defined centrally
- **WHEN** a component references a CSS custom property (e.g., `var(--color-primary)`)
- **THEN** that property SHALL be defined in `reader-src/src/styles/theme.css` and imported at the application root

#### Scenario: Component styles are scoped
- **WHEN** a component defines styles in its `<style scoped>` block
- **THEN** those styles SHALL NOT leak to sibling or parent components

#### Scenario: No inline styles in production HTML
- **WHEN** the production `index.html` (in `reader-dist/`) is inspected
- **THEN** it SHALL NOT contain inline `<style>` blocks; all styles SHALL be in external CSS files or component-scoped styles

#### Scenario: Tailwind via PostCSS
- **WHEN** Tailwind CSS utility classes are used in component templates
- **THEN** Tailwind SHALL be processed via PostCSS plugin during the Vite build, not loaded from a CDN `<script>` tag

### Requirement: Plugin system integration

The `FrontendHookDispatcher` class SHALL be preserved as a TypeScript class to maintain backward compatibility with existing plugin `frontend.js` modules. The `usePlugins()` composable SHALL wrap `FrontendHookDispatcher` initialization and plugin loading. The plugin `register(frontendHooks)` contract SHALL remain unchanged — existing plugins SHALL work without modification. Dynamic `import()` of plugin frontend modules SHALL continue to use the path pattern `/plugins/{name}/frontend.js`.

#### Scenario: FrontendHookDispatcher preserved as TypeScript class
- **WHEN** a plugin's `frontend.js` calls `register(frontendHooks)`
- **THEN** `frontendHooks` SHALL be an instance of `FrontendHookDispatcher` with the same API surface as the vanilla JS version

#### Scenario: Plugin register contract unchanged
- **WHEN** an existing plugin `frontend.js` module exports `register(frontendHooks)`
- **THEN** it SHALL work without modification after the Vue migration

#### Scenario: Plugin dynamic import path preserved
- **WHEN** the plugin loader imports a frontend module
- **THEN** it SHALL use `import('/plugins/{name}/frontend.js')` matching the current path convention

### Requirement: NPM package imports replace CDN dependencies

CDN-loaded dependencies (`marked`, `DOMPurify`, Tailwind CSS, Google Fonts script) SHALL be replaced with npm package imports managed by the Vite build. `marked` SHALL be imported as `import { marked } from 'marked'`. `DOMPurify` SHALL be imported as `import DOMPurify from 'dompurify'`. These packages SHALL be declared in `package.json` (or `deno.json` imports) and bundled by Vite.

#### Scenario: marked imported as npm package
- **WHEN** the markdown rendering composable uses `marked`
- **THEN** it SHALL import from the npm package (`import { marked } from 'marked'`) not from a CDN URL

#### Scenario: DOMPurify imported as npm package
- **WHEN** HTML sanitization is performed
- **THEN** `DOMPurify` SHALL be imported from the npm package (`import DOMPurify from 'dompurify'`) not from a CDN URL

#### Scenario: No CDN script tags in production
- **WHEN** the production `index.html` is inspected
- **THEN** it SHALL NOT contain `<script>` tags loading from `cdn.tailwindcss.com`, `cdn.jsdelivr.net`, or other CDN hosts for libraries that have been replaced by npm imports

### Requirement: Build output directory structure

The Vite production build SHALL output a valid single-page application structure in `reader-dist/`. The output SHALL include an `index.html` entry point, hashed JS bundle(s) in `reader-dist/assets/`, hashed CSS file(s) in `reader-dist/assets/`, and source maps for debugging. The `reader-dist/` directory SHALL be gitignored.

#### Scenario: Production build output structure
- **WHEN** `deno task build:reader` completes
- **THEN** `reader-dist/` SHALL contain `index.html`, and `assets/` with hashed `.js` and `.css` files

#### Scenario: Source maps generated
- **WHEN** the production build completes
- **THEN** `.js.map` files SHALL be present alongside the bundled JavaScript files in `reader-dist/assets/`. This requires `build.sourcemap` to be explicitly set to `true` in `reader-src/vite.config.ts`.

### Requirement: RenderToken type definition

The frontend type system SHALL define a discriminated union type `RenderToken` representing all possible rendering output segments from the markdown pipeline. The type SHALL be defined as:

```typescript
type RenderToken =
  | HtmlToken
  | VentoErrorToken;

interface HtmlToken {
  type: 'html';
  content: string;
}

interface VentoErrorToken {
  type: 'vento-error';
  data: VentoErrorCardProps;
}
```

Where `VentoErrorCardProps` contains the `message`, `source?`, `line?`, and `suggestion?` fields from the vento-error-handling spec. The `RenderToken` type SHALL NOT include plugin-specific variants (such as `status`, `options`, or `variable`) — plugin-rendered content is embedded as HTML strings within `html` tokens after `frontend-render` hook dispatch and placeholder reinsertion. The `RenderToken` type SHALL be exported from a shared types module (e.g., `reader-src/src/types/index.ts`) and used by the markdown renderer composable and the content display component.

#### Scenario: RenderToken discriminated union enables type narrowing
- **WHEN** a component iterates over a `RenderToken[]` array
- **THEN** TypeScript SHALL allow narrowing via `token.type` to access the correct data shape (`content: string` when `token.type === 'html'`, `data: VentoErrorCardProps` when `token.type === 'vento-error'`)

#### Scenario: RenderToken type used by markdown renderer
- **WHEN** the `useMarkdownRenderer()` composable returns rendered output
- **THEN** the return type SHALL be `RenderToken[]` (or a `Ref<RenderToken[]>`), not a single HTML string

#### Scenario: No plugin-specific token types in RenderToken
- **WHEN** the `RenderToken` type definition is inspected
- **THEN** it SHALL contain only `html` and `vento-error` variants — no `status`, `options`, `variable`, or other plugin-specific types SHALL exist in the union

### Requirement: ChapterContent token-based rendering

The `ChapterContent.vue` component (or equivalent content display component within `ContentArea`) SHALL receive a `RenderToken[]` array from the `useMarkdownRenderer()` composable and render it using `v-for` iteration. For each token:
- `{ type: 'html' }` tokens SHALL be rendered as `<div v-html="token.content"></div>` — this includes plugin-rendered HTML (status bars, options panels, variable displays) that was embedded via placeholder reinsertion during `frontend-render` hook processing
- `{ type: 'vento-error' }` tokens SHALL be rendered as `<VentoErrorCard v-bind="token.data" />`

The component SHALL NOT import or branch on plugin-specific Vue components (such as `StatusBar`, `OptionsPanel`, `VariableDisplay`). Plugin rendering is fully delegated to `frontend-render` hooks that produce HTML strings, keeping the core content component plugin-agnostic.

#### Scenario: Mixed prose and plugin-rendered blocks render correctly
- **WHEN** the markdown renderer returns tokens containing prose HTML and plugin-rendered HTML (from `frontend-render` hooks that extracted and rendered `<status>` and `<options>` blocks)
- **THEN** `ChapterContent.vue` SHALL render all content in document order using `v-html` for `html` tokens, with plugin-rendered HTML appearing at the correct positions within the prose

#### Scenario: Only two token type branches exist
- **WHEN** inspecting the `ChapterContent.vue` template
- **THEN** the `v-for` loop SHALL branch on exactly two token types: `html` (rendered via `v-html`) and `vento-error` (rendered as `<VentoErrorCard>`)

#### Scenario: Empty token array renders nothing
- **WHEN** the markdown renderer returns an empty `RenderToken[]` array
- **THEN** `ChapterContent.vue` SHALL render no content blocks without errors

### Requirement: ContentArea gates ChapterContent on pluginsSettled

`reader-src/src/components/ContentArea.vue` SHALL render `<ChapterContent>` only when both `currentContent` (from `useChapterNav()`) is non-empty AND `pluginsSettled` (from `usePlugins()`) is `true`. When `currentContent` is non-empty but `pluginsSettled` is `false`, `ContentArea` SHALL render a minimal loading placeholder so the reader does not show a half-rendered chapter. When `currentContent` is empty, the existing welcome content SHALL render unchanged. Note that the gate intentionally uses `pluginsSettled` (not `pluginsReady`) so that a plugin-load failure still allows chapter content to render against the empty handler set.

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

### Requirement: ChapterContent dispatches chapter:dom:ready after render commits

The `ChapterContent.vue` component SHALL dispatch the frontend hook stage `chapter:dom:ready` exactly once per render commit, including the initial mount commit and every subsequent commit triggered by a change to its `tokens` prop or to `renderEpoch`. The dispatch SHALL be wired via a Vue `watch` (or equivalent reactivity primitive) on `[tokens, renderEpoch]` configured with `flush: "post"` and `immediate: true`, ensuring the dispatch fires AFTER Vue has applied the v-html update to the live DOM.

The dispatch context SHALL contain:
- `container`: the chapter's root `HTMLElement` (the `<div class="chapter-content">` element rendered by the component template).
- `tokens`: the same `RenderToken[]` array consumed by the template's `v-for`.
- `rawMarkdown`: the original chapter content string the tokens were produced from.
- `chapterIndex`: the zero-based index of the chapter (the value already exposed to the template for navigation).

The component SHALL NOT dispatch `chapter:dom:ready` in edit mode (when the chapter editor textarea is showing instead of the rendered tokens), because the rendered DOM does not exist in that state. When edit mode exits and the v-html template re-mounts, the watcher's normal commit-driven dispatch SHALL fire.

#### Scenario: Initial mount dispatches chapter:dom:ready once
- **WHEN** a `ChapterContent` instance mounts for the first time with a non-empty `tokens` prop
- **THEN** after Vue's first post-flush tick, `chapter:dom:ready` SHALL have been dispatched exactly once with the live container element

#### Scenario: Render-epoch bump dispatches again
- **WHEN** the parent calls `bumpRenderEpoch()` (e.g., after cancelling an edit) and the component re-mounts its v-html template
- **THEN** after the post-flush tick, `chapter:dom:ready` SHALL be dispatched again with the freshly-mounted container element; the new container element reference SHALL be different from the previous one (because the template was re-mounted)

#### Scenario: Edit mode does not dispatch
- **WHEN** the user enters edit mode (the chapter editor textarea is shown instead of rendered tokens)
- **THEN** `chapter:dom:ready` SHALL NOT be dispatched while edit mode is active

#### Scenario: Cancelling edit re-dispatches
- **WHEN** the user cancels an active edit, the component exits edit mode and remounts the rendered token template
- **THEN** after the post-flush tick following the remount, `chapter:dom:ready` SHALL be dispatched with the new container element

### Requirement: ChapterContent dispatches chapter:dom:dispose before unmount

The `ChapterContent.vue` component SHALL dispatch the frontend hook stage `chapter:dom:dispose` exactly once during `onBeforeUnmount`, passing the same `HTMLElement` previously used as the `container` for `chapter:dom:ready` plus the current `chapterIndex`. This allows plugins that maintain container-keyed state (e.g. `Range` registrations) to release that state and avoid leaking detached DOM across long sessions.

#### Scenario: Unmount dispatches chapter:dom:dispose
- **WHEN** a mounted `ChapterContent` instance is unmounted (e.g., the user navigates to a different route, switches stories, or the parent re-keys the component)
- **THEN** `chapter:dom:dispose` SHALL be dispatched exactly once with the previously-mounted container element and the current `chapterIndex` BEFORE Vue tears the element out of the DOM

#### Scenario: Dispose is skipped when no container exists
- **WHEN** unmount fires before the template ref ever populated (e.g., the component was never fully mounted)
- **THEN** the dispose dispatch SHALL be skipped without throwing
