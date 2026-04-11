# Vento Prompt Template

## Purpose

Defines the template variable contract and prompt structure requirements for the Vento-based system prompt template (`playground/prompts/system.md`). This spec governs what variables the server passes to the template and how the template uses them to construct the complete prompt output.

## Requirements

### Requirement: Template variables

The system prompt template (`system.md`) SHALL receive the following variables from the server:
- `scenario` (string): Content of `playground/:series/scenario.md`.
- `previous_context` (array of strings): Chapter context entries in numerical order. Each element is either full chapter text (for recent chapters, after tag stripping) or a formatted summary string (for older chapters processed by context compaction). When context compaction is active, the array MAY be prefixed with a global story summary element wrapped in `<story_summary>` tags containing all extracted chapter summaries concatenated in chronological order, followed by full text for chapters without summaries (fallback), and full chapter text for recent chapters. When context compaction is not active, each element is stripped chapter content identical to legacy behavior.
- `user_input` (string): The raw user message.
- `status_data` (string): The status file content (from `current-status.yml` or `init-status.yml`). Named `status_data` to avoid conflict with the template-local `status` variable set via `{{ set status }}{{ include "./status.md" }}{{ /set }}`.
- `isFirstRound` (boolean): `true` when no chapters with non-empty content exist, `false` otherwise.
- `plugin_prompts` (array of `{name, content}` objects): Prompt fragments contributed by plugins via the `prompt-assembly` hook. Each object contains the plugin `name` (string) and the prompt fragment `content` (string). The array is ordered by hook handler priority. After plugin consolidation, the `threshold-lord` plugin contributes prompt fragments under its own name (unchanged), absorbing the former `disclaimer` plugin's functionality.

#### Scenario: All variables passed to template
- **WHEN** the system prompt is rendered
- **THEN** the Vento template SHALL receive all six variables: `scenario`, `previous_context`, `user_input`, `status_data`, `isFirstRound`, and `plugin_prompts`

#### Scenario: previous_context is empty on first round
- **WHEN** `isFirstRound` is `true`
- **THEN** `previous_context` SHALL be an empty array

#### Scenario: previous_context contains stripped chapters without compaction
- **WHEN** chapters with content exist and the context-compaction plugin is not active
- **THEN** `previous_context` SHALL contain one string per chapter, ordered numerically, with tags registered by all active plugins' `promptStripTags` (including `state-patches` for `UpdateVariable`, `threshold-lord` for `disclaimer`, and `user-message` for `user_message`) already removed

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

### Requirement: Template prompt structure

The `system.md` template SHALL use Vento syntax to control all prompt structure. The template SHALL iterate over the `previous_context` array and wrap each entry in `<previous_context>` tags. The template SHALL conditionally render `<start_hints>` content when `isFirstRound` is `true`. The template SHALL include `status_data` content wrapped in `<status_current_variable>` tags. The template SHALL incorporate the content previously delivered by `after_user_message.md` directly within the template.

The template SHALL gain a plugin prompt injection section where plugin-contributed prompt fragments are assembled. The template SHALL iterate over the `plugin_prompts` array and render each plugin's prompt fragment. Each plugin prompt fragment SHALL be clearly delimited in the rendered output (e.g., wrapped in a comment or section marker identifying the contributing plugin name). The plugin prompt injection section SHALL appear at a designated location in the template (after core prompt sections but before the final instructions).

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

#### Scenario: after_user_message content consolidated
- **WHEN** the template is rendered
- **THEN** the rendered output SHALL include the content that was previously in `after_user_message.md`, rendered within the same template

#### Scenario: Plugin prompt fragments rendered
- **WHEN** `plugin_prompts` contains entries (e.g., `[{name: 'options-panel', content: '...'}, {name: 'status-bar', content: '...'}]`)
- **THEN** the rendered template SHALL include each plugin's content in the plugin prompt injection section, with each fragment clearly attributed to its plugin name

#### Scenario: No plugin prompt fragments
- **WHEN** `plugin_prompts` is an empty array
- **THEN** the plugin prompt injection section SHALL be empty or omitted, and the rest of the template SHALL render normally

#### Scenario: Plugin prompt ordering preserved
- **WHEN** `plugin_prompts` contains multiple entries ordered by priority
- **THEN** the rendered template SHALL include the plugin prompt fragments in the same order as they appear in the `plugin_prompts` array
