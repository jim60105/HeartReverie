## ADDED Requirements

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
