## ADDED Requirements

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
