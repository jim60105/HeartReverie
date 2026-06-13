## ADDED Requirements

### Requirement: No unsafe casts for pending plugin-init tracking in app.ts

`writer/app.ts` SHALL NOT use `as unknown as` casts or a smuggled `_pendingPluginInits` property to track pending async plugin route registrations. The pending registrations SHALL be stored in a statically-typed module-level `WeakMap<Hono, Promise<unknown>[]>`, so the compiler is not overruled at any touch point and no non-null assertion (`!`) is required to access the pending array.

#### Scenario: No as-unknown-as casts in app.ts

- **WHEN** `writer/app.ts` is searched with `grep -c "as unknown as"`
- **THEN** the count SHALL be 0

#### Scenario: No _pendingPluginInits property reference anywhere

- **WHEN** the codebase is searched with `grep -rn "_pendingPluginInits" writer/ tests/`
- **THEN** no matches SHALL be returned

#### Scenario: Type check passes after the change

- **WHEN** `deno check writer/server.ts` is run after the change
- **THEN** it SHALL exit 0 with the WeakMap-based tracking fully type-checked and no suppressed type errors
