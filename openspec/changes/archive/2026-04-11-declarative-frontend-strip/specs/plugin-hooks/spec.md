# Plugin Hooks

## MODIFIED Requirements

### Requirement: Hook stages

The system SHALL support these backend hook stages:
- `prompt-assembly`: Runs during prompt assembly, allowing plugins to modify the prompt context
- `response-stream`: Runs during response streaming, allowing plugins to process chunks
- `post-response`: Runs after the full response is received, allowing plugins to perform post-processing
- `strip-tags`: Runs during tag stripping, allowing plugins to modify the stripping behavior
- `pre-write`: Runs before the response text is written to the chapter file, allowing plugins to inject or modify content

The system SHALL support this frontend hook stage:
- `frontend-render`: Runs during frontend rendering, allowing plugins to transform XML blocks into HTML components for display

The `frontend-strip` stage SHALL NOT exist. Frontend tag stripping SHALL be handled declaratively via the `displayStripTags` manifest field, not through hook handlers.

#### Scenario: Backend hook registration
- **WHEN** a plugin registers a handler for `prompt-assembly`, `response-stream`, `post-response`, `strip-tags`, or `pre-write`
- **THEN** the HookDispatcher SHALL accept and register the handler for that stage

#### Scenario: Frontend render hook registration
- **WHEN** a frontend plugin registers a handler for `frontend-render`
- **THEN** the FrontendHookDispatcher SHALL accept and register the handler

#### Scenario: Invalid hook stage registration rejected
- **WHEN** a plugin attempts to register a handler for an unrecognized stage name (including `frontend-strip`)
- **THEN** the dispatcher SHALL log a warning and skip the registration

### Requirement: Handler execution order

Hook handlers SHALL be executed in priority order (lowest number first). Handlers with the same priority SHALL be executed in plugin registration order. Each handler SHALL receive a context object relevant to the hook stage.

#### Scenario: Priority-ordered execution
- **WHEN** plugin A registers a `post-response` handler at priority 10 and plugin B registers at priority 20
- **THEN** plugin A's handler SHALL execute before plugin B's handler

#### Scenario: Same-priority execution
- **WHEN** plugin A and plugin B both register `post-response` handlers at priority 10
- **THEN** handlers SHALL execute in the order plugins were registered (discovery order)

### Requirement: Frontend hook dispatch

The `FrontendHookDispatcher` SHALL support only the `frontend-render` stage. Dispatch calls SHALL iterate handlers in priority order, passing the context object. The dispatcher SHALL NOT support `frontend-strip` as a valid stage.

#### Scenario: Frontend render dispatch
- **WHEN** `dispatch('frontend-render', context)` is called
- **THEN** all registered `frontend-render` handlers SHALL be invoked in priority order with the context

#### Scenario: Frontend-strip stage removed
- **WHEN** code attempts to dispatch `frontend-strip`
- **THEN** the dispatcher SHALL not execute any handlers (no handlers can be registered for that stage)
