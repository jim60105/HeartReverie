# Plugin Hooks — Delta Spec (vue-typescript-refactor)

## MODIFIED Requirements

### Requirement: Handler registration

Plugins SHALL register hook handlers via `hooks.register(stage, handler, priority?)` where `stage` is a valid frontend hook stage name, `handler` is a synchronous function, and `priority` is an optional numeric value defaulting to `100`. The `FrontendHookDispatcher` only supports the `frontend-render` stage; `register()` SHALL validate that the stage name is `frontend-render` and SHALL log a warning and skip registration for unknown stage names. The `FrontendHookDispatcher` class SHALL be preserved as a TypeScript class (NOT converted to a Vue composable) for backward compatibility with existing plugin `frontend.js` modules that call `register(frontendHooks)`. The class API (`register`, `dispatch`) SHALL remain identical in signature and behavior.

#### Scenario: Register a handler with explicit priority
- **WHEN** a plugin calls `hooks.register('frontend-render', myHandler, 50)`
- **THEN** the hook system SHALL register `myHandler` for the `frontend-render` stage with priority 50

#### Scenario: Register a handler with default priority
- **WHEN** a plugin calls `hooks.register('frontend-render', myHandler)`
- **THEN** the hook system SHALL register `myHandler` for the `frontend-render` stage with the default priority of 100

#### Scenario: Register handler for invalid stage
- **WHEN** a plugin calls `hooks.register('invalid-stage', myHandler)`
- **THEN** the hook system SHALL log a warning identifying the invalid stage name and SHALL NOT register the handler

#### Scenario: Handler is called synchronously
- **WHEN** `dispatch('frontend-render', context)` invokes registered handlers
- **THEN** each handler SHALL be called synchronously in priority order; handlers are NOT awaited

#### Scenario: Existing plugin frontend.js modules remain compatible
- **WHEN** an existing plugin's `frontend.js` module calls `register(frontendHooks)` where `frontendHooks` is a `FrontendHookDispatcher` instance
- **THEN** the call SHALL succeed with the same API surface as the vanilla JS implementation, because the class is preserved as-is (not converted to a composable)

### Requirement: Handler execution

For each `dispatch(stage, context)` invocation, the `FrontendHookDispatcher` SHALL execute all registered handlers synchronously in priority order. `frontend-render` handlers SHALL receive a mutable context object with the following exact shape:
- `context.text` (`string`, mutable) — the raw markdown text being processed; handlers replace extracted blocks with placeholder comments and write the modified text back to this property
- `context.placeholderMap` (`Map<string, string>`, mutable) — a map from placeholder comment strings (e.g., `<!--STATUS_BLOCK_0-->`) to rendered HTML strings; handlers add entries to this map for each extracted block
- `context.options` (`object`) — rendering options passed from the caller (e.g., `{ isLastChapter: boolean }`)

Handlers mutate `context.text` and `context.placeholderMap` directly — the dispatcher does NOT create copies or merge return values. If a handler throws, the error SHALL be caught and logged, and execution SHALL continue with the next handler. The `dispatch()` method SHALL return the context object. All handler signatures and context object shapes SHALL have TypeScript type definitions.

#### Scenario: Frontend-render handler extracts and renders a tag
- **WHEN** a `frontend-render` handler (e.g., the `options` plugin at priority 50) is invoked with a context containing `<options>` blocks in `context.text`
- **THEN** the handler SHALL replace each `<options>` block in `context.text` with a placeholder comment and add a corresponding `placeholder → renderedHTML` entry to `context.placeholderMap`

#### Scenario: Handler error does not halt dispatch
- **WHEN** handler A (priority 50) throws an error and handler B (priority 100) is also registered for `frontend-render`
- **THEN** the dispatcher SHALL log the error from handler A and proceed to execute handler B

## ADDED Requirements

### Requirement: TypeScript type definitions for hooks

The `FrontendHookDispatcher` class SHALL have TypeScript type definitions for all handler signatures and context shapes. A `FrontendHookHandler<T>` generic type SHALL define the handler function signature as `(context: T) => void`. A `FrontendRenderContext` interface SHALL be defined with the following properties matching the current runtime contract:
- `text: string` — the raw markdown text (mutable by handlers)
- `placeholderMap: Map<string, string>` — placeholder → rendered HTML mapping (mutable by handlers)
- `options: Record<string, unknown>` — rendering options from the caller

The interface SHALL NOT introduce new methods such as `registerExtractor` or `registerRenderer` — handlers mutate context properties directly, preserving the existing plugin contract. These types SHALL be exported so plugin authors can use them for type-safe handler implementations.

#### Scenario: Handler type definitions are available
- **WHEN** a TypeScript plugin module imports hook types from the frontend hook system
- **THEN** it SHALL have access to `FrontendHookHandler<T>`, `FrontendRenderContext`, and related interfaces for compile-time type checking

#### Scenario: FrontendRenderContext matches runtime contract
- **WHEN** an existing plugin's `frontend-render` handler mutates `context.text` and `context.placeholderMap`
- **THEN** the `FrontendRenderContext` type SHALL accept these mutations without type errors, because both properties are typed as mutable (not `readonly`)

#### Scenario: FrontendHookDispatcher typed methods
- **WHEN** the `FrontendHookDispatcher` class is used in TypeScript code
- **THEN** `register(stage, handler, priority?)` SHALL be typed to accept only valid stage names and correctly-typed handler functions, and `dispatch(stage, context)` SHALL be typed to require the correct context shape for each stage
