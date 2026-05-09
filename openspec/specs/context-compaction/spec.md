# Context Compaction

## Purpose

Plugin-based context compaction system that replaces older chapter full text with extracted summaries in the LLM prompt, reducing token usage while preserving narrative continuity through a tiered context assembly strategy.

## Requirements

### Requirement: Chapter summary prompt injection

The context-compaction plugin SHALL declare a `promptFragments` entry that injects an instruction into the system prompt, directing the LLM to append a `<chapter_summary>` XML tag after the story content in each response. The prompt instruction SHALL specify that the summary must be concise structured text (not YAML/JSON) covering: key events with chapter number annotation, character state changes, and unresolved plot threads or foreshadowing. The summary format SHALL be designed for direct concatenation — when multiple chapter summaries are joined in sequence, the result SHALL read as a coherent global story summary.

The instruction fragment SHALL be a Vento template. At system-prompt render time the engine SHALL render each plugin's named-variable `promptFragments` file through the same Vento environment used for `system.md`, supplying a render context that includes the canonical target chapter number under the variable name `chapter_number`. The chapter number SHALL be sourced from the target chapter's filename (zero-padded numeric `NNNN.md` parsed via `resolveTargetChapterNumber()`); it SHALL NOT be inferred from `previous_context` length, lore content, or any LLM-side reasoning. The rendered instruction SHALL state the chapter number explicitly to the LLM and SHALL instruct the LLM to use that exact number in the emitted `<chapter_summary>` body — the instruction SHALL NOT ask the LLM to determine, count, or guess the chapter number.

`PluginManager.getPromptVariables()` SHALL expose, alongside the `variables` map, parallel origin metadata that records — for each named-variable fragment — the owning plugin name and the fragment's relative file path, so that downstream consumers can attribute render failures back to the source plugin without re-scanning manifests.

If a fragment fails to render through Vento (syntax error, unknown filter, etc.), the engine SHALL log a warning that includes the variable name, the owning plugin name, the fragment file path, and the underlying error message, then SHALL fall back to the raw fragment content, mirroring the existing lore-passage render-failure behaviour.

#### Scenario: Summary instruction injected into prompt
- **WHEN** the system prompt is rendered with the context-compaction plugin loaded
- **THEN** the rendered prompt SHALL include an instruction section (via `promptFragments`) telling the LLM to output a `<chapter_summary>` tag after the story content

#### Scenario: Canonical chapter number substituted from filename
- **WHEN** the system prompt is rendered with the context-compaction plugin loaded and the target chapter file is `0042.md` (so `resolveTargetChapterNumber()` returns `42`)
- **THEN** the rendered fragment SHALL contain the literal string `42` at the chapter-number position (e.g. `第 42 章`) and SHALL NOT contain the unrendered placeholder `{{ chapter_number }}` nor the legacy `${chapter_number}` placeholder

#### Scenario: Instruction tells LLM the chapter number rather than asking
- **WHEN** the rendered fragment is inspected
- **THEN** it SHALL contain wording that asserts the chapter number to the LLM (e.g. "本次生成的是第 N 章，請在摘要中使用此編號")
- **AND** it SHALL NOT contain wording that asks the LLM to determine, infer, count, or otherwise compute the chapter number itself

#### Scenario: Fragment Vento render failure falls back to raw content
- **WHEN** a plugin fragment file contains invalid Vento syntax
- **THEN** the engine SHALL log a warning identifying the variable name, the owning plugin name, the fragment file path, and the render error message
- **AND** the raw fragment content SHALL be used in place of the failed render

#### Scenario: LLM produces chapter with summary
- **WHEN** the LLM generates a chapter response following the injected instruction
- **THEN** the chapter file SHALL contain the story text followed by a `<chapter_summary>` tag with a concise structured summary

#### Scenario: LLM ignores summary instruction
- **WHEN** the LLM generates a chapter response without a `<chapter_summary>` tag
- **THEN** the system SHALL function normally — the chapter is treated as having no summary, and full text is used in context assembly

### Requirement: Chapter summary tag stripping

