# Vue Frontend Tests

## Purpose

Test suite for the Vue 3 + TypeScript frontend, migrating from Deno.test with @std/assert to Vitest with @vue/test-utils while maintaining equivalent or greater coverage across component rendering, composable logic, parser utilities, and hook dispatcher behavior.

## Requirements

### Requirement: Test framework migration to Vitest

All frontend tests SHALL use Vitest as the test runner and assertion library, replacing `Deno.test` and `@std/assert`. Vue component tests SHALL use `@vue/test-utils` for mounting and interacting with components. The test command `deno task test:frontend` SHALL invoke Vitest via `deno run -A npm:vitest@^3.1.2 run` (NOT `npx vitest run`). The root `deno task test` command SHALL also use the same Deno-based vitest invocation for its frontend test step. Vitest configuration SHALL reside in `reader-src/vite.config.ts` (or a dedicated `reader-src/vitest.config.ts`) with `jsdom` or `happy-dom` as the test environment. The `"types": ["vitest/globals"]` in `reader-src/tsconfig.json` MAY be adjusted for Deno compatibility if the type resolution path changes due to the removal of `node_modules`.

#### Scenario: Tests run via deno task
- **WHEN** `deno task test:frontend` is executed
- **THEN** Vitest SHALL be invoked via `deno run -A npm:vitest@^3.1.2 run` and SHALL run all frontend test files, reporting results with pass/fail counts

#### Scenario: Vitest environment configured
- **WHEN** the Vitest configuration is loaded
- **THEN** it SHALL specify a DOM environment (`jsdom` or `happy-dom`) for browser API simulation

#### Scenario: No Deno.test references remain
- **WHEN** the frontend test directory is searched for `Deno.test` or `@std/assert` imports
- **THEN** zero matches SHALL be found — all tests SHALL use Vitest `describe`/`it`/`expect` patterns

#### Scenario: No npx invocations in test command
- **WHEN** the `test:frontend` task definition in `deno.json` is examined
- **THEN** it SHALL use `deno run -A npm:vitest@^3.1.2 run` and SHALL NOT contain `npx`

### Requirement: Test file structure mirroring source hierarchy

Test files SHALL mirror the component and composable source hierarchy. Component tests SHALL reside in `reader-src/src/components/__tests__/` or colocated as `*.test.ts` files. Composable tests SHALL reside in `reader-src/src/composables/__tests__/` or colocated as `*.test.ts` files. Utility/parser tests SHALL reside alongside their source files or in a dedicated `__tests__/` directory. Each source module SHALL have a corresponding test file.

#### Scenario: Component test file exists for each component
- **WHEN** a Vue component exists at `reader-src/src/components/StatusBar.vue`
- **THEN** a corresponding test file SHALL exist (e.g., `StatusBar.test.ts` or `__tests__/StatusBar.test.ts`)

#### Scenario: Composable test file exists for each composable
- **WHEN** a composable exists at `reader-src/src/composables/useAuth.ts`
- **THEN** a corresponding test file SHALL exist (e.g., `useAuth.test.ts` or `__tests__/useAuth.test.ts`)

#### Scenario: Utility test file exists for parser modules
- **WHEN** a utility module exists (e.g., status block parser, options parser)
- **THEN** a corresponding test file SHALL exist covering its exported functions

### Requirement: Component tests with mount and shallowMount

Vue component tests SHALL use `@vue/test-utils` `mount()` or `shallowMount()` to render components in the test DOM environment. Component tests SHALL verify: (1) correct rendering based on props, (2) emitted events with correct payloads, (3) conditional rendering (`v-if`/`v-show`) based on reactive state, (4) slot content rendering where applicable. `shallowMount()` SHALL be preferred for unit tests to isolate components from their children; `mount()` SHALL be used for integration tests that verify parent-child interaction.

#### Scenario: Component renders correctly with props
- **WHEN** `StatusBar` is mounted with a `statusData` prop containing health, mood, and location fields
- **THEN** the rendered HTML SHALL contain elements displaying each field value

#### Scenario: Component emits events on interaction
- **WHEN** `ChatInput` is mounted and the user triggers a submit action
- **THEN** the component SHALL emit a `submit` event with the message string as payload, verifiable via `wrapper.emitted('submit')`

#### Scenario: Conditional rendering based on props
- **WHEN** `Header` is mounted with `showNavigation: false`
- **THEN** the navigation buttons (prev/next) SHALL NOT be present in the rendered DOM

#### Scenario: shallowMount isolates child components
- **WHEN** `MainLayout` is shallow-mounted
- **THEN** child components (`Header`, `ContentArea`, `Sidebar`) SHALL be rendered as stubs, not their full implementations

### Requirement: Composable tests

Composable functions SHALL be tested by invoking them inside a Vue component context. Tests SHALL use a wrapper component pattern (a minimal component that calls the composable and exposes its return values) or a `withSetup()` test helper. Composable tests SHALL verify: (1) initial reactive state values, (2) state changes after calling composable methods, (3) computed values updating when dependencies change, (4) side effects triggered by `watch`/`watchEffect`.

#### Scenario: useAuth initial state
- **WHEN** `useAuth()` is invoked in a test context
- **THEN** `isAuthenticated` SHALL be `false` and `passphrase` SHALL be an empty string

#### Scenario: useAuth authenticate updates state
- **WHEN** `useAuth().authenticate()` is called with a valid passphrase and the API returns success
- **THEN** `isAuthenticated` SHALL become `true`

