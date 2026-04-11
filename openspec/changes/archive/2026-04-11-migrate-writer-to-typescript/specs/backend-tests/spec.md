# backend-tests

## MODIFIED Requirements

### Requirement: Utility function tests

Unit tests SHALL cover all pure utility functions: `isValidParam()`, `safePath()`, `validateTemplate()`, `levenshtein()`, `findClosestMatch()`, `stripPromptTags()`, `escapeRegex()`, `isValidPluginName()`, `isPathContained()`. Test files SHALL use the `_test.ts` suffix and be written in TypeScript. Mock objects used in tests SHALL satisfy the corresponding TypeScript interfaces they represent.

#### Scenario: Path traversal rejection
- **WHEN** `isValidParam()` receives a string containing `..` or null bytes
- **THEN** it returns `false`

#### Scenario: Template validation accepts safe expressions
- **WHEN** `validateTemplate()` receives a template with only simple variables, for-of loops, if/else, and pipe filters
- **THEN** it returns no errors

#### Scenario: Template validation rejects unsafe expressions
- **WHEN** `validateTemplate()` receives a template with function calls, property access, or `process.env`
- **THEN** it returns an error describing the rejected expression

### Requirement: Type checking in tests

Test files SHALL pass `deno check` without type errors. Mock objects SHALL conform to the interfaces they mock (e.g., `AppDeps`, `PluginManifest`, `HookDispatcher`). Tests SHALL NOT use `as any` to bypass type checking on mock objects.

#### Scenario: Test files pass type checking
- **WHEN** a developer runs `deno check` on all test files under `writer/`
- **THEN** all `_test.ts` files SHALL pass type checking without errors

#### Scenario: Type-safe mock objects
- **WHEN** a test creates a mock object for a dependency (e.g., a mock `AppDeps` for route handler tests)
- **THEN** the mock SHALL satisfy the corresponding TypeScript interface, and any missing or incorrectly typed property SHALL produce a compile-time error
