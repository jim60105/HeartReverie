# Lore Storage System

## Purpose

The lore storage system provides file-based storage structure for the Lore Codex, supporting passages organized by scope (global, series, story) with YAML frontmatter metadata and directory-based tagging.
## Requirements
### Requirement: Directory Structure Organization
The system SHALL organize lore passages in a three-level scope hierarchy using `_lore/` subdirectories co-located with story data. Global lore resides at `playground/_lore/`, series lore at `playground/<series>/_lore/`, and story lore at `playground/<series>/<story>/_lore/`, each containing `.md` files as storage units.

#### Scenario: Global scope passage storage
- **WHEN** a passage is created for global scope
- **THEN** it MUST be stored in `playground/_lore/` or its subdirectories as a `.md` file

#### Scenario: Series and story scope passage storage
- **WHEN** a passage is created for series "fantasy-realm" and story "dragon-quest"
- **THEN** it MUST be stored in `playground/fantasy-realm/dragon-quest/_lore/` or its subdirectories as a `.md` file

### Requirement: Passage File Format Structure
Passages SHALL use Markdown format with optional YAML frontmatter containing metadata fields.

#### Scenario: Passage with complete frontmatter
- **WHEN** a passage file contains YAML frontmatter with tags, priority, and enabled fields
- **THEN** the system MUST parse the frontmatter and use the specified values

#### Scenario: Passage without frontmatter
- **WHEN** a passage file contains only Markdown content with no frontmatter
- **THEN** the system MUST treat it as valid with default values (tags: [], priority: 0, enabled: true)

### Requirement: Frontmatter Schema Validation
The system SHALL validate frontmatter fields and apply graceful defaults for invalid or missing data.

#### Scenario: Valid frontmatter field types
- **WHEN** frontmatter contains `tags: [npc, tavern]`, `priority: 100`, `enabled: true`
- **THEN** the system MUST accept these values as-is

#### Scenario: Invalid frontmatter field types
- **WHEN** frontmatter contains `tags: "invalid"`, `priority: "high"`, `enabled: "yes"`
- **THEN** the system MUST default to `tags: []`, `priority: 0`, `enabled: true`

### Requirement: Directory-Based Implicit Tagging
The **immediate parent** subdirectory within a scope root SHALL automatically provide a single implicit tag to contained passages. Only the direct parent directory name is used; nested ancestor directories do NOT contribute additional tags.

#### Scenario: Passage in characters subdirectory
- **WHEN** a passage is stored in `playground/_lore/characters/alice.md`
- **THEN** the passage MUST receive an implicit tag "characters" in addition to any explicit frontmatter tags

#### Scenario: Passage directly in scope root
- **WHEN** a passage is stored in `playground/_lore/rules.md` (directly in the scope root, not in a subdirectory)
- **THEN** the passage MUST NOT receive any implicit directory tag

### Requirement: Scope Identification by Location
The system SHALL determine passage scope based on the caller-provided scope context rather than inferring scope from the directory path structure. Each collection function already knows which scope it is scanning, so scope identification is explicit. Directory tag resolution SHALL work on scope-relative paths (paths relative to the `_lore/` directory), eliminating per-scope depth constants.

#### Scenario: Global scope identification
- **WHEN** a passage is collected from the `playground/_lore/` directory tree
- **THEN** the system MUST identify it as global scope

#### Scenario: Story scope identification
- **WHEN** a passage is collected from the `playground/series-name/story-name/_lore/` directory tree
- **THEN** the system MUST identify it as story scope for series "series-name" and story "story-name"

### Requirement: Passage File Naming Convention
Passages SHALL use kebab-case `.md` filenames that serve as unique identifiers within their directory.

#### Scenario: Valid kebab-case filename
- **WHEN** a passage is named `old-tavern-keeper.md`
- **THEN** the system MUST accept it as a valid passage identifier

#### Scenario: Filename-based passage identification
- **WHEN** multiple passages exist in the same directory with names `alice.md` and `bob.md`
- **THEN** the system MUST treat them as distinct passages identified by "alice" and "bob" respectively

### Requirement: Filename-Based Implicit Tagging
The stem of each passage's `.md` filename (without the `.md` extension) SHALL be normalized via `normalizeTag()` and added as an implicit tag alongside frontmatter tags and directory-implicit tags.

#### Scenario: Filename provides additional tag
- **WHEN** a passage is stored as `playground/_lore/characters/hero.md` with frontmatter `tags: [protagonist]`
- **THEN** the effective tags MUST be `["protagonist", "characters", "hero"]` (frontmatter + directory + filename)

