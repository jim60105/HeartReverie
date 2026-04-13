# Lore Retrieval Specification

## ADDED Requirements

### Requirement: Scope Collection
The lore retrieval engine SHALL collect passages from all applicable scopes when rendering a prompt for a given series and story context. Each scope directory is scanned for `.md` files at the root level and in immediate tag subdirectories, but **child scope directories are excluded** from the parent scope's scan to prevent double-counting.

#### Scenario: Series and Story Context
- **WHEN** rendering a prompt for series "fantasy" and story "chapter-1"
- **THEN** the engine SHALL collect passages from:
  - `playground/lore/global/` and its tag subdirectories
  - `playground/lore/series/fantasy/` and its tag subdirectories
  - `playground/lore/story/fantasy/chapter-1/` and its tag subdirectories

#### Scenario: No Double-Counting Across Scopes
- **WHEN** rendering a prompt for series "fantasy" and story "chapter-1" where `playground/lore/story/fantasy/chapter-1/notes.md` exists
- **THEN** the passage `notes.md` SHALL appear exactly once in the collected pool (from the story scope only, since each scope is structurally separated by the `global/`, `series/`, `story/` prefixes)

### Requirement: Effective Tag Computation
The lore retrieval engine SHALL compute effective tags for each passage as the union of explicit frontmatter tags and directory-implicit tags. The directory tag MUST be derived from the immediate parent subdirectory name, excluding scope root directories.

#### Scenario: Directory Tag Assignment
- **WHEN** processing `playground/lore/global/characters/alice.md` with frontmatter `tags: [protagonist]`
- **THEN** the effective tags SHALL be `["characters", "protagonist"]`

#### Scenario: No Directory Tag for Scope Root
- **WHEN** processing `playground/lore/series/fantasy/overview.md` with frontmatter `tags: [worldbuilding]`
- **THEN** the effective tags SHALL be `["worldbuilding"]` (no directory tag added since "fantasy" is a scope root)

### Requirement: Tag-Based Filtering
The lore retrieval engine SHALL filter passages to include only those whose effective tags contain the specified tag. The filtering MUST use exact string matching for tag names.

#### Scenario: Single Tag Match
- **WHEN** filtering for tag "characters" across passages with effective tags `["characters", "protagonist"]`, `["locations"]`, and `["characters", "antagonist"]`
- **THEN** the engine SHALL return only the passages with effective tags `["characters", "protagonist"]` and `["characters", "antagonist"]`

#### Scenario: No Tag Matches
- **WHEN** filtering for tag "magic" across passages with effective tags `["characters"]`, `["locations"]`, and `["items"]`
- **THEN** the engine SHALL return no passages

### Requirement: Priority-Based Ordering
The lore retrieval engine SHALL sort matching passages by priority in descending order, with ties broken by filename in alphabetical order. Priority values MUST be parsed from the `priority` field in YAML frontmatter.

#### Scenario: Priority Ordering
- **WHEN** retrieving passages with priorities: alice.md (priority: 10), bob.md (priority: 20), charlie.md (priority: 10)
- **THEN** the engine SHALL order them as: bob.md, alice.md, charlie.md

#### Scenario: Missing Priority Default
- **WHEN** retrieving passages where some have no `priority` field in frontmatter
- **THEN** passages without priority SHALL be treated as having priority 0 and ordered after all passages with explicit positive priorities

### Requirement: Enabled Filtering
The lore retrieval engine SHALL exclude passages with `enabled: false` in their YAML frontmatter. Passages with missing `enabled` field MUST default to enabled (true).

#### Scenario: Enabled True and Missing
- **WHEN** processing passages with `enabled: true` and passages with no `enabled` field
- **THEN** the engine SHALL include both types of passages in the result set

#### Scenario: Enabled False Exclusion
- **WHEN** processing passages where one has `enabled: false` in frontmatter
- **THEN** the engine SHALL exclude that passage from the result set regardless of tag matches

### Requirement: Content Concatenation
The lore retrieval engine SHALL concatenate the Markdown body content of matching passages using the separator `\n\n---\n\n`. The content MUST exclude YAML frontmatter and preserve original Markdown formatting.

#### Scenario: Multiple Passage Concatenation
- **WHEN** retrieving two matching passages with bodies "Alice is the protagonist." and "Bob is the antagonist."
- **THEN** the engine SHALL return: `Alice is the protagonist.\n\n---\n\nBob is the antagonist.`

#### Scenario: Single Passage Content
- **WHEN** retrieving one matching passage with body "The castle stands on a hill."
- **THEN** the engine SHALL return: `The castle stands on a hill.` (no separator needed)

### Requirement: Empty Result Handling
The lore retrieval engine SHALL return an empty string when no passages match the specified criteria. No error MUST be thrown for empty results.

#### Scenario: No Matching Tags
- **WHEN** filtering for a tag that exists in no passages' effective tags
- **THEN** the engine SHALL return an empty string

#### Scenario: All Passages Disabled
- **WHEN** all matching passages have `enabled: false` in their frontmatter
- **THEN** the engine SHALL return an empty string