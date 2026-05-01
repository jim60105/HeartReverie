## MODIFIED Requirements

### Requirement: Prompt construction pipeline

The server SHALL construct the LLM messages array using a template-driven prompt rendering pipeline. The `renderSystemPrompt()` function SHALL accept the following parameters to pass as Vento template variables: `previous_context` (array of strings, each being a stripped chapter content), `user_input` (string, the raw user message), `isFirstRound` (boolean, true when no chapters with content exist), and `plugin_fragments` (array of strings — fragment bodies contributed by plugins via the prompt-assembly hook, ordered by handler priority). Additionally, `renderSystemPrompt()` SHALL call `pluginManager.getDynamicVariables({ series, name, storyDir })` and spread the returned variables into the Vento template context. It SHALL also call the lore retrieval engine in `writer/lib/lore.ts` directly with the active series and story context, and spread the returned lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) into the Vento template render context. `renderSystemPrompt()` SHALL return `{ messages: ChatMessage[]; error: VentoError | null }` — never a single `prompt: string`. See the `vento-prompt-template` spec for template variable definitions and template-level rendering requirements.

`renderSystemPrompt()` SHALL install a custom Vento plugin (the `vento-message-tag` capability) on the shared `Environment` that registers the `{{ message }}` / `{{ /message }}` tag pair. Before calling `runString`, the server SHALL generate a fresh per-render UUID nonce via `crypto.randomUUID()`, build a fresh `__messages: []` array, and inject both `__msgNonce` and `__messages` into the data context passed to `runString`. After `runString` resolves, the server SHALL invoke `splitRenderedMessages()` to assemble the final `ChatMessage[]` from the rendered string and the side-channel buffer (see the `vento-message-tag` capability for assembly semantics).

`renderSystemPrompt()` SHALL return `{ messages: ChatMessage[], error: VentoError | null }` (a discriminated union — when `error` is non-null, `messages` is an empty array; when `error` is null, `messages` is non-empty). `BuildPromptResult` SHALL replace its previous `prompt: string` field with `messages: ChatMessage[]`. The `ChatMessage` type SHALL be `{ role: "system" | "user" | "assistant"; content: string }` and SHALL be exported from `writer/types.ts`.

Before rendering the template, the server SHALL invoke the `prompt-assembly` hook stage. Each registered plugin handler SHALL return a string (the fragment body). The server SHALL collect all returned fragment strings into the `plugin_fragments` array, ordered by handler priority. The `plugin_fragments` array SHALL be passed to the Vento template alongside the existing variables.

The Vento template rendering call SHALL pass all variables to the `system.md` template, including plugin variables collected from the prompt-assembly hook and lore variables computed directly by the lore retrieval engine.

The content previously delivered via `after_user_message.md` as a separate system message SHALL be incorporated into the `system.md` template. The server SHALL NOT load or send `after_user_message.md` as a separate system message.

The upstream `messages` array SHALL be the assembled `ChatMessage[]` returned by `renderSystemPrompt()`, used verbatim. The server SHALL NOT append, prepend, or otherwise inject any message that the template did not produce. In particular, the prior behaviour of auto-appending `{role: "user", content: <request.message>}` is REMOVED — the template is the single source of truth for the message sequence.

Before including chapter content in the `previous_context` array, the server SHALL strip tags declared in each plugin's `promptStripTags` manifest field from the chapter text, rather than using a hardcoded list. The stripping SHALL be applied per-chapter using a multiline-aware regex. The result SHALL be trimmed to remove leading/trailing whitespace left by the removed tags.

#### Scenario: First round prompt construction
- **WHEN** a chat request is made and no chapters with content exist yet
- **THEN** the server SHALL invoke the `prompt-assembly` hook to collect `plugin_fragments`, pass `previous_context` as an empty array, `user_input` as the raw user message, `isFirstRound` as `true`, and `plugin_fragments` as the collected array to the template
- **AND** the upstream `messages` array sent to the LLM API SHALL be exactly the `ChatMessage[]` returned by the template (no automatically-appended user message)

#### Scenario: Subsequent round prompt construction
- **WHEN** a chat request is made and chapters with content already exist
- **THEN** the server SHALL invoke the `prompt-assembly` hook to collect `plugin_fragments`, pass `previous_context` as an array of stripped chapter contents in numerical order, `user_input` as the raw user message, `isFirstRound` as `false`, and `plugin_fragments` as the collected array to the template
- **AND** the upstream `messages` array SHALL be exactly the `ChatMessage[]` returned by the template

#### Scenario: Plugin-contributed prompt fragments assembled
- **WHEN** the `prompt-assembly` hook is invoked and multiple plugins have registered handlers
- **THEN** each handler SHALL be called in priority order and the returned fragment strings SHALL be collected into the `plugin_fragments` array passed to the template

#### Scenario: No plugins contribute prompt fragments
- **WHEN** the `prompt-assembly` hook is invoked and no plugins have registered handlers
- **THEN** `plugin_fragments` SHALL be an empty array and the template SHALL render without plugin prompt sections

