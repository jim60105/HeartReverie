# Vue Router

## MODIFIED Requirements

### Requirement: Route definitions

The router SHALL define the following routes with resource-oriented paths:

1. `/` — Root route, renders the main reader view (story selector / FSA chooser)
2. `/:series/:story` — Story route, loads the specified story and navigates to chapter 1
3. `/:series/:story/chapter/:chapter` — Chapter route, loads the specified story and navigates to the specified chapter (1-indexed)
4. `/settings` — Settings parent route, renders `SettingsLayout` as its component. SHALL redirect to `/settings/prompt-editor`. `SettingsLayout` SHALL be lazy-loaded via dynamic `import()`.
5. `/settings/prompt-editor` — Settings child route, renders `PromptEditorPage.vue` within the `SettingsLayout`'s `<router-view />`

Routes 1–3 SHALL render the same root component (`MainLayout` or equivalent). Route params SHALL be typed as strings and parsed to appropriate types by consuming composables. The `/settings` parent route SHALL use a separate layout component (`SettingsLayout`) that is NOT nested under `MainLayout`.

#### Scenario: Root route renders reader view
- **WHEN** the user navigates to `/`
- **THEN** the router SHALL render the main reader view with the story selector visible

#### Scenario: Story route loads story at chapter 1
- **WHEN** the user navigates to `/:series/:story` (e.g., `/my-series/my-story`)
- **THEN** the router SHALL resolve the route with `series` and `story` params, and the application SHALL load the story starting at chapter 1

#### Scenario: Chapter route loads specific chapter
- **WHEN** the user navigates to `/:series/:story/chapter/:chapter` (e.g., `/my-series/my-story/chapter/3`)
- **THEN** the router SHALL resolve the route with `series`, `story`, and `chapter` params, and the application SHALL navigate to chapter 3 (0-indexed: `currentIndex = 2`)

#### Scenario: Invalid chapter number defaults to last chapter
- **WHEN** the user navigates to a chapter route where `:chapter` exceeds the total number of chapters
- **THEN** the application SHALL clamp the chapter index to the last available chapter

#### Scenario: Settings parent route redirects to first tab
- **WHEN** the user navigates to `/settings`
- **THEN** the router SHALL redirect to `/settings/prompt-editor`

#### Scenario: Settings layout is lazy-loaded
- **WHEN** the `/settings` route is matched for the first time
- **THEN** the `SettingsLayout` component SHALL be loaded via dynamic `import()` (lazy-loading), not included in the initial bundle

#### Scenario: Prompt editor page renders within settings layout
- **WHEN** the user navigates to `/settings/prompt-editor`
- **THEN** the router SHALL render `PromptEditorPage.vue` inside the `SettingsLayout`'s `<router-view />` content area
