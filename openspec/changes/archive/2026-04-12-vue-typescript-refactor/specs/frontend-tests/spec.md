## MODIFIED Requirements

### Requirement: Test framework and runner

The frontend test suite SHALL use Vitest as the test runner and `@vue/test-utils` for Vue component testing, replacing the previous `Deno.test` + `@std/assert` framework. Tests SHALL be invoked via `deno task test:frontend` which runs `vitest run`. Assertion patterns SHALL use Vitest's `expect()` API (e.g., `expect(result).toBe(expected)`, `expect(result).toEqual(expected)`) instead of `assertEquals`/`assert` from `@std/assert`. Test files SHALL use the `.test.ts` extension and reside in colocated `__tests__/` directories within the `reader-src/src/` source tree.

#### Scenario: Tests run via deno task
- **WHEN** a developer runs `deno task test:frontend`
- **THEN** Vitest SHALL execute all frontend test files and report pass/fail results

#### Scenario: Vitest assertion patterns
- **WHEN** a test asserts equality of two values
- **THEN** it SHALL use `expect(actual).toBe(expected)` or `expect(actual).toEqual(expected)` instead of `assertEquals(actual, expected)`

#### Scenario: Test file extension
- **WHEN** frontend test files are inspected
- **THEN** they SHALL use `.test.ts` extension and contain TypeScript with type annotations

### Requirement: Pure function tests for parsers

Unit tests SHALL cover all pure parser/renderer functions from the original frontend: `escapeHtml()`, `extractStatusBlocks()`, `parseStatus()`, `renderStatusPanel()`, `extractOptionsBlocks()`, `parseOptions()`, `extractVariableBlocks()`, `renderVariableBlock()`, `renderVentoError()`. All existing 113 test cases across 7 files SHALL be preserved and ported to the Vitest + `expect()` assertion style. Test files SHALL reside in colocated `__tests__/` directories within `reader-src/src/`.

#### Scenario: Status block extraction
- **WHEN** `extractStatusBlocks()` receives text containing a `<status>` XML block
- **THEN** it returns the extracted block content and the text with the block replaced by a placeholder

#### Scenario: Options parsing
- **WHEN** `parseOptions()` receives a raw options block string
- **THEN** it returns a structured array of option objects with text and metadata

#### Scenario: HTML escaping
- **WHEN** `escapeHtml()` receives a string with `<`, `>`, `&`, `"` characters
- **THEN** it returns the string with all special characters replaced by HTML entities

#### Scenario: All 113 existing test cases preserved
- **WHEN** the ported test suite is executed
- **THEN** all 113 original test cases SHALL be present and passing, covering the same input/output assertions as the original Deno-based tests

### Requirement: FrontendHookDispatcher tests

Unit tests SHALL cover the `FrontendHookDispatcher` class: registration, dispatch order, and priority sorting. The dispatcher class is preserved as-is for backward compatibility, so existing test logic SHALL be ported directly to Vitest assertions.

#### Scenario: Priority-ordered dispatch
- **WHEN** multiple handlers are registered for the same stage with different priorities
- **THEN** dispatch calls them in ascending priority order

#### Scenario: Context mutation
- **WHEN** a handler mutates the context object during dispatch
- **THEN** subsequent handlers receive the mutated context

### Requirement: Markdown rendering pipeline tests

Unit tests SHALL cover the `reinjectPlaceholders()` function. Test files SHALL reside in colocated `__tests__/` directories within `reader-src/src/`.

#### Scenario: Placeholder reinsertion
- **WHEN** `reinjectPlaceholders()` receives HTML with comment placeholders and a map of extracted blocks
- **THEN** it replaces each placeholder with the corresponding block content

## ADDED Requirements

### Requirement: Vue component tests

The test suite SHALL include component tests for Vue SFCs using `@vue/test-utils`. Component tests SHALL verify rendering output, prop handling, event emission, and composable integration for key components. Component tests SHALL mount components with `mount()` or `shallowMount()` and assert on the rendered DOM and emitted events.

#### Scenario: Component renders with props
- **WHEN** a Vue component (e.g., `StatusBar.vue`) is mounted with test props via `@vue/test-utils`
- **THEN** the rendered HTML SHALL reflect the prop values correctly

#### Scenario: Component emits events
- **WHEN** a user interaction is simulated on a Vue component (e.g., clicking a close button)
- **THEN** the component SHALL emit the expected event (e.g., `close`) verifiable via `wrapper.emitted()`

#### Scenario: Composable logic tested in isolation
- **WHEN** a composable (e.g., `useBackground()`) is tested directly
- **THEN** it SHALL be testable by calling the composable function and asserting on its returned reactive refs and methods
