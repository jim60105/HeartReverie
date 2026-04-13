## MODIFIED Requirements

### Requirement: Directory Structure Organization
The system SHALL organize lore passages in a three-level scope hierarchy using `_lore/` subdirectories co-located with story data. Global lore resides at `playground/_lore/`, series lore at `playground/<series>/_lore/`, and story lore at `playground/<series>/<story>/_lore/`, each containing `.md` files as storage units.

#### Scenario: Global scope passage storage
- **WHEN** a passage is created for global scope
- **THEN** it MUST be stored in `playground/_lore/` or its subdirectories as a `.md` file

#### Scenario: Series and story scope passage storage
- **WHEN** a passage is created for series "fantasy-realm" and story "dragon-quest"
- **THEN** it MUST be stored in `playground/fantasy-realm/dragon-quest/_lore/` or its subdirectories as a `.md` file

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

## ADDED Requirements

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
