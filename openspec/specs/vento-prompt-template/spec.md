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
- Lines 16-20: Formatting rules (output format definition), enclosed in `<formatting>...</formatting>`
- Lines 22-24: Language instructions (Traditional Chinese locale), enclosed in `<language>...</language>`
- Line 41: Game instructions (interactive fiction mode definition), enclosed in `<game_instructions>...</game_instructions>` (without the legacy `[GAME INSTRUCTIONS: ` prefix and trailing `]`, which are subsumed by the wrapper)
- Lines 48-56: Writing guidelines (minimum fiction quality standard), enclosed in `<writing_guidelines>...</writing_guidelines>`

The template structure (section ordering, `{{ if isFirstRound }}` conditional, `[Details of the fictional world...]` wrapper, `<inputs>`, `<status_current_variable>`, plugin variable references, and the four named XML containers around the core sections) SHALL remain unchanged from the post-`name-system-prompt-blocks` baseline.

#### Scenario: Template uses content_freedom variable
- **WHEN** `system.md` is rendered
- **THEN** the `{{ content_freedom }}` variable SHALL appear after `{{ threshold_lord_start }}` and before the `<formatting>` opening tag (the `<formatting>` wrapper sits immediately above the `# Formatting:` heading that previously delimited this position)

#### Scenario: Template uses start_hints with conditional
- **WHEN** `system.md` is rendered and `isFirstRound` is true
- **THEN** the `{{ if isFirstRound }}` block SHALL contain `{{ start_hints }}` instead of hardcoded `<start_hints>` XML

#### Scenario: Template uses think_before_reply variable
- **WHEN** `system.md` is rendered
- **THEN** the `{{ think_before_reply }}` variable SHALL appear after `{{ writestyle }}` and the `</game_instructions>` closing tag, before `{{ t_task_think_format }}`

#### Scenario: Stable prompt output when all plugins enabled
- **WHEN** all plugins are enabled and loaded
- **THEN** the rendered prompt SHALL produce content identical to the post-`name-system-prompt-blocks` baseline of `system.md` — i.e. byte-identical to the current hardcoded `system.md` *except* for the addition of the four named XML wrappers around the four core sections and the removal of the now-redundant `[GAME INSTRUCTIONS: ` / `]` literals

#### Scenario: Functional output with no plugins loaded
- **WHEN** no plugins are loaded (all plugin variables resolve to empty strings)
- **THEN** `system.md` SHALL still contain the core storytelling instructions: formatting rules (inside `<formatting>`), language instructions (inside `<language>`), game instructions (inside `<game_instructions>`), and writing guidelines (inside `<writing_guidelines>`)
- **AND** the rendered prompt SHALL be sufficient for the LLM to produce a Traditional Chinese interactive fiction response

### Requirement: Enhanced existing plugin prompt fragments

Two existing plugins SHALL be enhanced with additional `promptFragments` entries:

1. **`threshold-lord`**: Add `content_freedom` fragment (priority 15) containing the content-freedom/NSFW instructions
2. **`thinking`**: Add `think_before_reply` fragment (priority 100) containing the "Think before reply" instruction. Plugin type changes from `frontend-only` to `full-stack`.

#### Scenario: threshold-lord exposes content_freedom fragment

- **WHEN** the engine loads the `threshold-lord` plugin
- **THEN** `getDynamicVariables()` SHALL include a `content_freedom` entry sourced from a `promptFragments` declaration with priority 15

#### Scenario: thinking plugin exposes think_before_reply fragment

- **WHEN** the engine loads the `thinking` plugin
- **THEN** the plugin manifest type SHALL be `full-stack`
- **AND** `getDynamicVariables()` SHALL include a `think_before_reply` entry sourced from a `promptFragments` declaration with priority 100

### Requirement: Core prose sections are wrapped in named XML containers

The four "core" prose sections of `HeartReverie/system.md` (the formatting rules, the language instructions, the game-instructions paragraph, and the writing guidelines bullets) SHALL each be wrapped in a same-named open/close XML tag pair so that each section becomes individually addressable by name. Specifically:

