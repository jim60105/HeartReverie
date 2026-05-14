# settings-form-widget-registry

## Purpose

Defines the schema-driven plugin settings form renderer: a per-mount widget registry, the recursive `<SchemaField>` component, and dynamic option fetching for select-family widgets. Phase 1 deliberately excludes plugin-supplied widgets — the registry is owned exclusively by the core.

## Requirements

### Requirement: Widget registry factory and resolution

The frontend SHALL provide a `WidgetRegistry` class and a `createDefaultWidgetRegistry()` factory function that populates a fresh registry instance with the built-in widget set. The factory MUST return a new instance on each call; the system SHALL NOT use a module-level singleton.

The registry SHALL implement `resolve(schema): WidgetDescriptor` using priority-based matching. Each widget descriptor MUST expose a `match(schema): number` predicate where `0` means "no match" and positive values indicate match priority. `resolve()` SHALL return the descriptor with the highest non-zero priority, falling back to a built-in text widget when no widget matches.

`PluginSettingsPage.vue` SHALL invoke `createDefaultWidgetRegistry()` once during its `setup` phase and `provide()` the resulting registry to its `<SchemaField>` subtree via a typed `FormContext` injection key.

#### Scenario: Default registry contains the phase-1 widget set

- **WHEN** a caller invokes `createDefaultWidgetRegistry()`
- **THEN** the returned registry SHALL contain descriptors for at least: `select`, `multi-select`, `tags`, `repeater`, `object-fieldset`, `color`, `masked-secret`, `range-number`, `path-picker`, `checkbox`, `combobox`, and a fallback `text` widget

#### Scenario: Resolution prefers the highest-priority match

- **GIVEN** the registry contains a `select` widget with `match` returning `30` for schemas with `enum`
- **AND** a `multi-select` widget with `match` returning `60` for schemas with `type=array` and `items.enum`
- **WHEN** the registry resolves a schema declaring both `type=array` and `items.enum`
- **THEN** the registry SHALL return the `multi-select` descriptor

#### Scenario: Resolution falls back to text widget on no match

- **WHEN** the registry resolves a schema for which no descriptor's `match` returns a positive number
- **THEN** the registry SHALL return the built-in fallback `text` widget descriptor

#### Scenario: Each settings page mount uses its own registry instance

- **WHEN** `PluginSettingsPage.vue` mounts twice (e.g., navigation away and back)
- **THEN** each mount SHALL call `createDefaultWidgetRegistry()` and own its own registry instance

### Requirement: Phase-1 prohibition on plugin-supplied widgets

Phase 1 SHALL NOT expose any mechanism for plugins to register widgets in the registry. The frontend `register(hooks)` context shape SHALL NOT gain a widget-registration method in phase 1. Adding plugin-supplied widgets requires a separate `plugin-core` capability delta in a future change.

#### Scenario: Plugin frontend register context omits widget registration

- **WHEN** a frontend plugin module exports `register(context)`
- **THEN** `context` SHALL NOT contain a `registerWidget`, `addWidget`, or equivalent method in phase 1

### Requirement: Recursive `<SchemaField>` form renderer

The frontend SHALL provide a `<SchemaField>` Vue single-file component that accepts `{ schema, path, modelValue, errors, context }` props, emits `update:modelValue`, and renders the resolved widget component. `object-fieldset` and `repeater` widgets SHALL each render `<SchemaField>` recursively for their children so the renderer composes to arbitrary nesting depth.

The `path` prop SHALL use JSON-Pointer-shaped strings (`items[2].notifyTitle`). The `errors` prop SHALL contain only the errors filtered to `path` or its descendants.

#### Scenario: Nested object schema renders nested fieldsets

- **GIVEN** a schema of the form `{ type: object, properties: { outer: { type: object, properties: { inner: { type: string } } } } }`
- **WHEN** `<SchemaField>` renders with this schema at path `""`
- **THEN** the output SHALL contain a fieldset for `outer` whose body contains a fieldset for `outer.inner`

#### Scenario: Array of object renders repeater that recursively expands each row

- **GIVEN** a schema of the form `{ type: array, items: { type: object, properties: { title: { type: string } } } }` with a model value of two items
- **WHEN** `<SchemaField>` renders with this schema
- **THEN** the output SHALL contain two collapsible rows, each containing a recursive `<SchemaField>` for `items[i].title`

#### Scenario: Errors are scoped to the field's own path

- **GIVEN** validation errors `[ { path: "outer.inner", ... }, { path: "other", ... } ]`
- **WHEN** `<SchemaField>` renders the `outer.inner` field
- **THEN** that field's error list SHALL contain only the first error

### Requirement: `x-options-url` dynamic option fetching

The `select`, `multi-select`, and `combobox` widgets SHALL honour an `x-options-url` keyword on the underlying schema (or on `schema.items` for array types). When present, the widget SHALL fetch the URL at mount time with the passphrase header, expect a JSON response of `{ options: Array<{ value: string, label: string }> }`, and use that list as the available options.

A failed fetch SHALL display an inline error inside the widget and fall back to the schema's `enum` list when one is declared. The widget SHALL NOT block the form from rendering.

#### Scenario: Select widget fetches dynamic options

- **GIVEN** a schema property declares `enum: []` and `x-options-url: "/api/plugins/foo/proxy/models"`
- **WHEN** the `select` widget mounts
- **THEN** the widget SHALL issue a `GET` to that URL with the passphrase header
- **AND** populate its options from the response's `options` array

#### Scenario: Failed fetch falls back to declared enum

- **GIVEN** a property declares both `enum: ["a","b"]` and an `x-options-url` whose fetch fails
- **WHEN** the widget renders
- **THEN** the widget SHALL display an inline error
- **AND** still expose `"a"` and `"b"` as selectable options
