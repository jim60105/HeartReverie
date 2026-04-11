# Variable Display — Delta Spec (plugin-consolidation)

## MODIFIED Requirements

### Requirement: Plugin manifest and registration

The variable-display functionality SHALL be provided by the consolidated `state-patches` plugin (merged from former `apply-patches` and `variable-display` plugins). The `state-patches` plugin manifest SHALL declare:
- **name**: `state-patches`
- **type**: `full-stack`
- **backendModule**: handler for `post-response` hook (Rust binary invocation)
- **frontendModule**: handler for `frontend-render` hook (UpdateVariable block rendering)
- **stripTags**: `["UpdateVariable"]`
- **tags**: `["UpdateVariable", "update"]`

The `state-patches` plugin SHALL register:
1. A `post-response` hook handler for running the `apply-patches` Rust binary
2. A `frontend-render` hook handler for extracting and rendering `<UpdateVariable>` blocks

The former standalone `variable-display` plugin directory SHALL no longer exist. All UpdateVariable rendering behavior (complete blocks, incomplete blocks, content display, multiple blocks, default collapsed state) SHALL be preserved identically in the merged plugin's frontend module.

#### Scenario: state-patches registers as a full-stack plugin
- **WHEN** the plugin system initializes the `state-patches` plugin
- **THEN** the plugin SHALL register its manifest with type `full-stack`, register its `post-response` backend hook handler, and register its `<UpdateVariable>` frontend-render handler

#### Scenario: UpdateVariable tag rendered via merged plugin
- **WHEN** the md-renderer encounters an `<UpdateVariable>` block during XML extraction
- **THEN** the block SHALL be passed to the `state-patches` plugin's registered renderer, producing the same collapsible `<details>` output as the former `variable-display` plugin

#### Scenario: Backend and frontend capabilities coexist
- **WHEN** the `state-patches` plugin is loaded
- **THEN** it SHALL provide both `post-response` hook handling (Rust binary invocation) and `frontend-render` hook handling (UpdateVariable rendering) within the same plugin

### Requirement: Complete UpdateVariable block rendering
The renderer SHALL detect complete `<UpdateVariable>...</UpdateVariable>` blocks (containing both opening and closing tags) in the chapter content. Complete blocks SHALL be rendered as a collapsible `<details>` element with the summary text `變數更新詳情`.

#### Scenario: Complete UpdateVariable block is rendered as collapsible
- **WHEN** the chapter content contains `<UpdateVariable><Analysis>...</Analysis><JSONPatch>[...]</JSONPatch></UpdateVariable>`
- **THEN** the renderer SHALL output a `<details>` element with `<summary>變數更新詳情</summary>` and the block's inner content displayed inside, defaulting to collapsed

### Requirement: Incomplete UpdateVariable block rendering
The renderer SHALL detect incomplete `<UpdateVariable>` blocks that have an opening tag but no corresponding closing `</UpdateVariable>` tag (e.g., at the end of a chapter still being generated). Incomplete blocks SHALL be rendered as a collapsible `<details>` element with the summary text `變數更新中...`.

#### Scenario: Incomplete UpdateVariable block at end of chapter
- **WHEN** the chapter content contains `<UpdateVariable>` followed by partial content but no `</UpdateVariable>` closing tag
- **THEN** the renderer SHALL output a `<details>` element with `<summary>變數更新中...</summary>` and the available partial content inside, defaulting to collapsed

### Requirement: UpdateVariable content display
Inside the collapsible section, the renderer SHALL display the inner content of the `<UpdateVariable>` block. The `<Analysis>` text and `<JSONPatch>` data SHALL both be visible when the section is expanded.

#### Scenario: Analysis and JSONPatch content are visible when expanded
- **WHEN** the user expands a collapsed variable update section
- **THEN** the `<Analysis>` text and `<JSONPatch>` JSON data SHALL be displayed as readable content within the details element

### Requirement: Multiple UpdateVariable blocks in a single chapter
The renderer SHALL handle chapters that contain more than one `<UpdateVariable>` block. Each block SHALL be rendered independently as its own collapsible section.

#### Scenario: Two UpdateVariable blocks in one chapter
- **WHEN** the chapter contains two separate `<UpdateVariable>...</UpdateVariable>` blocks
- **THEN** the renderer SHALL produce two independent collapsible `<details>` sections, each with summary `變數更新詳情`, in the order they appear in the source

### Requirement: Default collapsed state
All `<UpdateVariable>` collapsible sections (both complete and incomplete) SHALL default to collapsed so they do not dominate the reading view.

#### Scenario: Variable sections are collapsed by default
- **WHEN** a chapter with UpdateVariable blocks is rendered
- **THEN** all variable update `<details>` elements SHALL NOT have the `open` attribute and SHALL appear collapsed on initial render
