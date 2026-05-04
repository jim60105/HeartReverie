## MODIFIED Requirements

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
