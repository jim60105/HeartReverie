# Variable Display

## Purpose

Detects and renders `<UpdateVariable>` blocks from chapter content as collapsible sections, handling both complete and incomplete blocks, displaying analysis and JSON patch data, and supporting multiple blocks per chapter.

## Requirements

### Requirement: Complete UpdateVariable block rendering
The renderer SHALL detect complete `<UpdateVariable>...</UpdateVariable>` blocks (containing both opening and closing tags) in the chapter content. The detection logic SHALL remain as a pure TypeScript utility function. Complete blocks SHALL be rendered by a `VariableDisplay.vue` component that accepts typed props `content: string` and `isComplete: boolean`. When `isComplete` is `true`, the component SHALL render a collapsible `<details>` element with the summary text `變數更新詳情`.

#### Scenario: Complete UpdateVariable block is rendered as collapsible
- **WHEN** the chapter content contains `<UpdateVariable><Analysis>...</Analysis><JSONPatch>[...]</JSONPatch></UpdateVariable>`
- **THEN** the parser utility SHALL extract the block and pass `content` and `isComplete: true` as props to `VariableDisplay.vue`, which SHALL output a `<details>` element with `<summary>變數更新詳情</summary>` and the block's inner content displayed inside, defaulting to collapsed

### Requirement: Incomplete UpdateVariable block rendering
The parser utility SHALL detect incomplete `<UpdateVariable>` blocks that have an opening tag but no corresponding closing `</UpdateVariable>` tag. The `VariableDisplay.vue` component SHALL receive `isComplete: false` and render a collapsible `<details>` element with the summary text `變數更新中...`.

#### Scenario: Incomplete UpdateVariable block at end of chapter
- **WHEN** the chapter content contains `<UpdateVariable>` followed by partial content but no `</UpdateVariable>` closing tag
- **THEN** the parser utility SHALL extract the partial block and pass `content` and `isComplete: false` as props to `VariableDisplay.vue`, which SHALL output a `<details>` element with `<summary>變數更新中...</summary>` and the available partial content inside, defaulting to collapsed

### Requirement: UpdateVariable content display
Inside the `VariableDisplay.vue` component's collapsible section, the `content` prop SHALL be displayed. The `<Analysis>` text and `<JSONPatch>` data SHALL both be visible when the section is expanded. The component SHALL render the content as preformatted text or with appropriate formatting.

#### Scenario: Analysis and JSONPatch content are visible when expanded
- **WHEN** the user expands a collapsed variable update section in the `VariableDisplay.vue` component
- **THEN** the `<Analysis>` text and `<JSONPatch>` JSON data SHALL be displayed as readable content within the details element

### Requirement: Multiple UpdateVariable blocks in a single chapter
The parser utility SHALL handle chapters that contain more than one `<UpdateVariable>` block. Each block SHALL result in an independent `VariableDisplay.vue` component instance, each with its own `content` and `isComplete` props.

#### Scenario: Two UpdateVariable blocks in one chapter
- **WHEN** the chapter contains two separate `<UpdateVariable>...</UpdateVariable>` blocks
- **THEN** the parser SHALL produce two independent sets of props, and the rendering pipeline SHALL render two `VariableDisplay.vue` component instances, each with summary `變數更新詳情`, in the order they appear in the source

### Requirement: Default collapsed state
All `VariableDisplay.vue` component instances (both complete and incomplete) SHALL default to collapsed so they do not dominate the reading view. The `<details>` element SHALL NOT have the `open` attribute on initial render.

#### Scenario: Variable sections are collapsed by default
- **WHEN** a chapter with UpdateVariable blocks is rendered
- **THEN** all `VariableDisplay.vue` instances SHALL render `<details>` elements without the `open` attribute, appearing collapsed on initial render

### Requirement: Plugin frontend rendering registration

The `state-patches` plugin's `frontend.js` module SHALL register a `frontend-render` hook handler for extracting and rendering `<UpdateVariable>` blocks. In the Vue architecture, the handler SHALL invoke the TypeScript parser utility and delegate rendering to the `VariableDisplay.vue` component. The existing backend plugin directory structure (`plugins/state-patches/`) SHALL remain unchanged — only the frontend rendering is affected by this refactor. Note: the Vue component is named `VariableDisplay.vue` but the plugin directory and manifest name remain `state-patches`.

#### Scenario: UpdateVariable tag rendered via plugin frontend hook
- **WHEN** the md-renderer encounters an `<UpdateVariable>` block during XML extraction
- **THEN** the block SHALL be passed to the `state-patches` plugin's registered `frontend-render` handler, which SHALL use the TypeScript parser utility and produce the collapsible `<details>` output via `VariableDisplay.vue`

#### Scenario: Plugin directory structure preserved
- **WHEN** the Vue refactor is complete
- **THEN** the `plugins/state-patches/` directory SHALL still exist with its original `plugin.json` manifest and backend structure intact

### Requirement: Typed component props
The `VariableDisplay.vue` component SHALL define typed props using `defineProps<{ content: string; isComplete: boolean }>()`. The `content` prop SHALL contain the inner text of the `<UpdateVariable>` block. The `isComplete` prop SHALL determine whether the summary displays `變數更新詳情` (true) or `變數更新中...` (false).

#### Scenario: Component receives typed props
- **WHEN** the rendering pipeline creates a `VariableDisplay.vue` instance
- **THEN** it SHALL pass `content` as a string and `isComplete` as a boolean, both type-checked at compile time

### Requirement: Parser utility with typed return
The UpdateVariable parser SHALL be implemented as a pure TypeScript utility function with signature `parseUpdateVariableBlocks(content: string): Array<{ content: string; isComplete: boolean }>`. This function SHALL detect all complete and incomplete `<UpdateVariable>` blocks and return an array of typed objects suitable for passing as props to `VariableDisplay.vue`.

#### Scenario: Parser returns typed array
- **WHEN** the parser processes chapter content containing two complete blocks and one incomplete block
- **THEN** it SHALL return an array of three objects, each with `content: string` and `isComplete: boolean`, in document order
