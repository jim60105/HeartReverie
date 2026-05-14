# Plugin Creation Skill

## Purpose

TBD — Specification for the plugin creation skill that guides agents through scaffolding new plugins for the MD Story Tools plugin system.

## Requirements

### Requirement: Skill directory structure
The skill SHALL be located at `.agents/skills/heartreverie-create-plugin/` and contain:
- `SKILL.md` — main skill file with YAML frontmatter and workflow instructions (under 500 lines)
- `references/manifest-schema.md` — complete `plugin.json` field definitions
- `references/hook-api.md` — backend and frontend hook stage documentation

#### Scenario: Skill file exists with correct frontmatter
- **WHEN** an agent reads `.agents/skills/heartreverie-create-plugin/SKILL.md`
- **THEN** the file SHALL contain YAML frontmatter with `name: heartreverie-create-plugin` and a `description` field that includes trigger phrases such as "create a plugin", "new plugin", "scaffold plugin", and "add a plugin"

#### Scenario: Reference files exist
- **WHEN** an agent needs detailed manifest or hook information during plugin creation
- **THEN** `references/manifest-schema.md` and `references/hook-api.md` SHALL exist and be referenced from SKILL.md with clear guidance on when to read them

### Requirement: Plugin type selection
The skill SHALL guide the agent to determine the appropriate plugin type based on the user's description.

#### Scenario: Prompt-only plugin detected
- **WHEN** the user describes a plugin that only provides prompt instructions (no backend logic, no frontend rendering)
- **THEN** the skill SHALL select type `prompt-only` and skip backend module and frontend module scaffolding

#### Scenario: Full-stack plugin detected
- **WHEN** the user describes a plugin requiring prompt fragments, backend processing, and frontend rendering
- **THEN** the skill SHALL select type `full-stack` and scaffold all three layers

#### Scenario: Ambiguous type
- **WHEN** the plugin type cannot be confidently determined from the description
- **THEN** the skill SHALL ask the user to choose from the four types: `prompt-only`, `full-stack`, `hook-only`, `frontend-only`

### Requirement: Manifest generation
The skill SHALL generate a complete, valid `plugin.json` manifest for the chosen plugin type.

#### Scenario: Required fields present
- **WHEN** generating `plugin.json`
- **THEN** the manifest SHALL include `name`, `version` (defaulting to `"1.0.0"`), `description`, and `type`

#### Scenario: Name matches directory
- **WHEN** generating the manifest
- **THEN** the `name` field SHALL exactly match the plugin directory name

#### Scenario: Prompt fragments declared
- **WHEN** the plugin type includes prompt fragments (`prompt-only` or `full-stack`)
- **THEN** the manifest SHALL include a `promptFragments` array with correct `file`, `variable`, and `priority` fields

#### Scenario: Backend module declared
- **WHEN** the plugin type includes backend logic (`full-stack` or `hook-only`)
- **THEN** the manifest SHALL include a `backendModule` field pointing to the handler file

#### Scenario: Frontend module declared
- **WHEN** the plugin type includes frontend rendering (`full-stack` or `frontend-only`)
- **THEN** the manifest SHALL include a `frontendModule` field pointing to the frontend file

### Requirement: Tag strip configuration
The skill SHALL correctly configure tag stripping when the plugin defines custom XML tags.

#### Scenario: Plain text tag stripping
- **WHEN** the plugin uses simple XML tags without attributes (e.g., `<mytag>`)
- **THEN** `promptStripTags` and/or `displayStripTags` SHALL use plain tag name strings

#### Scenario: Regex tag stripping
- **WHEN** the plugin uses XML tags with variant attributes (e.g., `<mytag type="...">`)
- **THEN** the skill SHALL generate regex patterns in `/pattern/flags` format with proper escaping

#### Scenario: Tags field consistency
- **WHEN** configuring tag stripping
- **THEN** the `tags` array SHALL list all XML tag names managed by the plugin, and strip patterns SHALL be consistent with the declared tags

### Requirement: Backend hook module scaffolding
The skill SHALL generate correct backend hook modules when the plugin type requires it.

#### Scenario: Register function exported
- **WHEN** generating a backend module
- **THEN** the file SHALL export a `register(hookDispatcher)` function that registers handlers for the appropriate lifecycle stages

#### Scenario: Hook stages documented
- **WHEN** the agent needs to choose which hook stage to use
- **THEN** the skill SHALL direct the agent to read `references/hook-api.md` for the three active stages (`prompt-assembly`, `pre-write`, `post-response`) and their context parameters

### Requirement: Frontend module scaffolding
The skill SHALL generate correct frontend modules when the plugin type requires it.

#### Scenario: Frontend register function
- **WHEN** generating a frontend module
- **THEN** the file SHALL export a `register(hooks)` function using vanilla ES module syntax (no build step, no framework)

#### Scenario: Frontend-render hook
- **WHEN** the plugin needs custom tag rendering in the browser
- **THEN** the frontend module SHALL register a `frontend-render` hook handler

### Requirement: Prompt fragment file creation
The skill SHALL generate Markdown prompt fragment files when the plugin includes prompt injection.

#### Scenario: Fragment file with variable reference
- **WHEN** creating a prompt fragment file
- **THEN** the file SHALL contain the prompt content and the skill SHALL remind the user to add `{{ variable_name }}` to `system.md`

#### Scenario: Priority guidance
- **WHEN** setting fragment priority
- **THEN** the skill SHALL explain the priority system (lower = earlier in prompt) and reference existing plugin priorities (10 for start, 100 for normal, 800-900 for reinforcement/end)

### Requirement: README generation
The skill SHALL generate a README.md in Traditional Chinese for the new plugin.

#### Scenario: README follows project conventions
- **WHEN** generating README.md
- **THEN** the file SHALL be written in zh-TW with full-width punctuation, spaces between Chinese and alphanumeric characters, and include sections for overview, manifest fields, file descriptions, and usage notes

### Requirement: Progressive disclosure
The skill SHALL use progressive disclosure to minimize context window usage.

#### Scenario: Simple plugin skips hook references
- **WHEN** creating a `prompt-only` plugin
- **THEN** the skill SHALL NOT instruct the agent to read `references/hook-api.md`

#### Scenario: Complex plugin loads references
- **WHEN** creating a `full-stack` or `hook-only` plugin
- **THEN** the skill SHALL instruct the agent to read `references/hook-api.md` for hook stage details

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