#### Scenario: useChapterNav computed values update
- **WHEN** `useChapterNav()` is invoked and `chapters` is populated with 5 items, then `currentIndex` is set to 0
- **THEN** `isFirstChapter` SHALL be `true`, `isLastChapter` SHALL be `false`, and `totalChapters` SHALL be `5`

#### Scenario: useStorySelector cascading state
- **WHEN** `useStorySelector().selectedSeries` is set to a new value
- **THEN** `storyList` SHALL reactively update (via watch) by fetching stories for the selected series, and `selectedStory` SHALL reset

#### Scenario: usePromptEditor localStorage sync
- **WHEN** `usePromptEditor().templateContent` is modified
- **THEN** the new value SHALL be persisted to localStorage (verifiable via mock)

### Requirement: Parser and utility pure function tests

All pure parser and utility functions extracted from the vanilla JS codebase SHALL retain dedicated unit tests. These include: `escapeHtml()`, `extractStatusBlocks()`, `parseStatus()`, `extractOptionsBlocks()`, `parseOptions()`, `extractVariableBlocks()`, `renderVentoError()` (as a pure function if applicable), and `reinjectPlaceholders()`. These tests SHALL NOT require a Vue component context or DOM environment — they SHALL run as plain function tests using Vitest `describe`/`it`/`expect`.

#### Scenario: Status block extraction
- **WHEN** `extractStatusBlocks()` receives text containing a `<status>` XML block
- **THEN** it SHALL return the extracted block content and the text with the block replaced by a placeholder

#### Scenario: Options parsing
- **WHEN** `parseOptions()` receives a raw options block string
- **THEN** it SHALL return a structured array of option objects with text and metadata

#### Scenario: HTML escaping
- **WHEN** `escapeHtml()` receives a string with `<`, `>`, `&`, `"` characters
- **THEN** it SHALL return the string with all special characters replaced by HTML entities

#### Scenario: Placeholder reinsertion
- **WHEN** `reinjectPlaceholders()` receives HTML with comment placeholders and a map of extracted blocks
- **THEN** it SHALL replace each placeholder with the corresponding block content

#### Scenario: Variable block extraction
- **WHEN** `extractVariableBlocks()` receives text containing `<UpdateVariable>` XML blocks
- **THEN** it SHALL return an array of extracted block objects and the text with blocks replaced by placeholders

### Requirement: FrontendHookDispatcher tests preserved

The `FrontendHookDispatcher` class SHALL have dedicated tests covering: handler registration, priority-ordered dispatch, context mutation propagation across handlers, and error isolation (a failing handler SHALL NOT prevent subsequent handlers from executing). These tests SHALL be equivalent to the current 9 test steps in `plugin-hooks_test.js`.

#### Scenario: Priority-ordered dispatch
- **WHEN** multiple handlers are registered for the same stage with different priorities
- **THEN** dispatch SHALL call them in ascending priority order

#### Scenario: Context mutation propagation
- **WHEN** a handler mutates the context object during dispatch
- **THEN** subsequent handlers SHALL receive the mutated context

#### Scenario: Handler registration
- **WHEN** a handler is registered for a hook stage
- **THEN** it SHALL be included in the dispatch chain for that stage

#### Scenario: Error isolation between handlers
- **WHEN** a handler throws an error during dispatch
- **THEN** subsequent handlers for the same stage SHALL still be executed

### Requirement: Test coverage matching or exceeding current baseline

The migrated test suite SHALL contain at least 113 test cases (matching the current 13 top-level tests with 113 subtests across 7 files). New component and composable tests SHALL expand coverage beyond the current baseline. The test suite SHALL cover all 7 original test domains: markdown rendering, options panel parsing, plugin hooks, status bar parsing, HTML utilities, variable display parsing, and Vento error display.

#### Scenario: Minimum test count met
- **WHEN** `deno task test:frontend` completes
- **THEN** the total number of test cases (Vitest `it()` blocks) SHALL be at least 113

#### Scenario: All 7 original domains covered
- **WHEN** the test file listing is examined
- **THEN** test files SHALL exist covering: markdown rendering pipeline, options panel parsing, plugin hook dispatcher, status bar parsing, HTML utility functions, variable display parsing, and Vento error display

#### Scenario: New component tests expand coverage
- **WHEN** the total test count is compared to the baseline
- **THEN** component mount/render tests and composable state tests SHALL represent additional test cases beyond the 113 parser/utility baseline

### Requirement: Mock patterns for browser APIs

Tests requiring browser APIs SHALL use Vitest mocking utilities (`vi.fn()`, `vi.mock()`, `vi.stubGlobal()`) to provide test doubles. The following browser APIs SHALL have mock implementations: `fetch` (via `vi.fn()` returning mock Response objects), `navigator.clipboard` (via `vi.stubGlobal`), `localStorage` (via `vi.stubGlobal` or jsdom built-in), and `window.location` (hash manipulation for chapter state).

#### Scenario: Fetch mock for API calls
- **WHEN** a composable test calls a function that invokes `fetch('/api/auth', ...)`
- **THEN** `fetch` SHALL be mocked with `vi.fn()` returning a controlled `Response` object, and the test SHALL verify the request URL, method, and headers

#### Scenario: localStorage mock for prompt editor
- **WHEN** `usePromptEditor()` tests verify template persistence
- **THEN** `localStorage.getItem` and `localStorage.setItem` SHALL be mocked or use the jsdom built-in, and the test SHALL verify correct keys and values

#### Scenario: Clipboard mock for copy operations
- **WHEN** tests verify clipboard copy functionality
- **THEN** `navigator.clipboard.writeText` SHALL be mocked with `vi.fn()` and the test SHALL verify the copied text content
