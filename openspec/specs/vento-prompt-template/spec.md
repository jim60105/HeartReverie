# Vento Prompt Template

## Purpose

Defines the template variable contract and prompt structure requirements for the Vento-based system prompt template (`playground/_prompts/system.md`). This spec governs what variables the server passes to the template and how the template uses them to construct the complete prompt output.

## Requirements

### Requirement: Template variables

The system prompt template (`system.md`) SHALL receive the following variables from the server:
- `previous_context` (array of strings): Chapter context entries in numerical order. Each element is either full chapter text (for recent chapters, after tag stripping) or a formatted summary string (for older chapters processed by context compaction). When context compaction is active, the array MAY be prefixed with a global story summary element wrapped in `<story_summary>` tags containing all extracted chapter summaries concatenated in chronological order, followed by full text for chapters without summaries (fallback), and full chapter text for recent chapters. When context compaction is not active, each element is stripped chapter content identical to legacy behavior.
- `user_input` (string): The raw user message.
- `isFirstRound` (boolean): `true` when no chapters with non-empty content exist, `false` otherwise.
- `plugin_prompts` (array of `{name, content}` objects): Prompt fragments contributed by plugins via the `prompt-assembly` hook. Each object contains the plugin `name` (string) and the prompt fragment `content` (string). The array is ordered by hook handler priority. After plugin consolidation, the `threshold-lord` plugin contributes prompt fragments under its own name (unchanged), absorbing the former `disclaimer` plugin's functionality.
- `series_name` (string): The display name of the current series (directory name of the series folder).
- `story_name` (string): The display name of the current story (directory name of the story folder).
- `lore_all` (string): Concatenated content of all in-scope lore passages.
- `lore_<tag>` (string): Concatenated content of passages matching a specific tag (dynamic — one per unique tag).
- `lore_tags` (string[]): Array of all unique effective tags across in-scope passages.
- Plugin-provided dynamic variables: Variables returned by plugins' `getDynamicVariables()` functions (e.g., `status_data` from the `state` plugin). These are spread into the template context alongside core variables.

#### Scenario: All variables passed to template
- **WHEN** the system prompt is rendered
- **THEN** the Vento template SHALL receive all variable categories: `previous_context`, `user_input`, `isFirstRound`, `plugin_prompts`, `series_name`, `story_name`, `lore_all`, dynamic `lore_<tag>` variables, `lore_tags`, and plugin-provided dynamic variables (including `status_data` from the state plugin)
- **AND** `status_data` SHALL NOT appear in the core variable enumeration

#### Scenario: status_data provided by plugin
- **WHEN** the system prompt is rendered and the `state` plugin is loaded
- **THEN** `status_data` SHALL be present in the Vento template context with the same content as before (from `current-status.yaml` or `init-status.yaml`)
- **AND** it SHALL be provided via the plugin's `getDynamicVariables` mechanism, NOT as a core variable

#### Scenario: status_data absent when state plugin not loaded
- **WHEN** the system prompt is rendered and the `state` plugin is NOT loaded
- **THEN** `status_data` SHALL be undefined (or empty string) in the template context
- **AND** the `{{ if status_data }}` conditional in `system.md` SHALL cause the `<status_current_variable>` block to be omitted from the rendered output

#### Scenario: previous_context is empty on first round
- **WHEN** `isFirstRound` is `true`
- **THEN** `previous_context` SHALL be an empty array

#### Scenario: previous_context contains stripped chapters without compaction
- **WHEN** chapters with content exist and the context-compaction plugin is not active
- **THEN** `previous_context` SHALL contain one string per chapter, ordered numerically, with tags registered by all active plugins' `promptStripTags` (including `state` for `UpdateVariable`, `threshold-lord` for `disclaimer`, and `user-message` for `user_message`) already removed

