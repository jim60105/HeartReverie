## ADDED Requirements

### Requirement: LLM settings tab per story

The settings area SHALL include a new tab registered as a child route of `/settings` at path `llm` (resolving to `/settings/llm`) with `meta.title` set to a Traditional Chinese label such as `LLM 設定`. The route SHALL lazy-load a new `LlmSettingsPage.vue` component. The page SHALL allow the user to select an existing story and edit its LLM parameter overrides (`model`, `temperature`, `frequencyPenalty`, `presencePenalty`, `topK`, `topP`, `repetitionPenalty`, `minP`, `topA`). Each field SHALL render a "use default" toggle; when the toggle is ON, the field SHALL be omitted from the request body sent by Save, and the env default SHALL therefore apply at chat time. Loading and saving SHALL go through a new `useStoryLlmConfig` composable wrapping `GET` and `PUT /api/:series/:name/config`. API errors SHALL be surfaced through the existing toast notification mechanism. All user-facing text SHALL be in Traditional Chinese (zh-TW) to match the rest of the frontend.

#### Scenario: Sidebar exposes the LLM settings tab via route config
- **WHEN** the `/settings/llm` child route is registered with `meta.title: 'LLM 設定'`
- **THEN** the sidebar SHALL render a "LLM 設定" link pointing to `/settings/llm` without any changes to the sidebar template

#### Scenario: Page loads current overrides for the selected story
- **GIVEN** the user is on `/settings/llm` and selects a story whose `_config.json` contains `{ "temperature": 0.7 }`
- **WHEN** the page finishes loading the story config
- **THEN** the temperature field SHALL display `0.7` with its "use default" toggle OFF, and every other field's "use default" toggle SHALL be ON

#### Scenario: Save sends only non-default fields
- **GIVEN** the user has toggled "use default" OFF only for temperature and entered `0.3`
- **WHEN** the user clicks the Save button
- **THEN** the frontend SHALL issue `PUT /api/:series/:name/config` with body `{ "temperature": 0.3 }` and SHALL NOT include any other LLM field

#### Scenario: Toggling "use default" on removes the field on save
- **GIVEN** the form currently has temperature loaded as `0.9` with its "use default" toggle OFF
- **WHEN** the user toggles the temperature "use default" toggle ON and clicks Save
- **THEN** the frontend SHALL issue `PUT /api/:series/:name/config` with body `{}`

#### Scenario: API error surfaces through toast notifications
- **WHEN** the Save request returns a non-2xx response
- **THEN** the page SHALL show an error toast using the existing toast notification mechanism and SHALL leave the form values unchanged so the user can retry
