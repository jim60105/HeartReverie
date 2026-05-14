## ADDED Requirements

### Requirement: Template editor and prompt editor have distinct responsibilities

The writer-mode UI SHALL ship two distinct settings pages: `/settings/prompt-editor` (existing) for editing chat-history message cards and the engine system prompt with the existing card UI, and `/settings/template-editor` (new) for editing template source code (Vento) with lint and preview. The two routes SHALL be reachable from the SettingsLayout sidebar as independent entries. Plugin promptFragments and lore passages SHALL be edited only via the new template-editor; they SHALL NOT appear in the prompt-editor's tree.

#### Scenario: Both routes appear in sidebar

- **WHEN** the user opens `/settings`
- **THEN** the sidebar shows both "Prompt Editor" and "Template Editor" entries

#### Scenario: Plugin fragments not listed in prompt-editor

- **WHEN** the user opens `/settings/prompt-editor`
- **THEN** the listed templates contain only `system.md` (and overrides)
- **AND** plugin fragments and lore passages are absent
