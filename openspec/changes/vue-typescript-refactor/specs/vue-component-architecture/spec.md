# Vue Component Architecture

## Purpose

Vue 3 component hierarchy, Single File Component structure, composables for shared reactive state, Vite build integration with Deno, and migration of the vanilla JS frontend to a type-safe component-based architecture.

## ADDED Requirements

### Requirement: Component hierarchy

The Vue application SHALL follow a single root hierarchy: `App.vue` → `PassphraseGate` → `MainLayout` → (`Header`, `ContentArea`, `Sidebar`, `ChatInput`, `PromptEditor`, `PromptPreview`, `StorySelector`). `App.vue` SHALL be the mount point registered via `createApp()`. `PassphraseGate` SHALL gate all content behind authentication. `MainLayout` SHALL orchestrate the grid layout and conditionally render child components based on application state.

#### Scenario: App mounts root component
- **WHEN** the application entry point (`main.ts`) is executed
- **THEN** `createApp(App)` SHALL mount `App.vue` to the `#app` element in `index.html`

#### Scenario: PassphraseGate blocks unauthenticated access
- **WHEN** the user has not authenticated
- **THEN** `PassphraseGate` SHALL render the passphrase overlay and SHALL NOT render `MainLayout` or any child components

#### Scenario: MainLayout renders after authentication
- **WHEN** the user successfully authenticates via `PassphraseGate`
- **THEN** `MainLayout` SHALL render and display `Header`, `ContentArea`, `Sidebar`, `ChatInput`, and other child components according to current application state

#### Scenario: ChatInput visibility controlled by MainLayout
- **WHEN** the user is viewing the last chapter in backend mode
- **THEN** `MainLayout` SHALL render the `ChatInput` component; when viewing a non-last chapter, `ChatInput` SHALL NOT be rendered

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

Shared reactive state SHALL be encapsulated in composable functions following the `use*()` naming convention. The following composables SHALL be implemented: `useAuth()` (passphrase state and verification), `useChapterNav()` (chapter index, content, navigation, polling), `usePlugins()` (plugin loading, hook dispatcher initialization), `useFileReader()` (File System Access API handles, IndexedDB persistence), `useStorySelector()` (series/story reactive selection state), and `usePromptEditor()` (template content, localStorage sync). Composable files SHALL reside in `reader-src/src/composables/` and SHALL export typed return interfaces.

#### Scenario: useAuth composable provides reactive auth state
- **WHEN** a component calls `useAuth()`
- **THEN** it SHALL receive a reactive `isAuthenticated` ref, a `passphrase` ref, and a `verify(passphrase: string): Promise<boolean>` method that calls `GET /api/auth/verify`

#### Scenario: useChapterNav composable manages navigation
- **WHEN** a component calls `useChapterNav()`
- **THEN** it SHALL receive reactive refs for `currentIndex`, `chapters`, `totalChapters`, `isLastChapter`, and functions `goNext()`, `goPrev()`, `loadChapters()`

#### Scenario: usePlugins composable wraps hook dispatcher
- **WHEN** a component calls `usePlugins()`
- **THEN** it SHALL receive a `hookDispatcher` instance (FrontendHookDispatcher), a reactive `plugins` ref listing loaded plugins, and an `initPlugins()` function

#### Scenario: useFileReader composable wraps FSA and IndexedDB
- **WHEN** a component calls `useFileReader()`
- **THEN** it SHALL receive reactive refs for `directoryHandle` and `files`, and functions `openDirectory()`, `tryRestoreSession()`, `readFile()`

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
- **WHEN** a composable needs to share state across multiple components (e.g., `useAuth`, `useFileReader`, `usePlugins`, `useChapterNav`)
- **THEN** it SHALL declare module-scoped `ref()` or `reactive()` instances outside the composable function body, and the composable function SHALL return references to these module-level reactive objects — this is the approved singleton pattern replacing vanilla JS module-scoped `let` variables

#### Scenario: No non-reactive module-scoped mutable state
- **WHEN** the codebase is searched for module-level `let` assignments for UI state
- **THEN** no composable or component file SHALL contain non-reactive mutable state (plain `let` variables, mutable objects/arrays) at module scope from the vanilla JS codebase — all module-scoped mutable state SHALL use Vue reactivity primitives (`ref()`, `reactive()`, `shallowRef()`)

#### Scenario: Parent-child communication via props and emits
- **WHEN** a child component needs data from its parent
- **THEN** the parent SHALL pass it via props; when the child needs to notify the parent, it SHALL use `emit()` — not direct state mutation or global events

