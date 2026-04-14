# Delta Spec: vento-prompt-template

## MODIFIED Requirements

### Requirement: Template variables

The system prompt template (`system.md`) SHALL receive the following variables from the server:
- `previous_context` (array of strings): Chapter context entries in numerical order. Each element is either full chapter text (for recent chapters, after tag stripping) or a formatted summary string (for older chapters processed by context compaction). When context compaction is active, the array MAY be prefixed with a global story summary element wrapped in `<story_summary>` tags containing all extracted chapter summaries concatenated in chronological order, followed by full text for chapters without summaries (fallback), and full chapter text for recent chapters. When context compaction is not active, each element is stripped chapter content identical to legacy behavior.
- `user_input` (string): The raw user message.
- `status_data` (string): The status file content (from `current-status.yml` or `init-status.yml`). Named `status_data` to avoid conflict with the template-local `status` variable set via `{{ set status }}{{ include "./status.md" }}{{ /set }}`.
- `isFirstRound` (boolean): `true` when no chapters with non-empty content exist, `false` otherwise.
- `plugin_prompts` (array of `{name, content}` objects): Prompt fragments contributed by plugins via the `prompt-assembly` hook. Each object contains the plugin `name` (string) and the prompt fragment `content` (string). The array is ordered by hook handler priority. After plugin consolidation, the `threshold-lord` plugin contributes prompt fragments under its own name (unchanged), absorbing the former `disclaimer` plugin's functionality.
- `series_name` (string): The display name of the current series (directory name of the series folder).
- `story_name` (string): The display name of the current story (directory name of the story folder).
- `lore_all` (string): Concatenated content of all in-scope lore passages.
- `lore_<tag>` (string): Concatenated content of passages matching a specific tag (dynamic — one per unique tag).
- `lore_tags` (string[]): Array of all unique effective tags across in-scope passages.

#### Scenario: All variables passed to template
- **WHEN** the system prompt is rendered
- **THEN** the Vento template SHALL receive all ten variable categories: `previous_context`, `user_input`, `status_data`, `isFirstRound`, `plugin_prompts`, `series_name`, `story_name`, `lore_all`, dynamic `lore_<tag>` variables, and `lore_tags`

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
