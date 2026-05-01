## MODIFIED Requirements

### Requirement: Template prompt structure

The `system.md` template SHALL use Vento syntax to control all prompt structure. The template SHALL iterate over the `previous_context` array and wrap each entry in `<previous_context>` tags. The template SHALL conditionally render `<start_hints>` content when `isFirstRound` is `true`. The template SHALL include `status_data` content wrapped in `<status_current_variable>` tags.

The template SHALL produce the **complete `messages` array** sent to the upstream LLM API by emitting one or more `{{ message <role> }} … {{ /message }}` blocks (see the `vento-message-tag` capability). Top-level template content (anything outside any `{{ message }}` block) SHALL be assembled into one or more `system`-role messages, interleaved in lexical source order with the author-emitted role-tagged messages. The template SHALL include a final `{{ message "user" }}{{ user_input }}{{ /message }}` (or some equivalent placement of `{{ user_input }}` inside a `{{ message "user" }}` block) so that the request always ends on a user turn; the server SHALL NOT auto-append a user message outside the template.

The template SHALL use lore variables instead of a scenario variable for world-building content injection. The template MAY use `{{ lore_all }}` for comprehensive lore inclusion or selective `{{ lore_<tag> }}` variables for topic-specific injection based on the story's needs. The template MAY iterate over `{{ lore_tags }}` to dynamically process tag-specific content.

The template SHALL gain a plugin prompt injection section where plugin-contributed prompt fragments are assembled. The template SHALL iterate over the `plugin_fragments` array and render each plugin's prompt fragment. Each plugin prompt fragment SHALL be clearly delimited in the rendered output (e.g., wrapped in a comment or section marker identifying the contributing plugin name). The plugin prompt injection section SHALL appear at a designated location in the template (after core prompt sections but before the final user turn). Authors MAY wrap the plugin-fragments loop in a `{{ message "<role>" }}` block to bind plugin fragments to a specific role, or leave it at the top level so fragments are absorbed into the surrounding system content.

#### Scenario: Previous context rendering
- **WHEN** `previous_context` contains chapter entries
- **THEN** the rendered template SHALL contain each chapter wrapped in `<previous_context>` tags in order

#### Scenario: First round start hints
- **WHEN** `isFirstRound` is `true`
- **THEN** the rendered template SHALL include `<start_hints>` content with writing guidance

#### Scenario: Subsequent round without start hints
- **WHEN** `isFirstRound` is `false`
- **THEN** the rendered template SHALL NOT include `<start_hints>` content

#### Scenario: Status variable rendering
- **WHEN** the template is rendered
- **THEN** the rendered output SHALL include the `status_data` content wrapped in `<status_current_variable>` tags

#### Scenario: Plugin prompt fragments rendered
- **WHEN** `plugin_fragments` contains entries (e.g., `[{name: 'options-panel', content: '...'}, {name: 'status-bar', content: '...'}]`)
- **THEN** the rendered template SHALL include each plugin's content in the plugin prompt injection section, with each fragment clearly attributed to its plugin name

#### Scenario: No plugin prompt fragments
- **WHEN** `plugin_fragments` is an empty array
- **THEN** the plugin prompt injection section SHALL be empty or omitted, and the rest of the template SHALL render normally

#### Scenario: Plugin prompt ordering preserved
- **WHEN** `plugin_fragments` contains multiple entries ordered by priority
- **THEN** the rendered template SHALL include the plugin prompt fragments in the same order as they appear in the `plugin_fragments` array

#### Scenario: Lore content injection using lore_all
- **WHEN** the template uses `{{ lore_all }}` for world-building content
- **THEN** the rendered template SHALL include all concatenated lore passage content at the specified location

#### Scenario: Selective lore injection using tag-specific variables
- **WHEN** the template uses `{{ lore_<tag> }}` variables for specific topics
- **THEN** the rendered template SHALL include only the lore content matching those specific tags

#### Scenario: Dynamic tag processing
- **WHEN** the template iterates over `{{ lore_tags }}`
- **THEN** the rendered template SHALL process each unique tag dynamically and MAY access corresponding `lore_<tag>` content

#### Scenario: No lore content available
- **WHEN** no lore passages exist within scope
- **THEN** the template SHALL render normally without lore content, and lore variables SHALL be empty or omitted as appropriate

#### Scenario: Template emits multi-turn messages
- **WHEN** the template emits a `{{ message "system" }}…{{ /message }}` followed by a `{{ message "assistant" }}…{{ /message }}` followed by `{{ message "user" }}{{ user_input }}{{ /message }}`
- **THEN** the assembled `messages` array SHALL contain exactly three messages in that role order, with their respective rendered contents

#### Scenario: Template missing user message produces error
- **WHEN** the rendered template emits no `user`-role message anywhere (neither inside a `{{ message "user" }}` block nor as auto-appended content)
- **THEN** `renderSystemPrompt()` SHALL return a Vento error with the `multi-message:no-user-message` variant and the server SHALL NOT call the upstream LLM API