#### Scenario: previous_context contains tiered content with compaction
- **WHEN** chapters with content exist and the context-compaction plugin is active with summaries available
- **THEN** `previous_context` SHALL contain: an optional global summary element (wrapped in `<story_summary>` tags containing concatenated chapter summaries), full stripped text for chapters without summaries as fallback, and full stripped text for recent chapters within the L2 window — all ordered numerically

#### Scenario: plugin_prompts contains plugin contributions
- **WHEN** plugins have registered `prompt-assembly` handlers
- **THEN** `plugin_prompts` SHALL contain one `{name, content}` object per contributing plugin, ordered by handler priority

#### Scenario: plugin_prompts is empty when no plugins contribute
- **WHEN** no plugins have registered `prompt-assembly` handlers
- **THEN** `plugin_prompts` SHALL be an empty array

#### Scenario: threshold-lord prompt fragments unchanged after merge
- **WHEN** the consolidated `threshold-lord` plugin contributes prompt fragments
- **THEN** the template variables `threshold_lord_start` and `threshold_lord_end` SHALL remain available with identical content as before the merger

#### Scenario: series_name available in template context
- **WHEN** the system prompt is rendered for series "fantasy" and story "quest"
- **THEN** `series_name` SHALL be the string "fantasy"

#### Scenario: story_name available in template context
- **WHEN** the system prompt is rendered for series "fantasy" and story "quest"
- **THEN** `story_name` SHALL be the string "quest"

#### Scenario: series_name and story_name are empty strings when not applicable
- **WHEN** the system prompt is rendered without a selected story context (e.g., no story selected)
- **THEN** `series_name` SHALL be an empty string and `story_name` SHALL be an empty string

#### Scenario: lore_all contains all in-scope passages
- **WHEN** lore passages exist within the current story scope
- **THEN** `lore_all` SHALL contain the concatenated content of all in-scope lore passages

#### Scenario: lore_<tag> variables for each unique tag
- **WHEN** lore passages have various tags applied
- **THEN** the template SHALL receive one `lore_<tag>` variable per unique effective tag, containing the concatenated content of passages matching that specific tag

#### Scenario: lore_tags contains all unique tags
- **WHEN** lore passages exist with tags
- **THEN** `lore_tags` SHALL be an array containing all unique effective tags across in-scope passages

#### Scenario: Empty lore variables when no lore exists
- **WHEN** no lore passages exist within the current story scope
- **THEN** `lore_all` SHALL be an empty string, no `lore_<tag>` variables SHALL exist, and `lore_tags` SHALL be an empty array

### Requirement: Dynamic known-variables for error suggestions

The Vento error handler (`buildVentoError()` in `errors.ts`) SHALL accept an optional set of extra known variable names so that dynamic lore variables are included in "Did you mean?" Levenshtein suggestions when a template references an undefined variable.

#### Scenario: Lore variable typo gets suggestion
- **WHEN** a template references `{{ lore_charcter }}` (typo) and a lore variable `lore_character` exists in the current context
- **THEN** the error response SHALL include a "Did you mean `lore_character`?" suggestion

#### Scenario: No lore context still works
- **WHEN** a template references an undefined variable and no extra known variables are provided
- **THEN** the error handler SHALL behave identically to its current behavior, using only the hardcoded known-variables list

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

### Requirement: Core prompt sections MUST NOT be extracted into plugins

The `system.md` template defines the system's identity as a Traditional Chinese interactive fiction engine. The following sections are **core** to this identity and SHALL remain hardcoded in `system.md` — they MUST NOT be extracted into plugins, now or in the future:

