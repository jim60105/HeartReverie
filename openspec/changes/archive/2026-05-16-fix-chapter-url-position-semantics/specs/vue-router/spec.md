## MODIFIED Requirements

### Requirement: Route definitions

The application SHALL define the following routes using Vue Router:

1. `/` — Root route, renders the main reader view (story selector)
2. `/:series/:story` — Story route, loads the specified story and navigates to chapter 1
3. `/:series/:story/chapter/:chapter` — Chapter route, loads the specified story and navigates to the specified chapter position (1-indexed sequential position in sorted order, NOT the `ChapterData.number` field)
4. `/settings` — Settings parent route, renders `SettingsLayout` as its component. SHALL redirect to `/settings/prompt-editor`. `SettingsLayout` SHALL be lazy-loaded via dynamic `import()`.
5. `/settings/prompt-editor` — Settings child route, renders `PromptEditorPage.vue` within the `SettingsLayout`'s `<router-view />`
6. `/tools` — Tools parent route, renders `ToolsLayout` as its component. SHALL redirect to `/tools/new-series`. `ToolsLayout` SHALL be lazy-loaded via dynamic `import()`. Children SHALL be supplied by an exported `toolsChildren: RouteRecordRaw[]` array (parallel to the existing `settingsChildren` pattern).
7. `/tools/new-series` — Tools child route, renders `QuickAddPage.vue` within the `ToolsLayout`'s `<router-view />`. Route name `tools-new-series`. `meta.title = "快速新增"`.
8. `/tools/import-character-card` — Tools child route, renders `ImportCharacterCardPage.vue` within the `ToolsLayout`'s `<router-view />`. Route name `tools-import-character-card`. `meta.title = "ST 角色卡轉換工具"`.

Routes 1–3 SHALL render the same root component (`MainLayout` or equivalent). Route params SHALL be typed as strings and parsed to appropriate types by consuming composables. The `/settings` parent route SHALL use a separate layout component (`SettingsLayout`) that is NOT nested under `MainLayout`. The `/tools` parent route SHALL likewise use its own `ToolsLayout` component, NOT nested under `MainLayout` or `SettingsLayout`.

The `:chapter` parameter in route 3 represents the **1-indexed sequential position** of the chapter in sorted order. It is always an integer from 1 to the total number of chapters. It does NOT correspond to `ChapterData.number` (which is the file-level identifier and may not start from 1 or be contiguous).

#### Scenario: Story route loads story at chapter 1
- **WHEN** the user navigates to `/:series/:story` (e.g., `/my-series/my-story`)
- **THEN** the router SHALL resolve the route with `series` and `story` params, and the application SHALL load the story starting at chapter position 1 (the first chapter in sorted order)

#### Scenario: Chapter route loads specific chapter by position
- **WHEN** the user navigates to `/:series/:story/chapter/:chapter` (e.g., `/my-series/my-story/chapter/3`)
- **THEN** the router SHALL resolve the route with `series`, `story`, and `chapter` params, and the application SHALL navigate to the 3rd chapter in sorted order (0-indexed: `currentIndex = 2`)

#### Scenario: Invalid chapter position defaults to last chapter
- **WHEN** the user navigates to a chapter route where `:chapter` exceeds the total number of chapters
- **THEN** the application SHALL clamp the chapter index to the last available chapter

#### Scenario: Chapter numbers not starting from 1 are transparent to URL
- **WHEN** a story has chapters numbered 29–64 (36 total) and the URL is `/s/n/chapter/1`
- **THEN** the application SHALL display the first chapter (number 29) — the URL "1" means "first in sorted order", not "chapter number 1"