#### Scenario: Filename tag duplicates existing tag
- **WHEN** a passage is stored as `playground/_lore/characters/characters.md` with frontmatter `tags: []`
- **THEN** the effective tags MUST be `["characters"]` (deduplicated — directory and filename produce the same tag)

#### Scenario: Filename normalizes to empty or reserved
- **WHEN** a passage filename normalizes to an empty string (e.g., CJK-only filename like `英雄.md`) or a reserved name (`all.md`, `tags.md`)
- **THEN** the filename MUST NOT contribute an implicit tag (silently skipped)

#### Scenario: Filename at scope root without directory tag
- **WHEN** a passage is stored as `playground/_lore/world-rules.md` with frontmatter `tags: [rules]`
- **THEN** the effective tags MUST be `["rules", "world_rules"]` (frontmatter + filename; no directory tag since it is at scope root)

### Requirement: Global Lore Directory Preservation in Version Control
The `playground/_lore/` directory SHALL be preserved in version control using nested `.gitignore` files. The root `playground/.gitignore` SHALL ignore all content except `.gitignore` files and the `_lore/` directory. The `playground/_lore/.gitignore` SHALL ignore all content except itself. This ensures the directory structure exists in fresh clones without using `.gitkeep` files and without leaking user story data into the repository.

#### Scenario: Fresh clone includes global lore directory
- **WHEN** a developer clones the repository
- **THEN** the `playground/_lore/` directory MUST exist and be empty (except for its `.gitignore`)

#### Scenario: Story data remains untracked
- **WHEN** a user creates series directories and story files under `playground/`
- **THEN** git MUST NOT track any files under `playground/` except `.gitignore` files and the `_lore/` directory structure

### Requirement: Lore passages support lint and preview via lore: path

The lore storage layer SHALL be reachable from the templates route through three address forms:

- `lore:global:<rel>` resolving to `${PLAYGROUND_DIR}/_lore/<rel>`
- `lore:series:<series>:<rel>` resolving to `${PLAYGROUND_DIR}/<series>/_lore/<rel>`
- `lore:story:<series>:<story>:<rel>` resolving to `${PLAYGROUND_DIR}/<series>/<story>/_lore/<rel>`

The scope identifier (`global` / `series` / `story`) SHALL match the three scopes enumerated by `resolveLoreVariables()`. `<series>` and `<story>` segments SHALL reject `:`, `/`, `\`, NUL, `..`, a leading `_`, and the reserved name `lost+found`; other Unicode characters (e.g. CJK series names like `艾爾瑞亞`) ARE permitted because they round-trip through `Deno.readDir` and the existing playground tooling. `<rel>` SHALL be subject to `isPathContained` + `Deno.realPath` containment under the corresponding scope root and SHALL reject `..` traversal.

#### Scenario: Known scope and safe path resolves

- **GIVEN** `playground/demo/_lore/character/alice.md` exists
- **WHEN** the templates route resolves `templatePath: "lore:series:demo:character/alice.md"`
- **THEN** the resolved absolute path is `${PLAYGROUND_DIR}/demo/_lore/character/alice.md`

#### Scenario: Unknown scope is rejected

- **WHEN** the templates route receives `templatePath: "lore:bogus-scope:x.md"`
- **THEN** the response status is `400`
- **AND** the response body identifies the unknown scope

#### Scenario: Traversal is rejected

- **WHEN** the templates route receives `templatePath: "lore:series:demo:../../etc/passwd"`
- **THEN** the response status is `400`
- **AND** no file outside the lore directory is touched

### Requirement: Lore lint catalog uses first-pass snapshot variables only

The variable catalog used to check `vento.unknown-variable` for `lore:` template paths SHALL contain only `lore_*` (every tag from `resolveLoreVariables()`), `series_name`, and `story_name`. It SHALL NOT include `previous_context`, `user_input`, `isFirstRound`, `plugin_fragments`, any plugin-fragment-declared variable, or any plugin `parameters` entry. This matches the actual engine render order in which lore is rendered before any plugin fragment.

#### Scenario: Plugin variable in lore template flagged as unknown

- **GIVEN** a plugin declares fragment variable `think_before_reply`
- **WHEN** a lore passage source references `{{ think_before_reply }}`
- **AND** `POST /api/templates/lint` is invoked with `templatePath: "lore:series:demo:..."`
- **THEN** the diagnostic includes `vento.unknown-variable` for `think_before_reply`

#### Scenario: Lore tag variable is recognised

- **GIVEN** the resolved lore tags include `character` and `scenario`
- **WHEN** a lore passage source references `{{ lore_character }}`
- **THEN** no `vento.unknown-variable` diagnostic is emitted for `lore_character`

