## ADDED Requirements

### Requirement: Schema-version authoring guidance

The skill SHALL instruct the agent to declare `x-schema-version: 1` at the top level of every `settingsSchema` it generates. Auto-migration is a backstop, not a target — generated manifests MUST be explicit.

#### Scenario: Scaffolded settingsSchema declares x-schema-version

- **WHEN** the skill scaffolds a `plugin.json` containing `settingsSchema`
- **THEN** the schema object SHALL include `"x-schema-version": 1` at the top level

### Requirement: Extended-keyword authoring guidance

The skill SHALL document and use the extended keyword set when scaffolding `settingsSchema`:

- Use `enum` for single-choice; use `type: array, items: { enum: [...] }` for multi-choice; use `type: array, items: { type: string }` for free-form tags.
- Use `pattern`, `format` (whitelist: `path`, `color`, `url`, `email`, `uuid`), `writeOnly` (for secrets), and `minimum`/`maximum` (with `multipleOf`) when modeling constrained inputs.
- Use `type: object` with `properties` for grouped settings; the form renders these as collapsible fieldsets.
- Use `type: array, items: { type: object, ... }` for repeatable rows; the form renders these as repeaters.

#### Scenario: Skill documents the format whitelist

- **WHEN** an agent consults the skill's references on schema authoring
- **THEN** the references SHALL list the supported `format` values (`path`, `color`, `url`, `email`, `uuid`) and state that other values are silently ignored by the validator

#### Scenario: Skill recommends writeOnly for secrets

- **WHEN** the skill scaffolds a manifest containing a credential or API-key field
- **THEN** the generated schema SHALL declare `writeOnly: true` on that field

### Requirement: `x-show-when` authoring guidance and mutual-exclusion rule

The skill SHALL instruct the agent that `x-show-when` is UI-only, that `field` MUST reference a sibling property in the same object, and that a property declaring `x-show-when` MUST NOT also appear in the parent's `required` array.

#### Scenario: Skill rejects required + x-show-when in scaffolded schemas

- **WHEN** an agent describes a conditional optional field
- **THEN** the skill SHALL place the field in a non-required slot AND apply `x-show-when` (never both `required` and `x-show-when`)

### Requirement: `x-path-roots` authoring guidance

The skill SHALL document the hard-coded path root allowlist (`playground/lore/`, `playground/chapters/`, `playground/_plugins/<pluginName>/`) and instruct the agent that `x-path-roots` may only narrow this set, never widen it. The skill SHALL warn that an empty intersection causes manifest rejection at load time.

#### Scenario: Plugin's own sandbox is the default narrowing

- **WHEN** a plugin needs to store paths only within its own sandbox
- **THEN** the skill SHALL emit `x-path-roots: ["playground/_plugins/<pluginName>/"]` rather than relying on the implicit hard-coded set

### Requirement: Plain-text description policy

The skill SHALL author all `description` strings as plain text (no Markdown, no HTML). The skill SHALL NOT emit any `x-description-md`-style alternative keyword.

#### Scenario: Skill emits plain-text descriptions

- **WHEN** the skill scaffolds a property with a multi-sentence explanation
- **THEN** the `description` SHALL be plain prose without Markdown emphasis, links, lists, or code spans
