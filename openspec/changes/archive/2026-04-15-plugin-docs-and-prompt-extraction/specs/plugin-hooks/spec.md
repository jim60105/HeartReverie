# Delta Spec: plugin-hooks

## MODIFIED Requirements

### Requirement: Hook stage context documentation

The documentation for hook stage contexts SHALL match the actual codebase implementation:

**`prompt-assembly`** context SHALL be documented as: `{ previousContext, rawChapters, storyDir, series, name }` — where `previousContext` is a mutable string array and `rawChapters` is a string array. The previous documentation listing `{ prompt, variables }` is incorrect.

**`frontend-render`** context SHALL be documented as: `{ text, placeholderMap, options }` — where `text` is a mutable string, `placeholderMap` is a `Map<string, string>`, and `options` is `{ isLastChapter: boolean }`. The previous documentation listing `{ text, element }` is incorrect.

#### Scenario: Documentation matches code for prompt-assembly
- **WHEN** `buildPromptFromStory()` dispatches the `prompt-assembly` hook
- **THEN** the context object SHALL contain `previousContext` (string[]), `rawChapters` (string[]), `storyDir` (string), `series` (string), and `name` (string)

#### Scenario: Documentation matches code for frontend-render
- **WHEN** the frontend hook dispatcher invokes `frontend-render` handlers
- **THEN** the context object SHALL contain `text` (string), `placeholderMap` (Map<string, string>), and `options` ({ isLastChapter: boolean })

### Requirement: Undispatched hook stages documentation

The `response-stream` and `strip-tags` hook stages are defined in `VALID_STAGES` but are not currently dispatched anywhere in the codebase. Documentation SHALL note these stages exist for future use but are not yet active.