#### Scenario: Chapter tag stripping uses plugin-declared promptStripTags
- **WHEN** a chapter's content contains tags declared by plugins in their `promptStripTags` manifest field (e.g., `<options>`, `<disclaimer>`, `<user_message>`)
- **THEN** those tags and all content between them SHALL be removed from the chapter text before it is included in the `previous_context` array

#### Scenario: Chapter without special tags
- **WHEN** a chapter's content does not contain any tags declared in any plugin's `promptStripTags`
- **THEN** the chapter content SHALL be included in `previous_context` unchanged (aside from trimming)

#### Scenario: Vento template rendering
- **WHEN** the system prompt is constructed
- **THEN** the server SHALL use the ventojs engine to render `system.md` with variables collected from the prompt-assembly hook and from the lore retrieval engine as the template data, with the message-tag Vento plugin installed on the environment

#### Scenario: after_user_message.md elimination
- **WHEN** the messages array is constructed
- **THEN** the server SHALL NOT load `after_user_message.md` as a separate file and SHALL NOT append it as a separate system message

#### Scenario: Lore variables available in template
- **WHEN** the lore system is active and lore passages exist for the current story context
- **THEN** the template rendering SHALL include lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) in the Vento template context alongside other variables

#### Scenario: Per-render isolation of message buffer
- **WHEN** two `renderSystemPrompt()` calls run concurrently
- **THEN** each call SHALL receive its own `__msgNonce` and its own `__messages` buffer, and the assembled message arrays SHALL be independent

#### Scenario: Template missing user-role message
- **WHEN** the rendered template emits no `user`-role message
- **THEN** `renderSystemPrompt()` SHALL return `{ messages: [], error: <vento-error with type 'multi-message:no-user-message'> }` and the chat handler SHALL respond with a 422 RFC 9457 Problem Details error without calling the upstream LLM API

### Requirement: StoryEngine interface update

The `StoryEngine` interface in `writer/types.ts` SHALL no longer include the `loadStatus` method. The `BuildPromptResult` interface SHALL no longer include the `statusContent` field NOR the legacy `prompt: string` field; it SHALL instead include a `messages: ChatMessage[]` field. The `RenderOptions` interface SHALL no longer include the `status` field.

#### Scenario: StoryEngine without loadStatus
- **WHEN** `writer/types.ts` is examined
- **THEN** `StoryEngine` SHALL NOT have a `loadStatus` method

#### Scenario: BuildPromptResult uses messages
- **WHEN** `writer/types.ts` is examined
- **THEN** `BuildPromptResult` SHALL include a `messages: ChatMessage[]` field
- **AND** SHALL NOT include `statusContent` or `prompt: string`

#### Scenario: RenderOptions without status
- **WHEN** `writer/types.ts` is examined
- **THEN** `RenderOptions` SHALL NOT have a `status` field

### Requirement: Prompt preview endpoint

The writer backend SHALL expose `POST /api/stories/:series/:name/preview-prompt` that returns the fully rendered prompt without sending it to the LLM API. The request body SHALL accept an optional `message` field (the simulated user message; empty string if absent) and an optional `template` field (an unsaved template override from the Prompt Editor; falls back to the file at `PROMPT_FILE` when absent). The endpoint SHALL execute the same prompt construction pipeline (including the `prompt-assembly` hook for plugin prompt fragments and dynamic plugin variables) and return the assembled `messages: ChatMessage[]` array as JSON. This endpoint is protected by the same `verifyPassphrase` middleware as all other API routes. The `variables` response field SHALL NOT contain `status_data` as a separate core variable; if the state plugin is loaded, `status_data` will be present in the rendered output via the plugin's dynamic variables. The legacy `prompt: string` response field is REMOVED.

#### Scenario: Preview prompt for a story
- **WHEN** a client sends `POST /api/stories/:series/:name/preview-prompt` with a valid passphrase
- **THEN** the server SHALL construct the full prompt using the same pipeline as the chat endpoint (including plugin prompt assembly) and return `{ messages: ChatMessage[], variables: {...} }` in the response body without calling the LLM API

#### Scenario: Preview prompt includes plugin contributions
- **WHEN** plugins have registered `prompt-assembly` handlers
- **THEN** the preview response's `messages` array SHALL include the plugin-contributed prompt sections in the rendered output

#### Scenario: Preview prompt with no chapters
- **WHEN** the story has no chapters with content
- **THEN** the preview SHALL render with `isFirstRound` as `true` and `previous_context` as an empty array

#### Scenario: Preview response omits status_data from core variables
- **WHEN** a client calls the preview endpoint
- **THEN** the `variables` object in the response SHALL NOT contain a `status_data` field as a core variable

#### Scenario: Preview response uses messages shape
- **WHEN** a client calls the preview endpoint
- **THEN** the response body SHALL include `messages: ChatMessage[]` and SHALL NOT include the legacy `prompt: string` field
