## MODIFIED Requirements

### Requirement: Template variables

The system prompt template (`system.md`) SHALL receive the following variables from the server:
- `scenario` (string): Content of `playground/:series/scenario.md`.
- `previous_context` (array of strings): Chapter context entries in numerical order. Each element is either full chapter text (for recent chapters, after tag stripping) or a formatted summary string (for older chapters processed by context compaction). When context compaction is active, the array MAY be prefixed with a global story summary element wrapped in `<story_summary>` tags containing all extracted chapter summaries concatenated in chronological order, followed by full text for chapters without summaries (fallback), and full chapter text for recent chapters. When context compaction is not active, each element is stripped chapter content identical to legacy behavior.
- `user_input` (string): The raw user message.
- `status_data` (string): The status file content (from `current-status.yml` or `init-status.yml`). Named `status_data` to avoid conflict with the template-local `status` variable set via `{{ set status }}{{ include "./status.md" }}{{ /set }}`.
- `isFirstRound` (boolean): `true` when no chapters with non-empty content exist, `false` otherwise.
- `plugin_prompts` (array of `{name, content}` objects): Prompt fragments contributed by plugins via the `prompt-assembly` hook. Each object contains the plugin `name` (string) and the prompt fragment `content` (string). The array is ordered by hook handler priority.

#### Scenario: All variables passed to template
- **WHEN** the system prompt is rendered
- **THEN** the Vento template SHALL receive all six variables: `scenario`, `previous_context`, `user_input`, `status_data`, `isFirstRound`, and `plugin_prompts`

#### Scenario: previous_context is empty on first round
- **WHEN** `isFirstRound` is `true`
- **THEN** `previous_context` SHALL be an empty array

#### Scenario: previous_context contains stripped chapters without compaction
- **WHEN** chapters with content exist and the context-compaction plugin is not active
- **THEN** `previous_context` SHALL contain one string per chapter, ordered numerically, with tags registered in the `frontend-strip` hook stage already removed

#### Scenario: previous_context contains tiered content with compaction
- **WHEN** chapters with content exist and the context-compaction plugin is active with summaries available
- **THEN** `previous_context` SHALL contain: an optional global summary element (wrapped in `<story_summary>` tags containing concatenated chapter summaries), full stripped text for chapters without summaries as fallback, and full stripped text for recent chapters within the L2 window — all ordered numerically