### Requirement: TypeScript strict mode with interface definitions

All frontend TypeScript code SHALL compile under `strict: true` with `noImplicitAny`, `strictNullChecks`, and `noUncheckedIndexedAccess` enabled (matching the project's existing `deno.json` compiler options). All component props SHALL be defined using `defineProps<T>()` with an explicit TypeScript interface. All component emits SHALL be defined using `defineEmits<T>()` with typed event signatures. All composable return types SHALL have explicit interface definitions exported from the composable file.

#### Scenario: Props defined with TypeScript interface
- **WHEN** a component accepts props (e.g., `ContentArea` receiving chapter content)
- **THEN** it SHALL use `defineProps<ContentAreaProps>()` where `ContentAreaProps` is an explicitly defined interface

#### Scenario: Emits defined with TypeScript interface
- **WHEN** a component emits events (e.g., `ChatInput` emitting a message submission)
- **THEN** it SHALL use `defineEmits<{ submit: [message: string] }>()` with typed event payloads

#### Scenario: Composable return type is explicit
- **WHEN** a composable function is exported
- **THEN** its return type SHALL be an explicitly defined interface (e.g., `UseAuthReturn`) exported from the same file

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
  | { type: 'html'; content: string }
  | { type: 'status'; data: StatusData }
  | { type: 'options'; data: OptionItem[] }
  | { type: 'variable'; data: { content: string; isComplete: boolean } }
  | { type: 'vento-error'; data: VentoErrorData };
```

Where `StatusData` maps to `ParsedStatus`, `OptionItem` maps to `ParsedOption`, and `VentoErrorData` contains the `message`, `source?`, `line?`, and `suggestion?` fields from the vento-error-handling spec. The `RenderToken` type SHALL be exported from a shared types module (e.g., `reader-src/src/types.ts`) and used by the markdown renderer composable, the `ChapterContent.vue` component, and any other component that consumes render output.

#### Scenario: RenderToken discriminated union enables type narrowing
- **WHEN** a component iterates over a `RenderToken[]` array
- **THEN** TypeScript SHALL allow narrowing via `token.type` to access the correct data shape (e.g., `token.data` is `StatusData` when `token.type === 'status'`)

#### Scenario: RenderToken type used by markdown renderer
- **WHEN** the `useMarkdownRenderer()` composable returns rendered output
- **THEN** the return type SHALL be `RenderToken[]` (or a `Ref<RenderToken[]>`), not a single HTML string

### Requirement: ChapterContent token-based rendering

The `ChapterContent.vue` component (or equivalent content display component within `ContentArea`) SHALL receive a `RenderToken[]` array from the `useMarkdownRenderer()` composable and render it using `v-for` iteration. For each token:
- `{ type: 'html' }` tokens SHALL be rendered as `<div v-html="token.content"></div>`
- `{ type: 'status' }` tokens SHALL be rendered as `<StatusBar :data="token.data" />`
- `{ type: 'options' }` tokens SHALL be rendered as `<OptionsPanel :items="token.data" @optionSelected="..." />`
- `{ type: 'variable' }` tokens SHALL be rendered as `<VariableDisplay :content="token.data.content" :isComplete="token.data.isComplete" />`
- `{ type: 'vento-error' }` tokens SHALL be rendered as `<VentoErrorCard v-bind="token.data" />`

This pattern resolves the architectural conflict between `v-html` (which cannot instantiate Vue components or bind events) and Vue component features (props, emits, scoped events) needed by custom blocks.

#### Scenario: Mixed prose and custom blocks render correctly
- **WHEN** the markdown renderer returns `[{ type: 'html', content: '<p>Prose</p>' }, { type: 'status', data: statusData }, { type: 'html', content: '<p>More prose</p>' }, { type: 'options', data: optionItems }]`
- **THEN** `ChapterContent.vue` SHALL render a `<div>` with prose HTML, then a live `<StatusBar>` component, then another `<div>` with prose HTML, then a live `<OptionsPanel>` component — all in document order

#### Scenario: OptionsPanel emits events when rendered as token
- **WHEN** an `{ type: 'options' }` token is rendered as `<OptionsPanel>` by `ChapterContent.vue`
- **THEN** the component SHALL emit `optionSelected` events that the parent can handle via `@optionSelected`, proving that Vue component features work correctly (unlike `v-html` injection)

#### Scenario: Empty token array renders nothing
- **WHEN** the markdown renderer returns an empty `RenderToken[]` array
- **THEN** `ChapterContent.vue` SHALL render no content blocks without errors
