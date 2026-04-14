# Delta Spec: vento-prompt-template

## ADDED Requirements

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

## MODIFIED Requirements

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
