## ADDED Requirements

### Requirement: New template-preview endpoint coexists with story preview-prompt

The new `POST /api/templates/preview` endpoint SHALL serve template-editor preview requests with three fixture modes (`default`, `inline`, `current`). The existing `POST /api/stories/:series/:name/preview-prompt` endpoint SHALL continue to serve prompt-editor preview requests unchanged. The two endpoints SHALL NOT share request bodies or response shapes.

#### Scenario: Existing endpoint unchanged

- **WHEN** a client posts `POST /api/stories/demo/ch01/preview-prompt` with the existing body
- **THEN** the response matches the prior shape (no schema change)

#### Scenario: New endpoint accepts fixture parameter

- **WHEN** a client posts `POST /api/templates/preview` with `{ source, fixture: "default", templatePath }`
- **THEN** the response contains `messages`, `variables`, optional `ventoError`, and `fixtureUsed`
- **AND** the response is NOT the prompt-editor shape

### Requirement: Default and inline fixture preview must not perform IO

The `default` and `inline` fixture modes of `POST /api/templates/preview` SHALL render via pure `runString(source, fixtureToContext(fixture))` and SHALL NOT contact `pluginManager`, `storyDir`, or `PLAYGROUND_DIR`. The function `renderSystemPromptForPreview(source, fixture, mode)` SHALL refuse, at the type level, to accept `series`/`story`/`storyDir` when `mode !== "current"`.

#### Scenario: Default mode performs no plugin IO

- **WHEN** a client posts `POST /api/templates/preview` with `fixture: "default"`
- **THEN** server logs show no calls to `pluginManager.getPromptVariables()` or `pluginManager.getDynamicVariables()`
- **AND** no files under `PLAYGROUND_DIR` are read

#### Scenario: Inline mode performs no plugin IO

- **WHEN** a client posts with `fixture: { ...inline JSON... }`
- **THEN** server logs show no plugin pipeline calls and no lore resolution
