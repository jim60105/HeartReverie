# Spec: plugins-prompt-override

> Defines how the HeartReverie_Plugins Containerfile overrides the default system prompt by copying `system.md` to the project root location, ensuring the plugins prompt is the fallback default rather than a custom override.

## Purpose

When extending the HeartReverie base image with optional plugins, the plugins provide their own `system.md` that includes template variables for all plugin-injected prompt fragments. This spec ensures the plugins' prompt replaces the project default at the correct filesystem location so that the backend's two-tier fallback (`PROMPT_FILE` → `ROOT_DIR/system.md`) treats the plugins prompt as the new default.

## ADDED Requirements

### Requirement: Plugins system.md overwrites project default

The `HeartReverie_Plugins/Containerfile` MUST COPY the plugins' `system.md` to `/app/system.md`, overwriting the base HeartReverie default prompt. This ensures that when the custom prompt file (`PROMPT_FILE`) does not exist (e.g., after a reset), the backend falls back to the plugins' prompt rather than the original base prompt.

#### Scenario: Reset falls back to plugins prompt
- **WHEN** the user clicks "reset" in the prompt editor, deleting the custom prompt file
- **THEN** the backend SHALL serve the plugins' `system.md` (at `/app/system.md`) as the default template, including all plugin template variables

#### Scenario: COPY instruction in Containerfile
- **WHEN** the `HeartReverie_Plugins/Containerfile` is examined
- **THEN** it SHALL contain a `COPY` instruction that copies `system.md` to `/app/system.md` with ownership `$UID:0` and mode `664`

### Requirement: No PROMPT_FILE override in plugins image

The `HeartReverie_Plugins/Containerfile` MUST NOT set `ENV PROMPT_FILE`. The default `PROMPT_FILE` path (`playground/_prompts/system.md`) SHALL be used for storing user edits, keeping the custom-edit semantic intact.

#### Scenario: ENV PROMPT_FILE absent
- **WHEN** the `HeartReverie_Plugins/Containerfile` is examined
- **THEN** it SHALL NOT contain any `ENV PROMPT_FILE` instruction

#### Scenario: User edits saved to default custom path
- **WHEN** the user edits and saves the prompt template in the prompt editor
- **THEN** the backend SHALL write the content to the default `PROMPT_FILE` location (`playground/_prompts/system.md`), not to `/app/system.md` or `/app/external-plugins/system.md`
