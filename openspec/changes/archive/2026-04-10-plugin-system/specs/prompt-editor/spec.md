# Prompt Editor

## Purpose

Frontend system prompt template editor (編排器) for directly editing the Vento template text with variable insertion pills and live preview integration.

## ADDED Requirements

### Requirement: Editor UI

The frontend SHALL provide a fixed side-panel editor for editing the system prompt template. The editor SHALL use a `<textarea>` displaying the raw Vento template content loaded from `GET /api/template`. The editor panel SHALL be positioned at the right side of the viewport with `width: 33vw`. The editor component SHALL be implemented as vanilla JS ES modules with no build step, consistent with the existing frontend architecture.

#### Scenario: View current template
- **WHEN** the user opens the prompt editor
- **THEN** the editor SHALL display the full Vento template content in a monospace textarea, loaded from `GET /api/template`

#### Scenario: Reset template
- **WHEN** the user clicks the "Reset" button in the editor
- **THEN** the editor SHALL reload the template from the server, discarding local edits

#### Scenario: Editor loads as ES module
- **WHEN** the frontend loads the prompt editor component
- **THEN** it SHALL be loaded as an ES module via `<script type="module">` without requiring a build step or bundler

### Requirement: Variable insertion pills

The editor SHALL display clickable pills above the textarea showing all available Vento template variables. Clicking a pill SHALL insert the `{{ variable_name }}` reference at the current cursor position. Pills SHALL be color-coded: blue for core variables, green for plugin-contributed variables.

#### Scenario: Display variable pills
- **WHEN** the editor loads
- **THEN** it SHALL fetch variables from `GET /api/plugins/parameters` and render them as clickable pill buttons with color coding by source

#### Scenario: Insert variable from pill
- **WHEN** the user clicks a variable pill
- **THEN** the editor SHALL insert `{{ variable_name }}` at the textarea cursor position

### Requirement: Panel layout and backdrop

The preview panel SHALL be positioned at the left side (`left: 0`) and the editor panel at the right side (`right: 0`), both with `width: 33vw`. When either panel is visible, a semi-transparent backdrop SHALL be shown behind the panels. Clicking the backdrop SHALL close both panels. The Preview and Editor buttons SHALL be placed in the same row as the Send/Resend buttons (left-aligned), removing the separate toolbar row above the textarea to maximize chat input space.

#### Scenario: Backdrop appears with panel
- **WHEN** the user opens the preview or editor panel
- **THEN** a semi-transparent backdrop SHALL appear behind the panels (z-index below panels, above page content)

#### Scenario: Click outside closes panels
- **WHEN** the user clicks on the backdrop (outside both panels)
- **THEN** both panels SHALL close and the backdrop SHALL hide

#### Scenario: Close button updates backdrop
- **WHEN** the user closes a panel via its close button and no other panel is open
- **THEN** the backdrop SHALL also hide

### Requirement: Live preview integration

Changes made in the prompt editor SHALL be previewable using the prompt preview endpoint. The editor SHALL provide a "Preview" action that sends the current template text to `POST /api/stories/:series/:name/preview-prompt` (via the `template` body field) and displays the rendered result in the preview panel.

#### Scenario: Preview edited template
- **WHEN** the user clicks "Preview" in the editor
- **THEN** the editor SHALL send the textarea content as `template` to the preview endpoint and display the rendered prompt in the preview panel

#### Scenario: Preview with custom message
- **WHEN** the user has typed a message in the chat input and triggers preview from the editor
- **THEN** the preview SHALL render the prompt using that message as `user_input`
