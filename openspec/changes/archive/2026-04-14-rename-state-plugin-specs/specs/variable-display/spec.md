# Delta Spec: variable-display

## MODIFIED Requirements

### Requirement: Variable block rendering
The `<UpdateVariable>` block extraction, parsing, and rendering SHALL be performed by the state plugin's `frontend.js` module during `frontend-render` hook dispatch. The plugin handler SHALL extract both complete (`<UpdateVariable>…</UpdateVariable>`) and incomplete (unclosed `<UpdateVariable>`) blocks from `context.text`, replace them with placeholder comments, render each as a collapsible `<details>` element with a `<pre>` preformatted content display, and store the rendered HTML in `context.placeholderMap`. The main project SHALL NOT contain a `VariableDisplay.vue` component — all extraction, parsing, and rendering logic resides within `plugins/state/frontend.js`.

Complete blocks SHALL use the summary text `變數更新詳情`. Incomplete blocks SHALL use the summary text `變數更新中...`. All blocks SHALL default to collapsed (no `open` attribute on `<details>`).

#### Scenario: Complete variable block is rendered
- **WHEN** the chapter content contains `<UpdateVariable>…</UpdateVariable>` with a closing tag
- **THEN** the plugin handler SHALL extract the block, render it as a collapsed `<details>` with summary `變數更新詳情` and the inner content in a `<pre>` block, and store the HTML in `context.placeholderMap`

#### Scenario: Incomplete variable block is rendered
- **WHEN** the chapter content contains `<UpdateVariable>` without a closing tag (streaming in progress)
- **THEN** the plugin handler SHALL extract the block, render it as a collapsed `<details>` with summary `變數更新中...` and the partial content in a `<pre>` block

#### Scenario: No VariableDisplay.vue in main project
- **WHEN** inspecting `reader-src/src/components/`
- **THEN** no `VariableDisplay.vue` component SHALL exist — all variable display rendering is done by `plugins/state/frontend.js`

### Requirement: Plugin manifest and registration

The state plugin SHALL use the existing plugin directory `plugins/state/` and its manifest. The plugin SHALL register a `frontend-render` handler that extracts `<UpdateVariable>` and `<update>` blocks (case-insensitive) from `context.text`, parses them, renders HTML, and stores results in `context.placeholderMap`. All extraction and rendering logic SHALL reside within `plugins/state/frontend.js`.

#### Scenario: State plugin registers frontend-render handler
- **WHEN** the plugin system initializes the `state` plugin
- **THEN** the plugin SHALL register its `frontend-render` handler that processes `<UpdateVariable>` blocks

#### Scenario: Variable tags rendered via plugin system
- **WHEN** the `frontend-render` hook is dispatched and `context.text` contains `<UpdateVariable>` blocks
- **THEN** the state plugin's handler SHALL extract the blocks, replace them with placeholder comments in `context.text`, and add `placeholder → renderedHTML` entries to `context.placeholderMap`
