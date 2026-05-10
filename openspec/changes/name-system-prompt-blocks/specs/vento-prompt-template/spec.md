## ADDED Requirements

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

## MODIFIED Requirements

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