The context-compaction plugin SHALL declare `chapter_summary` in its `promptStripTags` configuration and SHALL declare `chapter_summary` in its `displayStripTags` configuration to strip the `<chapter_summary>` tag from display. The backend `stripPromptTags()` function SHALL remove `<chapter_summary>` tags from chapter content when building `previous_context` for recent chapters (L2 layer). The frontend SHALL not render the `<chapter_summary>` tag content to the reader.

#### Scenario: Backend strips summary from recent chapters
- **WHEN** `stripPromptTags()` processes a chapter containing a `<chapter_summary>` tag
- **THEN** the `<chapter_summary>...</chapter_summary>` block SHALL be removed from the chapter text in `previous_context`

#### Scenario: Frontend hides summary from reader
- **WHEN** the frontend renders a chapter containing a `<chapter_summary>` tag
- **THEN** the `<chapter_summary>` content SHALL not be visible to the reader

### Requirement: Tiered context assembly

During prompt assembly, the context-compaction plugin SHALL replace the default `previous_context` array with a tiered structure via the `prompt-assembly` hook:
- **L2 (recent chapters)**: The most recent N chapters (configurable, default 3) SHALL be included as full original text with `<chapter_summary>` tags already stripped by `stripPromptTags()`.
- **L1 (summary band)**: Chapters older than the L2 window that contain a `<chapter_summary>` tag SHALL be represented by the extracted summary content only, replacing the full chapter text.
- **L0 (global summary)**: The extracted `<chapter_summary>` contents from all L1 chapters SHALL be concatenated in chronological order and prepended to `previous_context` as the first element, wrapped in `<story_summary>` tags.

The plugin SHALL access both the stripped `previousContext` (from the hook context) and the raw chapter contents (from the chapter files) to extract `<chapter_summary>` content from older chapters.

Chapters without `<chapter_summary>` tags that fall outside the L2 window SHALL be included as full original text (fallback behavior).

#### Scenario: All three tiers present
- **WHEN** a story has 20 chapters, chapters 1-17 contain `<chapter_summary>` tags, and L2 window is 3
- **THEN** `previous_context` SHALL contain: concatenated summaries of chapters 1-17 wrapped in `<story_summary>` tags as first element, followed by full stripped text for chapters 18-20

#### Scenario: No summaries available (fallback)
- **WHEN** a story has chapters but none contain `<chapter_summary>` tags
- **THEN** `previous_context` SHALL contain all chapter full texts with tags stripped, identical to the behavior without the plugin

#### Scenario: Partial summaries available
- **WHEN** chapters 1-5 contain `<chapter_summary>` tags, chapters 6-8 do not, and chapters 9-10 are in L2 window
- **THEN** `previous_context` SHALL contain: concatenated summaries of chapters 1-5 wrapped in `<story_summary>` tags, full text for chapters 6-8 (no summary fallback), and full stripped text for chapters 9-10 (L2 window)

#### Scenario: Story with fewer chapters than L2 window
- **WHEN** a story has 2 chapters and the L2 window is 3
- **THEN** all chapters SHALL be included as full stripped text (entire story fits in L2 window), and no summary extraction SHALL occur

### Requirement: Compaction configuration

The context-compaction plugin SHALL support configuration via the following layers, applied in this precedence order (highest first):

1. **Story-level YAML**: `playground/{series}/{name}/compaction-config.yaml` — selected as a single block if present.
2. **Series-level YAML**: `playground/{series}/compaction-config.yaml` — selected as a single block if no story-level YAML is present **as a valid (non-array) object**. Empty, scalar, array, or malformed story-level YAML is treated as absent and series-level YAML applies.
3. **Engine-managed plugin settings (global)**: persisted by the engine at `playground/_plugins/context-compaction/config.json`, edited via the reader's auto-rendered settings page (driven by the plugin's `settingsSchema`).
4. **Built-in defaults**: `recentChapters: 3`, `enabled: true`.

YAML-vs-YAML semantics SHALL remain all-or-nothing: story YAML and series YAML are mutually exclusive — if story-level YAML exists, series-level YAML SHALL NOT be consulted. The plugin-settings layer SHALL sit *under* the chosen YAML (or under defaults if no YAML exists) and SHALL fill in fields the chosen YAML omits via field-level merge. The defaults layer SHALL fill in fields neither the YAML nor the plugin settings layer specify.

