## MODIFIED Requirements

### Requirement: Scope Collection
The lore retrieval engine SHALL collect passages from all applicable scopes when rendering a prompt for a given series and story context. Each scope directory is scanned for `.md` files at the root level and in immediate tag subdirectories, but **child scope directories are excluded** from the parent scope's scan to prevent double-counting.

#### Scenario: Series and Story Context
- **WHEN** rendering a prompt for series "fantasy" and story "chapter-1"
- **THEN** the engine SHALL collect passages from:
  - `playground/_lore/` and its tag subdirectories
  - `playground/fantasy/_lore/` and its tag subdirectories
  - `playground/fantasy/chapter-1/_lore/` and its tag subdirectories

#### Scenario: No Double-Counting Across Scopes
- **WHEN** rendering a prompt for series "fantasy" and story "chapter-1" where `playground/fantasy/chapter-1/_lore/notes.md` exists
- **THEN** the passage `notes.md` SHALL appear exactly once in the collected pool (from the story scope only, since each scope resolves to a separate `_lore/` directory under its parent)

### Requirement: Effective Tag Computation
The lore retrieval engine SHALL compute effective tags for each passage as the union of explicit frontmatter tags, directory-implicit tags, and filename-implicit tags. The directory tag MUST be derived from the immediate parent subdirectory name (excluding scope root directories). The filename tag MUST be derived from the `.md` file stem after normalization.

#### Scenario: Directory and Filename Tag Assignment
- **WHEN** processing `playground/_lore/characters/alice.md` with frontmatter `tags: [protagonist]`
- **THEN** the effective tags SHALL be `["protagonist", "characters", "alice"]` (frontmatter + directory + filename)

#### Scenario: No Directory Tag for Scope Root
- **WHEN** processing `playground/fantasy/_lore/overview.md` with frontmatter `tags: [worldbuilding]`
- **THEN** the effective tags SHALL be `["worldbuilding", "overview"]` (no directory tag since the file is at the scope root; filename tag "overview" is added)

#### Scenario: Filename tag deduplication
- **WHEN** processing `playground/_lore/characters/characters.md` with frontmatter `tags: [npc]`
- **THEN** the effective tags SHALL be `["npc", "characters"]` (directory and filename both produce "characters", deduplicated to one)
