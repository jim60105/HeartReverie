# Writer Backend (Delta Spec)

## ADDED Requirements

### Requirement: Lore API route registration

The server SHALL register lore CRUD routes as a core route module at `writer/routes/lore.ts`, mounted under the `/api/lore/` path prefix. These routes SHALL be subject to the same authentication middleware as other API routes and SHALL be registered during server initialization alongside other core routes.

#### Scenario: Lore API routes are registered
- **WHEN** the server starts
- **THEN** the lore route handlers SHALL be mounted under `/api/lore/` path prefix and be accessible via HTTP requests

#### Scenario: Lore API routes require authentication
- **WHEN** a client sends a request to any `/api/lore/` endpoint without valid authentication
- **THEN** the server SHALL return HTTP 401 Unauthorized

## MODIFIED Requirements

### Requirement: Server initialization

The writer backend SHALL be a Deno application using Hono framework with TypeScript ESM modules. Route handlers SHALL be organized into separate module files under `writer/routes/`. Middleware functions SHALL be extracted into `writer/lib/middleware.ts`. Configuration SHALL be centralized in `writer/lib/config.ts`. Error response construction SHALL use a shared `problemJson()` helper from `writer/lib/errors.ts`. The server SHALL also register the lore CRUD routes from `writer/routes/lore.ts` alongside other core routes during initialization.

#### Scenario: Server starts and serves static frontend
- **WHEN** the server process is started with valid TLS certificates via `deno run`
- **THEN** the server SHALL listen on HTTPS and serve files from the `reader/` directory at the root path `/`

#### Scenario: API routes are mounted
- **WHEN** the server starts
- **THEN** all `/api/` routes SHALL be available as Hono route handlers, each imported from its respective route module, including the lore CRUD routes

#### Scenario: Modular route structure
- **WHEN** a developer inspects the `writer/routes/` directory
- **THEN** each file contains handlers for a single API domain (auth, stories, chapters, chat, plugins, prompt, lore)

#### Scenario: TypeScript type checking passes
- **WHEN** a developer runs `deno check` on the writer backend entry point
- **THEN** all TypeScript files under `writer/` SHALL pass type checking without errors

### Requirement: Prompt construction pipeline

The server SHALL construct the LLM messages array using a template-driven prompt rendering pipeline. The `renderSystemPrompt()` function SHALL accept the following parameters to pass as Vento template variables: `previous_context` (array of strings, each being a stripped chapter content), `user_input` (string, the raw user message), `status_data` (string, the status file content), `isFirstRound` (boolean, true when no chapters with content exist), and `plugin_prompts` (array of `{name, content}` objects contributed by plugins via the prompt-assembly hook). Additionally, `renderSystemPrompt()` SHALL call the lore retrieval engine in `writer/lib/lore.ts` directly with the active series and story context, and spread the returned lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) into the Vento template render context. See the `vento-prompt-template` spec for template variable definitions and template-level rendering requirements.

Before rendering the template, the server SHALL invoke the `prompt-assembly` hook stage. Each registered plugin handler SHALL return a `{name, content}` object representing the plugin's prompt fragment. The server SHALL collect all returned prompt fragments into the `plugin_prompts` array, ordered by handler priority. The `plugin_prompts` array SHALL be passed to the Vento template alongside the existing variables.

The Vento template rendering call SHALL pass all variables to the `system.md` template, including plugin variables collected from the prompt-assembly hook and lore variables computed directly by the lore retrieval engine.

The content previously delivered via `after_user_message.md` as a separate system message SHALL be incorporated into the `system.md` template. The server SHALL NOT load or send `after_user_message.md` as a separate system message.

The messages array SHALL be simplified to exactly two messages: a system message containing the fully rendered template output, followed by a user message containing the raw user input.

Before including chapter content in the `previous_context` array, the server SHALL strip tags declared in each plugin's `promptStripTags` manifest field from the chapter text, rather than using a hardcoded list. The stripping SHALL be applied per-chapter using a multiline-aware regex. The result SHALL be trimmed to remove leading/trailing whitespace left by the removed tags.

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

#### Scenario: Chapter tag stripping uses plugin-declared promptStripTags
- **WHEN** a chapter's content contains tags declared by plugins in their `promptStripTags` manifest field (e.g., `<options>`, `<disclaimer>`, `<user_message>`)
- **THEN** those tags and all content between them SHALL be removed from the chapter text before it is included in the `previous_context` array

#### Scenario: Chapter without special tags
- **WHEN** a chapter's content does not contain any tags declared in any plugin's `promptStripTags`
- **THEN** the chapter content SHALL be included in `previous_context` unchanged (aside from trimming)

#### Scenario: Vento template rendering
- **WHEN** the system prompt is constructed
- **THEN** the server SHALL use the ventojs engine to render `system.md` with variables collected from the prompt-assembly hook and from the lore retrieval engine as the template data

#### Scenario: after_user_message.md elimination
- **WHEN** the messages array is constructed
- **THEN** the server SHALL NOT load `after_user_message.md` as a separate file and SHALL NOT append it as a separate system message

#### Scenario: Lore variables available in template
- **WHEN** the lore system is active and lore passages exist for the current story context
- **THEN** the template rendering SHALL include lore variables (`lore_all`, `lore_<tag>`, `lore_tags`) in the Vento template context alongside other variables