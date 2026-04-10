# Writer Backend — Plugin System Delta

## MODIFIED Requirements

### Requirement: Prompt construction pipeline

The server SHALL construct the LLM messages array using a template-driven prompt rendering pipeline. The `renderSystemPrompt()` function SHALL accept the following parameters to pass as Vento template variables: `scenario` (string, content of `playground/:series/scenario.md`), `previous_context` (array of strings, each being a stripped chapter content), `user_input` (string, the raw user message), `status_data` (string, the status file content), `isFirstRound` (boolean, true when no chapters with content exist), and `plugin_prompts` (array of `{name, content}` objects contributed by plugins via the prompt-assembly hook). See the `vento-prompt-template` spec for template variable definitions and template-level rendering requirements.

Before rendering the template, the server SHALL invoke the `prompt-assembly` hook stage. Each registered plugin handler SHALL return a `{name, content}` object representing the plugin's prompt fragment. The server SHALL collect all returned prompt fragments into the `plugin_prompts` array, ordered by handler priority. The `plugin_prompts` array SHALL be passed to the Vento template alongside the existing variables.

The Vento template rendering call SHALL pass all variables to the `system.md` template as `{ scenario, previous_context, user_input, status_data, isFirstRound, plugin_prompts }`.

The content previously delivered via `after_user_message.md` as a separate system message SHALL be incorporated into the `system.md` template. The server SHALL NOT load or send `after_user_message.md` as a separate system message.

The messages array SHALL be simplified to exactly two messages: a system message containing the fully rendered template output, followed by a user message containing the raw user input.

Before including chapter content in the `previous_context` array, the server SHALL strip tags registered in the `frontend-strip` hook stage from the chapter text, rather than using a hardcoded list. Plugins that register strip-tags handlers SHALL declare which tag names to strip. The stripping SHALL be applied per-chapter using a multiline-aware regex. The result SHALL be trimmed to remove leading/trailing whitespace left by the removed tags.

#### Scenario: First round prompt construction
- **WHEN** a chat request is made and no chapters with content exist yet
- **THEN** the server SHALL invoke the `prompt-assembly` hook to collect `plugin_prompts`, pass `previous_context` as an empty array, `user_input` as the raw user message, `status_data` as the status file content, `isFirstRound` as `true`, and `plugin_prompts` as the collected array to the template
- **AND** the messages array SHALL contain exactly two messages: a system message with the fully rendered template, and a user message with the raw user input

#### Scenario: Subsequent round prompt construction
- **WHEN** a chat request is made and chapters with content already exist
- **THEN** the server SHALL invoke the `prompt-assembly` hook to collect `plugin_prompts`, pass `previous_context` as an array of stripped chapter contents in numerical order, `user_input` as the raw user message, `status_data` as the status file content, `isFirstRound` as `false`, and `plugin_prompts` as the collected array to the template
- **AND** the messages array SHALL contain exactly two messages: a system message with the fully rendered template, and a user message with the raw user input

#### Scenario: Plugin-contributed prompt fragments assembled
- **WHEN** the `prompt-assembly` hook is invoked and multiple plugins have registered handlers
- **THEN** each handler SHALL be called in priority order and the returned `{name, content}` objects SHALL be collected into the `plugin_prompts` array passed to the template

#### Scenario: No plugins contribute prompt fragments
- **WHEN** the `prompt-assembly` hook is invoked and no plugins have registered handlers
- **THEN** `plugin_prompts` SHALL be an empty array and the template SHALL render without plugin prompt sections

#### Scenario: Chapter tag stripping uses plugin-registered strip list
- **WHEN** a chapter's content contains tags registered by plugins in the `frontend-strip` hook stage (e.g., `<options>`, `<disclaimer>`, `<user_message>`)
- **THEN** those tags and all content between them SHALL be removed from the chapter text before it is included in the `previous_context` array

#### Scenario: Chapter without special tags
- **WHEN** a chapter's content does not contain any tags registered in the `frontend-strip` hook stage
- **THEN** the chapter content SHALL be included in `previous_context` unchanged (aside from trimming)

