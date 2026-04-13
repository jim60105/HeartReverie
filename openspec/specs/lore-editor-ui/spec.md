# Lore Editor UI Specification

## Overview

The Lore Editor UI provides a Vue 3 frontend interface for browsing, filtering, and editing lore passages within the HeartReverie interactive fiction engine. This component integrates with the core lore codex system and provides a user-friendly interface for managing narrative knowledge base entries organized by scope (global, series, story).

## Requirements

### Requirement: Passage Browser Display
The system SHALL display a browsable list of lore passages with their metadata including scope, tags, priority level, and enabled status.

#### Scenario: Display passage list with metadata
- **WHEN** user navigates to the lore browser view
- **THEN** the system displays all accessible passages showing filename, scope (global/series/story), tags as clickable badges, priority number, and enabled toggle status

#### Scenario: Empty state handling
- **WHEN** user navigates to lore browser and no passages exist in the selected scope
- **THEN** the system displays a helpful empty state message with an option to create the first passage

### Requirement: Tag-Based Filtering
The system SHALL provide interactive tag-based filtering to allow users to narrow down passages by their associated tags.

#### Scenario: Filter passages by clicking tag
- **WHEN** user clicks on a tag badge displayed on any passage card
- **THEN** the system filters the passage list to show only passages containing that tag and highlights the active filter

#### Scenario: Clear tag filters
- **WHEN** user has applied tag filters and clicks a clear filters button
- **THEN** the system removes all active filters and displays the complete passage list for the current scope

### Requirement: Scope Navigation
The system SHALL provide navigation between different lore scopes (global, series, story) with dynamic population based on the current story context.

#### Scenario: Switch between scope tabs
- **WHEN** user clicks on a different scope tab (global/series/story)
- **THEN** the system loads and displays passages from that scope, updating the URL route and maintaining any applied filters within the new scope

#### Scenario: Dynamic scope population
- **WHEN** user is working within a specific story context
- **THEN** the system populates series and story scope tabs with passages relevant to the current story's series and story ID

### Requirement: Passage Editor Interface
The system SHALL provide an editor interface for modifying passage frontmatter fields and Markdown content with real-time preview capabilities.

#### Scenario: Edit passage frontmatter
- **WHEN** user clicks on a passage card to open the editor
- **THEN** the system displays editable fields for tags (with autocomplete), priority (numeric input), enabled status (toggle), and the passage Markdown content in a text area

#### Scenario: Validate frontmatter input
- **WHEN** user enters invalid data in frontmatter fields (e.g., non-numeric priority, malformed tags)
- **THEN** the system displays validation errors and prevents saving until all fields contain valid data

### Requirement: CRUD Operations
The system SHALL support creating new passages, saving changes to existing passages, and deleting passages through API calls to the backend lore-codex endpoints.

#### Scenario: Create new passage
- **WHEN** user clicks "Create New Passage" button and fills in required fields (filename, scope, content)
- **THEN** the system calls PUT /api/lore/{scope-prefix}/{filename} to create the passage and updates the browser list with the new entry

#### Scenario: Save passage changes
- **WHEN** user modifies a passage and clicks the save button
- **THEN** the system calls PUT /api/lore/{scope-prefix}/{path} with the updated content and frontmatter, showing success confirmation

#### Scenario: Delete passage with confirmation
- **WHEN** user clicks delete button on a passage
- **THEN** the system displays a confirmation dialog and, upon confirmation, calls DELETE /api/lore/{scope-prefix}/{path} and removes the passage from the browser list

### Requirement: Responsive Layout Design
The system SHALL provide a responsive user interface that adapts to different viewport sizes and maintains usability on both desktop and mobile devices.

#### Scenario: Desktop layout optimization
- **WHEN** user accesses the lore editor on a desktop viewport (>768px width)
- **THEN** the system displays passage cards in a multi-column grid with sidebar navigation and full-width editor panels

#### Scenario: Mobile layout adaptation
- **WHEN** user accesses the lore editor on a mobile viewport (<768px width)
- **THEN** the system stacks passage cards in a single column, collapses navigation into a hamburger menu, and provides touch-optimized editor controls

## Implementation Notes

- Core Vue components integrated into `reader-src/src/views/` and `reader-src/src/components/lore/`
- Registered as a core route in Vue Router (not a plugin frontend module — the plugin system lacks route extension points)
- UI text in Traditional Chinese (zh-TW) following project conventions
- Utilizes Tailwind CSS classes consistent with the existing frontend styling
- Built through Vite pipeline to `reader-dist/` directory
