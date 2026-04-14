# Delta Spec: writer-backend

## ADDED Requirements

### Requirement: Dynamic template variable collection from plugins

The `PluginManager` SHALL support collecting dynamic template variables from plugin backend modules. Plugin modules MAY export a `getDynamicVariables(context)` function. During template rendering, the `PluginManager` SHALL call each module's `getDynamicVariables` with `{ series, name, storyDir }` and merge the returned `Record<string, unknown>` into the Vento template context.

#### Scenario: Plugin provides dynamic variables
- **WHEN** a plugin backend module exports `getDynamicVariables`
- **AND** `renderSystemPrompt()` is called for series "fantasy" and story "quest"
- **THEN** `PluginManager.getDynamicVariables({ series: "fantasy", name: "quest", storyDir })` SHALL call the module's `getDynamicVariables` and include its returned variables in the Vento template context

#### Scenario: Plugin getDynamicVariables throws
- **WHEN** a plugin's `getDynamicVariables` throws an error
- **THEN** `PluginManager` SHALL log a warning and skip that plugin's variables without aborting the render

#### Scenario: No plugins export getDynamicVariables
- **WHEN** no loaded plugins export `getDynamicVariables`
- **THEN** `PluginManager.getDynamicVariables()` SHALL return an empty object and template rendering SHALL proceed normally

#### Scenario: Multiple plugins provide dynamic variables
- **WHEN** two or more plugins export `getDynamicVariables` returning overlapping variable names
- **THEN** the first-loaded plugin's value SHALL be kept for the conflicting key
- **AND** a warning SHALL be logged for the conflict

## MODIFIED Requirements

### Requirement: Status endpoint removed (not moved)

The `GET /api/stories/:series/:name/status` endpoint SHALL be removed from `writer/routes/chapters.ts`. The endpoint is unused by the frontend and is dropped entirely rather than moved to a plugin.

#### Scenario: Status endpoint no longer in chapters route module
- **WHEN** `writer/routes/chapters.ts` is examined
- **THEN** it SHALL NOT contain a handler for `GET /api/stories/:series/:name/status`

### Requirement: Prompt construction pipeline (status_data removed from core)

The `buildPromptFromStory()` function in `writer/lib/story.ts` SHALL no longer call `loadStatus()` or pass `status` to `renderSystemPrompt()`. The `loadStatus()` function SHALL be removed from `writer/lib/story.ts`. The `statusContent` field SHALL be removed from the `BuildPromptResult` interface.

The `renderSystemPrompt()` function in `writer/lib/template.ts` SHALL no longer accept `status` in `RenderOptions` and SHALL no longer pass `status_data` as a core variable. Instead, it SHALL call `pluginManager.getDynamicVariables({ series, name, storyDir })` and spread the result into the Vento context, where the state plugin will have provided `status_data`.

#### Scenario: buildPromptFromStory without loadStatus
- **WHEN** `buildPromptFromStory()` is called
- **THEN** it SHALL NOT call `loadStatus()` or include `statusContent` in its return value

#### Scenario: renderSystemPrompt uses plugin dynamic variables
- **WHEN** `renderSystemPrompt()` is called for a series/story
- **THEN** the Vento template context SHALL include dynamic variables from `pluginManager.getDynamicVariables()`
- **AND** SHALL NOT include a hardcoded `status_data` core variable

#### Scenario: First round prompt construction without status_data
- **WHEN** a chat request is made and no chapters exist
- **THEN** the server SHALL pass `previous_context` as empty, `isFirstRound` as `true`, and `plugin_prompts` as collected — but SHALL NOT pass `status_data` as a core variable (it comes from the plugin's dynamic variables)

#### Scenario: Subsequent round prompt construction without status_data
- **WHEN** a chat request is made and chapters exist
- **THEN** the server SHALL pass chapter contexts and prompt fragments — but SHALL NOT pass `status_data` as a core variable

### Requirement: Core parameter declarations (status_data removed)

The `getParameters()` method in `PluginManager` SHALL no longer include `status_data` in the core parameters list. The `status_data` parameter is now declared by the `state` plugin's manifest and appears as a plugin-provided parameter.

#### Scenario: Core parameters exclude status_data
- **WHEN** `pluginManager.getParameters()` is called
- **THEN** the returned array SHALL NOT contain an entry with `{ name: "status_data", source: "core" }`

#### Scenario: status_data appears as plugin parameter
- **WHEN** `pluginManager.getParameters()` is called and the state plugin is loaded
- **THEN** the returned array SHALL contain an entry with `{ name: "status_data", source: "state" }`

### Requirement: Dynamic known-variables for error suggestions (status_data removed from hardcoded list)

The hardcoded known-variables array in `writer/lib/errors.ts` SHALL no longer include `"status_data"`. The variable is now discoverable via the plugin's `parameters` declaration and will be included in Levenshtein suggestions through the `extraKnownVars` mechanism when the state plugin is loaded.

#### Scenario: Hardcoded known vars exclude status_data
- **WHEN** `buildVentoError()` constructs the known-variables list
- **THEN** the hardcoded array SHALL NOT contain `"status_data"`

#### Scenario: status_data still gets suggestions when plugin loaded
- **WHEN** the state plugin is loaded and a template references `{{ staus_data }}` (typo)
- **THEN** the error handler SHALL still suggest `status_data` because it is included via plugin parameters in `extraKnownVars`

### Requirement: Prompt preview endpoint (status_data display adapted)

The `GET /api/stories/:series/:name/preview-prompt` handler in `writer/routes/prompt.ts` SHALL no longer display `status_data` in its `variables` response field as a separate core variable. The preview reflects whatever the rendered template produces — if the state plugin is loaded, `status_data` will be in the rendered output via the plugin's dynamic variables.

#### Scenario: Preview response omits status_data from core variables
- **WHEN** a client calls the preview endpoint
- **THEN** the `variables` object in the response SHALL NOT contain a `status_data` field

### Requirement: StoryEngine interface update

The `StoryEngine` interface in `writer/types.ts` SHALL no longer include the `loadStatus` method. The `BuildPromptResult` interface SHALL no longer include the `statusContent` field. The `RenderOptions` interface SHALL no longer include the `status` field.

#### Scenario: StoryEngine without loadStatus
- **WHEN** `writer/types.ts` is examined
- **THEN** `StoryEngine` SHALL NOT have a `loadStatus` method

#### Scenario: BuildPromptResult without statusContent
- **WHEN** `writer/types.ts` is examined
- **THEN** `BuildPromptResult` SHALL NOT have a `statusContent` field

#### Scenario: RenderOptions without status
- **WHEN** `writer/types.ts` is examined
- **THEN** `RenderOptions` SHALL NOT have a `status` field

### Requirement: PluginModule interface update

The `PluginModule` interface in `writer/types.ts` SHALL add an optional `getDynamicVariables` field.

#### Scenario: PluginModule with getDynamicVariables
- **WHEN** `writer/types.ts` is examined
- **THEN** `PluginModule` SHALL include `getDynamicVariables?: (context: { series: string; name: string; storyDir: string }) => Promise<Record<string, unknown>> | Record<string, unknown>`
