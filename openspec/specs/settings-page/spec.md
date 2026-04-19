# Settings Page

## Purpose

Dedicated settings page with sidebar navigation and content area for application configuration panels (prompt editor, future settings tabs).

## Requirements

### Requirement: Settings layout with sidebar and content area

The application SHALL provide a `SettingsLayout.vue` component that renders a left sidebar (~200px width) and a content area. The sidebar SHALL contain tab navigation links and a back-to-reader button. The content area SHALL render a `<router-view />` for nested child routes. `SettingsLayout.vue` SHALL be lazy-loaded as the component for the `/settings` parent route.

#### Scenario: Settings layout renders sidebar and content area
- **WHEN** the user navigates to any `/settings/*` route
- **THEN** `SettingsLayout.vue` SHALL render a left sidebar (~200px) and a content area containing the matched child route's component via `<router-view />`

#### Scenario: Sidebar is fixed width on desktop
- **WHEN** the settings page is displayed on a viewport 768px or wider
- **THEN** the sidebar SHALL have a fixed width of approximately 200px and the content area SHALL fill the remaining horizontal space

### Requirement: Sidebar tab navigation with router-link active state

The sidebar SHALL render navigation items as `<router-link>` elements pointing to each settings child route. The active tab SHALL be visually indicated using Vue Router's `active-class` (or `exact-active-class`) prop to apply a highlight style. Sidebar items SHALL be driven by the route configuration (e.g., iterating over the `/settings` route's `children` array or a derived list), making the tab system extensible without modifying the sidebar template.

#### Scenario: Active tab is visually highlighted
- **WHEN** the user is on `/settings/prompt-editor`
- **THEN** the "Prompt Editor" sidebar link SHALL have the active CSS class applied, visually distinguishing it from inactive tabs

#### Scenario: Sidebar items driven by route config
- **WHEN** a new child route is added to the `/settings` route definition
- **THEN** the sidebar SHALL render a corresponding navigation link without requiring changes to `SettingsLayout.vue`'s template

#### Scenario: Clicking a tab navigates to the child route
- **WHEN** the user clicks a sidebar tab link
- **THEN** Vue Router SHALL navigate to the corresponding child route and the content area SHALL render the matched component

### Requirement: Back-to-reader navigation

The sidebar SHALL include a `← 返回閱讀` back button at the top. Clicking the button SHALL call `router.back()`. If there is no browser history to go back to (e.g., the user navigated directly to the settings URL), the button SHALL fall back to navigating to the home route (`/`).

#### Scenario: Back button returns to previous page
- **WHEN** the user navigated from the reader to settings and clicks `← 返回閱讀`
- **THEN** `router.back()` SHALL be called, returning the user to the reader view they came from

#### Scenario: Back button falls back to home route
- **WHEN** the user opened `/settings/prompt-editor` directly (no history) and clicks `← 返回閱讀`
- **THEN** the application SHALL navigate to `/` as a fallback

### Requirement: Settings route redirect to first tab

The `/settings` route (without a child path) SHALL redirect to the first available settings tab. Initially, this SHALL redirect to `/settings/prompt-editor`. The redirect SHALL be defined in the route configuration, not in `SettingsLayout.vue` component logic.

#### Scenario: Bare settings path redirects
- **WHEN** the user navigates to `/settings`
- **THEN** Vue Router SHALL redirect to `/settings/prompt-editor`

#### Scenario: Redirect defined in route config
- **WHEN** the `/settings` route definition is inspected
- **THEN** the redirect SHALL be declared as a `redirect` property on the parent route object, not as imperative navigation in a component

### Requirement: Extensible tab registration

The settings tab system SHALL be extensible by adding new child routes to the `/settings` parent route. Each child route SHALL declare a `meta` object containing at minimum a `title` (string, used as the sidebar display text). The sidebar component SHALL derive its navigation items from the route children's `meta.title` values, ensuring new tabs can be added without modifying the sidebar component.

#### Scenario: New tab added via route config only
- **WHEN** a developer adds a new child route `{ path: 'appearance', component: AppearancePage, meta: { title: '外觀設定' } }` to the `/settings` route
- **THEN** the sidebar SHALL automatically render a "外觀設定" link pointing to `/settings/appearance` without any template changes

#### Scenario: Tab order follows route definition order
- **WHEN** multiple child routes are defined under `/settings`
- **THEN** the sidebar SHALL render tabs in the same order as the children array in the route configuration

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
