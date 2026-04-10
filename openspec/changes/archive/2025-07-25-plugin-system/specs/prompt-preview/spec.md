# Prompt Preview

## Purpose

API endpoint and frontend UI for previewing the fully rendered system prompt before sending to OpenRouter, with visibility into plugin contributions.

## ADDED Requirements

### Requirement: API endpoint

The server SHALL expose `POST /api/stories/:series/:name/preview-prompt` that accepts the same JSON body as the chat endpoint (`{ message }`) and returns the fully rendered system prompt WITHOUT sending the request to OpenRouter. The endpoint SHALL execute the full prompt construction pipeline including plugin `prompt-assembly` hooks, Vento template rendering, and chapter context assembly — producing an identical prompt to what the chat endpoint would send.

#### Scenario: Preview prompt for a story with existing chapters
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with `{ "message": "Continue the story" }` and the story has existing chapters
- **THEN** the server SHALL return HTTP 200 with the fully rendered system prompt, user message, plugin contributions, and template variables — without calling OpenRouter

#### Scenario: Preview prompt for a first-round story
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with `{ "message": "Begin" }` and the story has no chapters with content
- **THEN** the server SHALL return HTTP 200 with the rendered prompt where `isFirstRound` is `true` and `previous_context` is empty

#### Scenario: Preview with missing story
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with a non-existent series or story name
- **THEN** the server SHALL return HTTP 404

#### Scenario: Preview with missing message
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with an empty body or missing `message` field
- **THEN** the server SHALL return HTTP 400 with an error indicating the `message` field is required

### Requirement: Response format

The preview endpoint SHALL return a JSON response with the following structure: `systemPrompt` (string, the fully rendered system prompt text), `userMessage` (string, the raw user message), `pluginContributions` (array of objects, each with `plugin` (string, plugin name) and `section` (string, the contributed prompt fragment)), and `templateVariables` (object, the complete set of template variables passed to the Vento renderer including both core and plugin-provided variables).

#### Scenario: Response includes rendered system prompt
- **WHEN** the preview endpoint returns successfully
- **THEN** the `systemPrompt` field SHALL contain the complete rendered text identical to what would be sent as the system message to OpenRouter

#### Scenario: Response includes plugin contributions
- **WHEN** plugins contribute prompt fragments during `prompt-assembly`
- **THEN** the `pluginContributions` array SHALL contain one entry per contributing plugin, with the plugin's `name` and the `section` text it contributed

#### Scenario: Response includes template variables
- **WHEN** the preview endpoint renders the prompt
- **THEN** the `templateVariables` object SHALL include all variables passed to the Vento template, including `scenario`, `previous_context`, `user_input`, `status_data`, `isFirstRound`, and any plugin-provided variables

#### Scenario: No plugin contributions
- **WHEN** no plugins contribute prompt fragments
- **THEN** the `pluginContributions` array SHALL be empty (`[]`)

### Requirement: Frontend panel

The reader UI SHALL include a fixed side-panel for displaying the prompt preview. The panel SHALL be positioned at the left side of the viewport (`left: 0`) with `width: 33vw`. The panel SHALL be triggerable from both a standalone Preview button in the chat input row and from the editor's Preview button. When triggered from the editor, the current textarea content SHALL be sent as a `template` override in the request body. When either panel is open, a semi-transparent backdrop SHALL appear; clicking the backdrop SHALL close all panels.

#### Scenario: Open preview panel before sending
- **WHEN** the user triggers the prompt preview action (e.g., clicks a preview button) with a message drafted in the chat input
- **THEN** the frontend SHALL send a `POST /api/stories/:series/:name/preview-prompt` request with the drafted message and display the result in the side panel with a backdrop

#### Scenario: Preview panel displays system prompt
- **WHEN** the preview panel receives a successful response
- **THEN** it SHALL display the `systemPrompt` text in a scrollable, readable format

#### Scenario: Preview panel is dismissible
- **WHEN** the user closes the preview panel via close button or backdrop click
- **THEN** the panel SHALL close without affecting the chat input or message state, and the backdrop SHALL hide if no other panel is open

### Requirement: Plugin contribution visibility

The prompt preview panel SHALL display which plugins contributed which prompt sections. Each plugin contribution SHALL be visually labeled with the plugin name and its contributed section text, allowing the user to understand the composition of the final system prompt.

#### Scenario: Multiple plugin contributions displayed
- **WHEN** the preview response contains contributions from plugins `options`, `status`, and `writestyle`
- **THEN** the preview panel SHALL display each contribution labeled with its respective plugin name

#### Scenario: Plugin contribution sections are distinguishable
- **WHEN** the preview panel displays the system prompt alongside plugin contributions
- **THEN** each plugin's contributed section SHALL be visually distinguishable (e.g., highlighted, labeled, or listed separately) from the core prompt content