#### Scenario: Vento template rendering
- **WHEN** the system prompt is constructed
- **THEN** the server SHALL use the ventojs engine to render `system.md` with `{ scenario, previous_context, user_input, status_data, isFirstRound, plugin_prompts }` as the template data

#### Scenario: after_user_message.md elimination
- **WHEN** the messages array is constructed
- **THEN** the server SHALL NOT load `after_user_message.md` as a separate file and SHALL NOT append it as a separate system message

## ADDED Requirements

### Requirement: Plugin loader initialization

The writer backend SHALL initialize the plugin loader at server startup, before any HTTP routes are mounted. The loader SHALL scan the built-in plugin directory (`plugins/`) and an optional external plugin directory specified by the `PLUGIN_DIR` environment variable. For each discovered plugin, the loader SHALL read the plugin manifest (JSON or YAML), validate its structure, register the plugin in the plugin registry, and call the plugin's `init` lifecycle hook. If a plugin fails to load (invalid manifest, missing required fields, init error), the server SHALL log a warning and continue loading remaining plugins. The server SHALL NOT crash due to a single plugin failure.

#### Scenario: Built-in plugins loaded at startup
- **WHEN** the server starts and the `plugins/` directory contains valid plugin manifests
- **THEN** all valid plugins SHALL be loaded, registered, and initialized before HTTP routes become available

#### Scenario: External plugin directory loaded
- **WHEN** the `PLUGIN_DIR` environment variable is set to a valid directory path
- **THEN** plugins from that directory SHALL be loaded in addition to built-in plugins

#### Scenario: No external plugin directory configured
- **WHEN** the `PLUGIN_DIR` environment variable is not set
- **THEN** only built-in plugins from `plugins/` SHALL be loaded

#### Scenario: Plugin with invalid manifest
- **WHEN** a plugin directory contains a manifest with missing required fields or invalid syntax
- **THEN** the server SHALL log a warning identifying the plugin and the validation error, skip that plugin, and continue loading others

#### Scenario: Plugin init failure
- **WHEN** a plugin's `init` lifecycle hook throws an error
- **THEN** the server SHALL log the error, mark the plugin as failed, and continue loading remaining plugins

### Requirement: Prompt preview endpoint

The writer backend SHALL expose `GET /api/stories/:series/:name/preview-prompt` that returns the fully rendered system prompt without sending it to OpenRouter. The endpoint SHALL execute the same prompt construction pipeline (including the `prompt-assembly` hook for plugin prompt fragments) and return the rendered prompt as plain text or JSON. This endpoint is protected by the same `verifyPassphrase` middleware as all other API routes.

#### Scenario: Preview prompt for a story
- **WHEN** a client sends `GET /api/stories/:series/:name/preview-prompt` with a valid passphrase
- **THEN** the server SHALL construct the full system prompt using the same pipeline as the chat endpoint (including plugin prompt assembly) and return it in the response body without calling OpenRouter

#### Scenario: Preview prompt includes plugin contributions
- **WHEN** plugins have registered `prompt-assembly` handlers
- **THEN** the preview response SHALL include the plugin-contributed prompt sections in the rendered output

#### Scenario: Preview prompt with no chapters
- **WHEN** the story has no chapters with content
- **THEN** the preview SHALL render with `isFirstRound` as `true` and `previous_context` as an empty array

### Requirement: Plugin API endpoints

The writer backend SHALL expose `GET /api/plugins` that returns a JSON array of loaded plugins. Each entry SHALL include the plugin `name`, `type` (full-stack, prompt-only, frontend-only, hook-only), `enabled` status, and a list of registered `hooks`. This endpoint is protected by the same `verifyPassphrase` middleware as all other API routes.

#### Scenario: List all loaded plugins
- **WHEN** a client sends `GET /api/plugins` with a valid passphrase
- **THEN** the server SHALL return a JSON array containing an entry for each loaded plugin with its name, type, enabled status, and registered hooks

#### Scenario: No plugins loaded
- **WHEN** no plugins are loaded (empty `plugins/` directory and no `PLUGIN_DIR`)
- **THEN** the server SHALL return an empty JSON array `[]`
