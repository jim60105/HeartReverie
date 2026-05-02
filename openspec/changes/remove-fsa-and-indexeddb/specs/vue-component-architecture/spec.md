## MODIFIED Requirements

### Requirement: Composables for shared state

Shared reactive state SHALL be encapsulated in composable functions following the `use*()` naming convention. The following composables SHALL be implemented: `useAuth()` (passphrase state and verification), `useChapterNav()` (chapter index, content, navigation, polling, **`renderEpoch` invalidation counter, `refreshAfterEdit(targetChapter)` entry point**), `usePlugins()` (plugin loading, hook dispatcher initialization, **`pluginsReady` and `pluginsSettled` reactive readiness flags**), `useStorySelector()` (series/story reactive selection state), and `usePromptEditor()` (template content, localStorage sync). Composable files SHALL reside in `reader-src/src/composables/` and SHALL export typed return interfaces.

#### Scenario: useAuth composable provides reactive auth state
- **WHEN** a component calls `useAuth()`
- **THEN** it SHALL receive a reactive `isAuthenticated` ref, a `passphrase` ref, and a `verify(passphrase: string): Promise<boolean>` method that calls `GET /api/auth/verify`

#### Scenario: useChapterNav composable manages navigation
- **WHEN** a component calls `useChapterNav()`
- **THEN** it SHALL receive reactive refs for `currentIndex`, `chapters`, `totalChapters`, `isLastChapter`, `currentContent` (a `shallowRef`), and `renderEpoch`, plus functions `goNext()`, `goPrev()`, `loadChapters()`, `refreshAfterEdit(targetChapter)`, and `bumpRenderEpoch()`

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