Configuration SHALL support the following fields: `recentChapters` (positive integer, default 3, the L2 window size) and `enabled` (boolean, default true, allows disabling compaction per story/series). Each layer SHALL be sanitised before merging — non-positive integers and non-boolean values SHALL be dropped (treated as if absent) so the next-lower layer fills in.

The plugin SHALL read the engine-managed settings file on each `prompt-assembly` invocation (per chat turn) so that a UI edit takes effect on the very next turn without restart or cache invalidation. A missing settings file or malformed JSON SHALL be treated as an empty plugin-settings layer; malformed JSON SHALL produce a WARN-level log entry but SHALL NOT abort the request.

#### Scenario: Story-level YAML overrides series-level YAML

- **WHEN** both story-level and series-level `compaction-config.yaml` exist with different `recentChapters` values
- **THEN** the story-level value SHALL be used
- **AND** series-level YAML SHALL NOT contribute any fields, even those omitted by the story-level YAML

#### Scenario: Story YAML overrides plugin settings UI

- **GIVEN** the user has set `recentChapters: 7` in the reader's settings UI
- **AND** the story-level `compaction-config.yaml` contains `recentChapters: 2`
- **WHEN** a chat turn is processed for that story
- **THEN** the effective `recentChapters` SHALL be `2`

#### Scenario: Plugin settings UI fills in fields omitted by chosen YAML

- **GIVEN** the story-level `compaction-config.yaml` contains only `recentChapters: 5` (no `enabled` field)
- **AND** the user has set `enabled: false` in the reader's settings UI
- **WHEN** a chat turn is processed for that story
- **THEN** the effective config SHALL be `{ recentChapters: 5, enabled: false }`

#### Scenario: Plugin settings UI applies when no YAML is present

- **GIVEN** no `compaction-config.yaml` exists at story or series level
- **AND** the user has set `recentChapters: 5` and `enabled: true` in the reader's settings UI
- **WHEN** a chat turn is processed
- **THEN** the effective config SHALL be `{ recentChapters: 5, enabled: true }`

#### Scenario: Defaults apply when neither YAML nor UI is set

- **WHEN** no `compaction-config.yaml` exists at story or series level
- **AND** the user has not edited the reader's settings UI for this plugin (no `playground/_plugins/context-compaction/config.json` file)
- **THEN** the plugin SHALL use default values: `recentChapters: 3`, `enabled: true`

#### Scenario: Compaction disabled via story YAML

- **WHEN** story-level `compaction-config.yaml` contains `enabled: false`
- **THEN** the plugin SHALL not modify `previous_context`, behaving as if the plugin is not loaded
- **AND** the plugin settings UI value for `enabled` SHALL be ignored for this story

#### Scenario: Compaction disabled via plugin settings UI

- **GIVEN** no YAML files exist for the story or series
- **AND** the user has set `enabled: false` in the reader's settings UI
- **WHEN** a chat turn is processed
- **THEN** the plugin SHALL not modify `previous_context`, behaving as if the plugin is not loaded

#### Scenario: UI edit takes effect on next turn

- **GIVEN** a chat turn just completed using the previous `recentChapters` value
- **WHEN** the user opens the plugin settings page, changes `recentChapters` from `3` to `6`, and saves
- **AND** a new chat turn is processed
- **THEN** the new turn SHALL use `recentChapters: 6` without any backend restart or cache invalidation step

#### Scenario: Existing YAML-only setups behave identically

- **GIVEN** the plugin settings file `playground/_plugins/context-compaction/config.json` does not exist (user has never edited the UI)
- **AND** a story-level or series-level `compaction-config.yaml` exists with any combination of fields
- **WHEN** a chat turn is processed
- **THEN** the effective config SHALL be byte-for-byte identical to what `loadCompactionConfig()` would have produced before this change

#### Scenario: Malformed plugin settings JSON does not break the request

- **GIVEN** `playground/_plugins/context-compaction/config.json` exists but contains invalid JSON
- **WHEN** a chat turn is processed
- **THEN** the plugin SHALL log a WARN-level message and treat the plugin-settings layer as empty
- **AND** the request SHALL succeed using YAML (if present) or defaults