1. **Formatting rules** (currently lines 16-20): Defines the output format conventions (emphasis, dialogue, thoughts, narration). Without these, the LLM does not know how to format fiction output with distinct dialogue/thoughts/narration styling.
2. **Language instructions** (currently lines 22-24): Specifies Traditional Chinese (`正體中文`) as the output language and punctuation width rules. Without these, the LLM defaults to English, completely breaking the experience for a Chinese fiction engine.
3. **Game instructions** (currently line 41): Defines the core operating mode as an interactive fiction/text adventure game. Without this, the system is a generic chatbot rather than an interactive fiction engine.
4. **Writing guidelines** (currently lines 48-56): Establishes the minimum fiction quality standard (literary style, scene transitions, show-don't-tell, dialogue-driven narrative). Without these, the output quality degrades below acceptable standards for literary fiction.

**Rationale**: When the `plugins/` directory does not exist or is empty, the system must still produce a meaningful Traditional Chinese interactive fiction response. Only optional/creative-direction sections (content-freedom, think-before-reply, start-hints) may be extracted into plugins because disabling them does not break the system's core function.

#### Scenario: System functions without plugins
- **WHEN** `plugins/` directory does not exist or contains no plugins
- **THEN** `system.md` SHALL still contain all 4 core sections (formatting, language, game instructions, writing guidelines) as hardcoded prose
- **AND** the rendered prompt SHALL be sufficient for the LLM to produce a Traditional Chinese interactive fiction response with proper formatting, correct language, game-appropriate behavior, and acceptable literary quality

### Requirement: Template variable references for extracted prompt sections

The `system.md` Vento template SHALL replace 3 hardcoded optional/creative-direction prompt sections with plugin-provided template variables:

1. Lines 3-14 (content-freedom prose) → `{{ content_freedom }}` (provided by `threshold-lord` plugin)
2. Lines 43-44 (think before reply) → `{{ think_before_reply }}` (provided by `thinking` plugin)
3. Lines 67-76 (start hints content) → `{{ start_hints }}` (provided by `start-hints` plugin)

The following sections SHALL remain hardcoded in `system.md` as they are **core** to the system's function as a Traditional Chinese interactive fiction engine (the system must produce meaningful output even when no plugins are loaded):
- Lines 16-20: Formatting rules (output format definition)
- Lines 22-24: Language instructions (Traditional Chinese locale)
- Line 41: Game instructions (interactive fiction mode definition)
- Lines 48-56: Writing guidelines (minimum fiction quality standard)

The template structure (section ordering, `{{ if isFirstRound }}` conditional, `[Details of the fictional world...]` wrapper, `<inputs>`, `<status_current_variable>`, plugin variable references) SHALL remain unchanged.

#### Scenario: Template uses content_freedom variable
- **WHEN** `system.md` is rendered
- **THEN** the `{{ content_freedom }}` variable SHALL appear after `{{ threshold_lord_start }}` and before the `# Formatting:` section

#### Scenario: Template uses start_hints with conditional
- **WHEN** `system.md` is rendered and `isFirstRound` is true
- **THEN** the `{{ if isFirstRound }}` block SHALL contain `{{ start_hints }}` instead of hardcoded `<start_hints>` XML

#### Scenario: Template uses think_before_reply variable
- **WHEN** `system.md` is rendered
- **THEN** the `{{ think_before_reply }}` variable SHALL appear after `{{ writestyle }}` and the game instructions, before `{{ t_task_think_format }}`

#### Scenario: Identical prompt output when all plugins enabled
- **WHEN** all plugins are enabled and loaded
- **THEN** the rendered prompt SHALL produce identical content to the current hardcoded `system.md`

#### Scenario: Functional output with no plugins loaded
- **WHEN** no plugins are loaded (all plugin variables resolve to empty strings)
- **THEN** `system.md` SHALL still contain the core storytelling instructions: formatting rules, language instructions, game instructions, and writing guidelines
- **AND** the rendered prompt SHALL be sufficient for the LLM to produce a Traditional Chinese interactive fiction response

### Requirement: Enhanced existing plugin prompt fragments

Two existing plugins SHALL be enhanced with additional `promptFragments` entries:

1. **`threshold-lord`**: Add `content_freedom` fragment (priority 15) containing the content-freedom/NSFW instructions
2. **`thinking`**: Add `think_before_reply` fragment (priority 100) containing the "Think before reply" instruction. Plugin type changes from `frontend-only` to `full-stack`.
