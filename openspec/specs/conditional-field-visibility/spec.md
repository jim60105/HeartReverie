# conditional-field-visibility

## Purpose

Defines the `x-show-when` schema keyword: structural rules for declaring dependent-field visibility, the form renderer's evaluation semantics, and how hidden fields interact with the two-phase save scope.

## Requirements

### Requirement: `x-show-when` keyword grammar

A schema property MAY declare an `x-show-when` keyword. When present, the keyword MUST be an object of the shape `{ field: string, equals?: JSONValue, notEquals?: JSONValue, in?: JSONValue[] }`. Exactly one of `equals`, `notEquals`, or `in` MUST be specified. The `field` value MUST be a sibling property name within the same `properties` object (no dotted paths, no `$ref`).

The plugin manager SHALL reject a manifest at load time when:

- `x-show-when` is present but `field` does not reference a sibling property in the same object
- `x-show-when` is present but zero or more than one of `equals` / `notEquals` / `in` is set
- The same property is listed in the parent object's `required` array AND declares `x-show-when` (dead configuration)

The schema validator SHALL ignore `x-show-when` entirely; it is a UI-only keyword and contributes no validation errors.

#### Scenario: Valid `x-show-when` passes manifest load

- **GIVEN** a schema `{ properties: { mode: { type: string, enum: ["a", "b"] }, detail: { type: string, x-show-when: { field: "mode", equals: "b" } } } }`
- **WHEN** the plugin manager loads the manifest
- **THEN** the manager SHALL accept the manifest without error

#### Scenario: `field` referencing a non-sibling property is rejected

- **GIVEN** a schema where `x-show-when.field` names a property that does not exist among the siblings
- **WHEN** the plugin manager loads the manifest
- **THEN** the manager SHALL reject the manifest with an error identifying the offending property and the unknown `field` reference

#### Scenario: `required` overlap is rejected

- **GIVEN** an object schema where `required` contains `"foo"` AND `properties.foo` declares `x-show-when`
- **WHEN** the plugin manager loads the manifest
- **THEN** the manager SHALL reject the manifest with an error explaining that a hidden field cannot also be required

#### Scenario: Multiple comparison operators are rejected

- **GIVEN** a property whose `x-show-when` declares both `equals` and `in`
- **WHEN** the plugin manager loads the manifest
- **THEN** the manager SHALL reject the manifest

### Requirement: `x-show-when` UI evaluation semantics

The form renderer SHALL evaluate `x-show-when` at render time against the current in-memory form value of the referenced sibling. When the predicate evaluates to `false`, the field MUST NOT be rendered to the DOM.

The renderer SHALL retain the field's value in the form's model when it becomes hidden, so the value is restored if the predicate later evaluates to `true`. Toggling a parent value SHALL NOT clear or reset a hidden child's value.

#### Scenario: Hidden field retains its value when shown again

- **GIVEN** `detail` is shown and has value `"hello"`
- **WHEN** the user changes `mode` to a value that hides `detail`
- **AND** then changes `mode` back to a value that shows `detail`
- **THEN** `detail` SHALL be re-rendered with value `"hello"`

#### Scenario: Hidden field does not contribute UI validation errors

- **GIVEN** a field declares `x-show-when` AND a `pattern` it currently violates
- **WHEN** `x-show-when` evaluates to `false`
- **THEN** the form SHALL NOT display the pattern error for that field
- **AND** the save button SHALL NOT be blocked by that error

### Requirement: Hidden fields are excluded from save scope

When the form constructs the `_changedPaths` array for `PUT /settings`, it SHALL exclude any path whose nearest enclosing schema property currently evaluates `x-show-when` to `false`. The field's value remains in the request body (since the server is authoritative on validation), but its path SHALL NOT be in `_changedPaths`, so that any pre-existing or transitively-invalid value at that path remains a warning rather than a blocking error.

#### Scenario: Editing then hiding a conditional field does not block save of unrelated field

- **GIVEN** the user edits `detail` to an invalid value while `mode = "b"` (visible)
- **AND** the user then changes `mode` to `"a"` (hides `detail`)
- **AND** the user then edits `unrelated`
- **WHEN** the user saves
- **THEN** `_changedPaths` SHALL contain `"unrelated"` but NOT `"detail"`
- **AND** the server SHALL respond `200` with the invalid `detail` reported under `warnings`