#### Scenario: Out-of-range value in persisted config.json is sanitised at read time

- **GIVEN** `playground/_plugins/context-compaction/config.json` contains `{ "recentChapters": 0, "enabled": true }` (e.g., manually edited on disk)
- **AND** no YAML files exist
- **WHEN** a chat turn is processed
- **THEN** the effective `recentChapters` SHALL fall through to the next layer (defaults: `3`)
- **AND** the effective `enabled` SHALL be `true` (the boolean field is sanitised independently)

### Requirement: Plugin settings schema declaration

The `context-compaction` plugin's `plugin.json` manifest SHALL declare a top-level `settingsSchema` (JSON Schema draft-07, `type: "object"`) exposing the `recentChapters` and `enabled` configuration fields to the engine's `plugin-settings` capability so the reader auto-renders a settings page for them.

The schema SHALL define:

- `recentChapters` — `type: "integer"`, `minimum: 1`, `default: 3`, with zh-TW `title` and `description` explaining the L2 window size. The `minimum: 1` declaration is documentation and a UI rendering hint; the engine's current validator does not enforce it. Runtime safety SHALL be provided by sanitisation in `config.ts` (non-positive values fall through to the next-lower layer).
- `enabled` — `type: "boolean"`, `default: true`, with zh-TW `title` and `description` explaining that disabling makes the plugin a no-op.

The schema's `default` values SHALL be identical to the values in the plugin's in-code `DEFAULTS` constant so that an unedited UI matches built-in behaviour exactly.

#### Scenario: Settings page is auto-rendered

- **WHEN** the reader navigates to the plugin settings page for `context-compaction`
- **THEN** the page SHALL show two controls: an integer input for `recentChapters` (with `min="1"` from the schema) and a boolean toggle for `enabled`, each with the zh-TW label and help text from the schema

#### Scenario: GET returns defaults when nothing persisted

- **GIVEN** the user has never edited the plugin's settings (no `playground/_plugins/context-compaction/config.json` file)
- **WHEN** the reader loads the settings page
- **THEN** `GET /api/plugins/context-compaction/settings` SHALL return a body containing `recentChapters: 3` and `enabled: true` (the schema defaults, merged by the engine's plugin-settings handler)

#### Scenario: PUT validates type and persists

- **WHEN** the reader sends `PUT /api/plugins/context-compaction/settings` with body `{ "recentChapters": 5, "enabled": true }`
- **THEN** the engine SHALL validate the body's types against `settingsSchema` and persist it to `playground/_plugins/context-compaction/config.json`

#### Scenario: PUT rejects wrong types

- **WHEN** the reader sends `PUT /api/plugins/context-compaction/settings` with body `{ "recentChapters": "five" }`
- **THEN** the engine SHALL reject the request with a validation error
- **AND** no change SHALL be written to `playground/_plugins/context-compaction/config.json`

#### Scenario: Schema defaults match code defaults

- **WHEN** the test suite compares `settingsSchema.properties.recentChapters.default` and `settingsSchema.properties.enabled.default` to the `DEFAULTS` constant exported from `config.ts`
- **THEN** the values SHALL be identical

### Requirement: Plugin registration

The context-compaction plugin SHALL register as a `full-stack` type plugin with:
1. A `promptFragments` entry injecting the chapter summary instruction into the system prompt.
2. A `promptStripTags` entry declaring `chapter_summary` for backend tag stripping.
3. A `backendModule` that exports a `register(hookDispatcher)` function registering a `prompt-assembly` handler (priority 100) for tiered context assembly.
4. A `displayStripTags` entry declaring `chapter_summary` for frontend display stripping.

#### Scenario: Prompt-assembly hook registration
- **WHEN** the plugin is loaded by the plugin manager
- **THEN** it SHALL register a `prompt-assembly` hook handler at priority 100

#### Scenario: Tag stripping registered
- **WHEN** the plugin is loaded by the plugin manager
- **THEN** `chapter_summary` SHALL be included in the combined strip tag patterns used by `stripPromptTags()`

#### Scenario: Frontend module loaded
- **WHEN** the plugin is loaded in the frontend
- **THEN** the frontend SHALL strip `<chapter_summary>` tags from rendered chapter content
