# Lore Storage System

## Overview

The lore storage system provides file-based storage structure for the Lore Codex, supporting passages organized by scope (global, series, story) with YAML frontmatter metadata and directory-based tagging.

## ADDED Requirements

### Requirement: Directory Structure Organization
The system SHALL organize lore passages in a three-level scope hierarchy under `playground/lore/` with `.md` files as storage units.

#### Scenario: Global scope passage storage
- **WHEN** a passage is created for global scope
- **THEN** it MUST be stored in `playground/lore/global/` or its subdirectories as a `.md` file

#### Scenario: Series and story scope passage storage  
- **WHEN** a passage is created for series "fantasy-realm" and story "dragon-quest"
- **THEN** it MUST be stored in `playground/lore/story/fantasy-realm/dragon-quest/` or its subdirectories as a `.md` file

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
- **WHEN** a passage is stored in `playground/lore/global/characters/alice.md`
- **THEN** the passage MUST receive an implicit tag "characters" in addition to any explicit frontmatter tags

#### Scenario: Passage directly in scope root
- **WHEN** a passage is stored in `playground/lore/global/rules.md` (directly in the scope root, not in a subdirectory)
- **THEN** the passage MUST NOT receive any implicit directory tag

### Requirement: Scope Identification by Location
The system SHALL determine passage scope based on directory path structure within `playground/lore/`.

#### Scenario: Global scope identification
- **WHEN** a passage is located at `playground/lore/global/anything/file.md`
- **THEN** the system MUST identify it as global scope

#### Scenario: Story scope identification
- **WHEN** a passage is located at `playground/lore/story/series-name/story-name/anything/file.md`
- **THEN** the system MUST identify it as story scope for series "series-name" and story "story-name"

### Requirement: Passage File Naming Convention
Passages SHALL use kebab-case `.md` filenames that serve as unique identifiers within their directory.

#### Scenario: Valid kebab-case filename
- **WHEN** a passage is named `old-tavern-keeper.md`
- **THEN** the system MUST accept it as a valid passage identifier

#### Scenario: Filename-based passage identification
- **WHEN** multiple passages exist in the same directory with names `alice.md` and `bob.md`
- **THEN** the system MUST treat them as distinct passages identified by "alice" and "bob" respectively