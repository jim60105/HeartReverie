## ADDED Requirements

### Requirement: Single responsibility modules
The writer backend SHALL be decomposed into focused modules where each module has a single responsibility: configuration, error handling, template processing, story/chapter I/O, middleware, and route handlers.

#### Scenario: Module isolation
- **WHEN** a developer reads any single module file
- **THEN** it has one clear purpose identifiable from its filename and exports

### Requirement: Route handler extraction
All API route handlers SHALL be extracted from `server.js` into separate route module files grouped by domain (auth, stories, chapters, chat, plugins, prompt).

#### Scenario: Route file structure
- **WHEN** the developer inspects the `writer/routes/` directory
- **THEN** each file contains route handlers for a single API domain

### Requirement: Shared error response helper
A shared `problemJson()` helper SHALL replace all inline RFC 9457 Problem Details response construction throughout the codebase.

#### Scenario: Error response consistency
- **WHEN** any route handler returns an error response
- **THEN** it uses the `problemJson()` helper, producing consistent `type`, `title`, `status`, `detail` fields

### Requirement: Dead code removal
Unused imports and constants (`execFile`, `promisify`, `execFileAsync`, `APPLY_PATCHES_BIN`) SHALL be removed from the codebase.

#### Scenario: No unused declarations
- **WHEN** the codebase is inspected
- **THEN** no function, import, or constant is declared but never referenced

### Requirement: Dependency injection for testability
Route handlers and business logic functions SHALL receive their dependencies (pluginManager, ventoEnv, config) via parameters or factory functions rather than importing global singletons.

#### Scenario: Route handler with injected dependencies
- **WHEN** a route handler is tested
- **THEN** its dependencies can be replaced with test doubles without modifying module-level state

### Requirement: App factory pattern
The Express/Hono application SHALL be created by a factory function (`createApp()`) that accepts configuration and dependencies, enabling test instances with mocked dependencies.

#### Scenario: Test app creation
- **WHEN** `createApp()` is called with mock dependencies
- **THEN** it returns a functional app instance that can be used in integration tests
