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

The context-compaction plugin SHALL support configuration via `compaction-config.yaml` files at two levels:
1. **Story level**: `playground/{series}/{name}/compaction-config.yaml` — highest priority
2. **Series level**: `playground/{series}/compaction-config.yaml` — fallback

If no configuration file exists at either level, the plugin SHALL use default values. Configuration SHALL support the following fields: `recentChapters` (integer, default 3, the L2 window size) and `enabled` (boolean, default true, allows disabling compaction per story/series).

#### Scenario: Story-level config overrides series-level
- **WHEN** both story-level and series-level `compaction-config.yaml` exist with different `recentChapters` values
- **THEN** the story-level value SHALL be used

#### Scenario: No config files exist
- **WHEN** no `compaction-config.yaml` exists at story or series level
- **THEN** the plugin SHALL use default values: `recentChapters: 3`, `enabled: true`

#### Scenario: Compaction disabled via config
- **WHEN** `compaction-config.yaml` contains `enabled: false`
- **THEN** the plugin SHALL not modify `previous_context`, behaving as if the plugin is not loaded

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