- The Formatting section SHALL be enclosed by `<formatting>` … `</formatting>`. The original `# Formatting:` heading and its body (the four convention lines covering `***Emphasize***`, `**\"Dialogue\"**`, `*Thoughts*`, plain narration) SHALL remain inside the wrapper unchanged.
- The Language section SHALL be enclosed by `<language>` … `</language>`. The original `# Language:` heading and its two body lines (the `總是使用正體中文。` directive and the punctuation-width rule) SHALL remain inside the wrapper unchanged.
- The Game Instructions block SHALL be enclosed by `<game_instructions>` … `</game_instructions>`. The original `[GAME INSTRUCTIONS: ` opening literal and the closing `]` SHALL be removed (their role as a poor-man's name is fully subsumed by the new XML tag pair); every other character of the original block SHALL be preserved byte-identically.
- The Writing Guidelines section SHALL be enclosed by `<writing_guidelines>` … `</writing_guidelines>`. The original `# Writing guidelines:` heading and its bullet list (the eight `- ALWAYS …` / `- Craft …` / etc. items) SHALL remain inside the wrapper unchanged.

The four wrapped sections SHALL appear in the same order as before (`<formatting>` first, then `<language>`, then `<game_instructions>`, then `<writing_guidelines>`) and at the same positions inside the same outer `{{ message "system" }}` … `{{ /message }}` block. The dynamic-content sections `# STORY SERIES`, `# SCENARIO`, and `# CHARACTER DESCRIPTION` (and the existing `<scenario>...</scenario>` wrapper around character description) SHALL NOT receive new XML wrappers.

#### Scenario: All four wrappers present in default `system.md`

- **WHEN** the default `HeartReverie/system.md` template is read
- **THEN** it SHALL contain matching open/close pairs for every one of `<formatting>`, `<language>`, `<game_instructions>`, `<writing_guidelines>` (one of each), with the open tag preceding its close tag, and the four pairs SHALL appear in the listed order

#### Scenario: Wrapped prose is preserved verbatim

- **WHEN** the substring between each open/close pair is extracted
- **THEN** for `<formatting>`, the substring SHALL contain the literal text `***Emphasize***`, `**\"Dialogue\"**`, `*Thoughts*`, and a line stating the narration has no styling
- **AND** for `<language>`, the substring SHALL contain the literal `總是使用正體中文。`
- **AND** for `<game_instructions>`, the substring SHALL contain the prose that was previously inside the `[GAME INSTRUCTIONS: ...]` line, with no surrounding `[GAME INSTRUCTIONS: ` prefix and no trailing `]`
- **AND** for `<writing_guidelines>`, the substring SHALL contain at least the bullet `- ALWAYS make sure your response to extended over 20 lines, and pause the story at an appropriate point as it unfolds.`

#### Scenario: Dynamic-content sections remain un-wrapped

- **WHEN** the default `HeartReverie/system.md` template is read
- **THEN** the lines containing `# STORY SERIES` and `{{ series_name }}` SHALL NOT be enclosed by any new XML wrapper introduced by this change
- **AND** the existing `<scenario>` … `</scenario>` wrapper that surrounds the character description block SHALL remain present and unmodified

### Requirement: Strict SSTI whitelist forbids set, /set, include, and JS-escape tokens

The Vento template validator (`validateTemplate()`) SHALL classify any of the following tokens as `vento.unsafe-expression` errors and SHALL reject them at PUT-time, plugin-load-time, and render-time alike: `{{ set ... }}`, `{{ /set }}`, `{{ include "..." }}`, and any `{{> jsExpression }}`. The validator SHALL NOT be relaxed to support these constructs in any plugin or main-template context.

#### Scenario: set is rejected

- **WHEN** any consumer invokes `validateTemplate("{{ set x = 1 }}foo{{ /set }}")`
- **THEN** the result includes an offending fragment for `set`
- **AND** any caller passing that template to `PUT /api/templates`, `POST /api/templates/lint`, or `PluginManager.getPromptVariables()` is rejected with an error

#### Scenario: include is rejected

- **WHEN** any consumer invokes `validateTemplate('{{ include "./x.md" }}')`
- **THEN** the result includes an offending fragment for `include`

#### Scenario: JS-escape token is rejected

- **WHEN** any consumer invokes `validateTemplate("{{> someJsExpression() }}")`
- **THEN** the result includes an offending fragment for `{{>`

### Requirement: Lint pipeline uses compile() AST path

The engine SHALL expose `ventoEnv.compile(source, filename?, defaults?): VentoTemplate` (synchronous, parse-only) in its vendor ambient typings, and the lint pipeline SHALL use `compile()` rather than `runString()` (dry-run) to collect parse-time diagnostics. The pipeline SHALL preserve the parsed AST for downstream consumers (variable AST walk, future lint rules).

#### Scenario: compile() catches parse-time SourceError

- **GIVEN** a template that includes nested `{{ message }}` blocks
- **WHEN** the lint pipeline calls `ventoEnv.compile(source, "<lint>")` (sync)
- **THEN** the call throws a `SourceError` whose `name === "SourceError"`
- **AND** the lint pipeline maps this to a `vento.message-nested` diagnostic

#### Scenario: compile() does not invoke filesystem IO

- **WHEN** the lint pipeline parses a template referencing variables it does not have
- **THEN** the call throws a parse error OR returns an AST (no execution)
- **AND** no filesystem reads occur outside `writer/vendor` and the in-memory source

### Requirement: Lore passage templates are lintable via lore: path

The lint and preview pipelines SHALL accept template paths of the form `lore:global:<rel>`, `lore:series:<series>:<rel>`, and `lore:story:<series>:<story>:<rel>`, mirroring the three lore scopes resolved by `resolveLoreVariables()`. The variable catalog for `lore:` paths SHALL contain ONLY first-pass snapshot variables (`lore_*` + `series_name` + `story_name`) and SHALL NOT include plugin promptFragment variables, mirroring the engine's actual lore render order.

#### Scenario: Lore lint uses first-pass catalog

- **WHEN** the caller posts `POST /api/templates/lint` with `templatePath: "lore:series:demo:characters/alice.md"`
- **THEN** the variable catalog used for `vento.unknown-variable` checks contains `lore_*`, `series_name`, and `story_name`
- **AND** does NOT contain any plugin-fragment variable
- **AND** does NOT contain `user_input`, `previous_context`, or `plugin_fragments`

#### Scenario: Lore preview returns markdown body, not messages

- **WHEN** the caller posts `POST /api/templates/preview` with `templatePath: "lore:series:demo:characters/alice.md"`
- **THEN** the response `kind` is `"markdown"`
- **AND** `content` contains the rendered markdown string
- **AND** the response does NOT contain a `messages[]` array

### Requirement: Documentation removes set / include examples

The `docs/prompt-template.md` document SHALL NOT contain examples that use `{{ set ... }}`, `{{ /set }}`, or `{{ include "..." }}`. The document SHALL contain a top-level warning that these constructs are forbidden, with guidance to use named variables, plugin `promptFragments`, or `getDynamicVariables()` instead.

#### Scenario: Forbidden examples are absent

- **WHEN** a reader greps `docs/prompt-template.md` for `{{ set ` or `{{ include `
- **THEN** no occurrences are found

#### Scenario: Warning paragraph present

- **WHEN** a reader opens `docs/prompt-template.md`
- **THEN** there is a paragraph explicitly stating that `set` / `/set` / `include` are not supported and pointing to the alternative injection mechanisms

### Requirement: chapter_number is catalog-visible

The lint variable catalog SHALL include `chapter_number` (type `number`, source `core`) for `kind: "system"` and `kind: "plugin-fragment"`. The engine injects `chapter_number` into the render context for plugin promptFragments (see `writer/lib/template.ts:renderPromptFragments`); listing it as a core variable prevents false-positive `vento.unknown-variable` diagnostics in plugin fragments that legitimately reference it (for example `context-compaction/chapter-summary-instruction.md`).

#### Scenario: Plugin-fragment lint catalog includes chapter_number

- **GIVEN** a plugin promptFragment whose source references `{{ chapter_number }}`
- **WHEN** `POST /api/templates/lint` runs against that fragment
- **THEN** the response `diagnostics[]` does not contain a `vento.unknown-variable` warning naming `chapter_number`

#### Scenario: Preview fixture defaults chapter_number to 1

- **WHEN** `fixtureToContext({})` is invoked with an empty fixture
- **THEN** the returned context contains `chapter_number: 1`
- **AND** `injected[]` lists `"chapter_number"`

