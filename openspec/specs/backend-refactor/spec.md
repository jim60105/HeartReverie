# Backend Refactor

## Purpose

Decomposition of the writer backend into focused, single-responsibility modules with dependency injection for testability.

## Requirements

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

### Requirement: Library modules SHALL NOT import from route modules

Modules under `writer/lib/` SHALL NOT import from `writer/routes/`. The dependency direction SHALL be unidirectional: route modules depend on library modules, never the reverse. Specifically, the `readTemplate` prompt-file read-with-fallback helper consumed by `writer/lib/chat-shared.ts` SHALL reside in a library module and be imported from `writer/lib/`, not from `writer/routes/prompt.ts`.

#### Scenario: No lib-to-routes imports remain

- **WHEN** the codebase is searched with `grep -rn 'from "../routes/' writer/lib/`
- **THEN** zero matches SHALL be returned

#### Scenario: chat-shared imports readTemplate from lib

- **WHEN** `writer/lib/chat-shared.ts` is inspected for its `readTemplate` import
- **THEN** it SHALL import `readTemplate` from `./prompt-file.ts` (a `writer/lib/` module) and SHALL NOT import it from `../routes/prompt.ts`

#### Scenario: Core chat unit tests do not transitively pull a route module

- **WHEN** a unit test exercises the chat core via `writer/lib/chat-shared.ts`
- **THEN** the module graph it imports SHALL NOT include `writer/routes/prompt.ts` solely to obtain `readTemplate`

### Requirement: Per-app transient state stored in a typed WeakMap keyed by the app instance

Transient per-app state in the backend (such as the list of pending async plugin route registrations) SHALL be stored in a typed module-level `WeakMap` keyed by the app instance, rather than smuggled as an ad-hoc property on the framework (Hono) object via casts. This keeps the framework object's shape unmodified, makes the state statically typed, isolates state between concurrently-created app instances, and lets the state be garbage-collected with its app.

#### Scenario: Pending plugin inits use the WeakMap pattern

- **WHEN** `createApp()` records an async plugin route registration to await later
- **THEN** it SHALL store the promise in a module-level `WeakMap<Hono, Promise<unknown>[]>` keyed by the app instance, not as a property assigned onto the Hono app object

#### Scenario: Framework object shape is not augmented

- **WHEN** the Hono app instance produced by `createApp()` is inspected
- **THEN** it SHALL NOT carry an ad-hoc `_pendingPluginInits` (or similar) property added solely to track transient registration state

#### Scenario: Future per-app state extends the same WeakMap

- **WHEN** a future feature needs additional per-app transient state
- **THEN** it SHALL extend the existing WeakMap value into a small record rather than introducing a second parallel WeakMap or reintroducing property smuggling

### Requirement: Chapter-file listing is centralized in the canonical helper

Listing a story's chapter files (filtering directory entries to `NNN.md` names via `/^\d+\.md$/` and sorting them in ascending numeric order) SHALL be performed through the canonical `listChapterFiles()` helper in `writer/lib/story-chapter-io.ts`. The route layer SHALL NOT retain inline re-implementations of this listing. `writer/routes/ws-subscribe.ts` SHALL use `listChapterFiles()`, wrapped so that any thrown (non-NotFound) directory-read error preserves its existing early-return-with-`logWsError("dir-read", err)` behavior, since `listChapterFiles()` returns `[]` on `NotFound` and throws otherwise. `writer/routes/export.ts` SHALL use `listChapterFiles()` if and only if its inline listing has identical semantics (the same `\d+\.md` filter, numeric sort, and tolerate-missing-directory behavior); if export's listing differs semantically it SHALL be left unchanged and the divergence documented.

#### Scenario: ws-subscribe uses the canonical lister with preserved error handling
- **WHEN** the `ws-subscribe.ts` poll loop lists chapter files
- **THEN** it SHALL call `listChapterFiles()`, and a thrown directory-read error SHALL still trigger `logWsError("dir-read", err)` followed by an early return — preserving the prior behavior

#### Scenario: No inline chapter-listing regex remains in the converted routes
- **WHEN** the route layer is inspected for inline `/^\d+\.md$/` chapter listings after this change
- **THEN** `ws-subscribe.ts` SHALL contain none (and `export.ts` SHALL contain none if its semantics matched and it was converted)

#### Scenario: export.ts listing is left intact when semantics differ
- **WHEN** `export.ts`'s inline listing does not have identical semantics to `listChapterFiles()` (e.g. it includes non-numeric files or sorts differently)
- **THEN** `export.ts` SHALL be left unchanged and the reason SHALL be documented rather than silently altering export output
