## MODIFIED Requirements

### Requirement: Story loading

When a story is selected (either from the dropdown or after creation), the `StorySelector.vue` component SHALL load the chosen story into the backend context via `useChapterNav().loadFromBackend()` so that downstream consumers (`folderName` in the header, lore browser at `/settings/lore`, prompt preview at `/settings/prompt-editor`, per-story LLM config, etc.) reflect the selected story.

The component SHALL additionally call `navigateToStory()` (which uses `router.push({ name: 'story', params: { series, story } })`) ONLY when the user is already on a reading route, as determined by `isReadingRoute(route.path)`. When the user is on a `/settings/*` or `/tools/*` route, the component SHALL NOT navigate; the user SHALL remain on their current page with the story now loaded.

The composable call used from settings/tools SHALL pass `{ syncRoute: false }` so that `useChapterNav` does not call `router.replace()` to the chapter route, which would otherwise yank the user away from the settings/tools page they are configuring.

#### Scenario: Load story from settings keeps user on settings page

- **WHEN** the user is on `/settings/prompt-editor` and selects a series + story from `StorySelector` then clicks 載入
- **THEN** `loadFromBackend(series, story, undefined, { syncRoute: false })` SHALL be called, the header `folderName` SHALL update to `series / story`, the URL SHALL remain `/settings/prompt-editor`, and the prompt preview SHALL be able to render with the loaded story's state

#### Scenario: Load story from tools keeps user on tools page

- **WHEN** the user is on `/tools/<any>` and selects a story via `StorySelector` then clicks 載入
- **THEN** `loadFromBackend(...)` SHALL be invoked with `{ syncRoute: false }`, the URL SHALL remain on the tools page, AND `navigateToStory()` SHALL NOT be called

#### Scenario: Create story from settings keeps user on settings page

- **WHEN** the user is on `/settings/lore` and creates a new story via the `StorySelector` form
- **THEN** after `createStory()` resolves, `loadFromBackend(series, newName, undefined, { syncRoute: false })` SHALL be invoked, the URL SHALL remain `/settings/lore`, and the lore browser SHALL reflect the newly created (empty) story's lore directory

#### Scenario: Load story from reader navigates as before

- **WHEN** the user is on `/{series}/{story}/chapter/N` and picks a different story
- **THEN** `loadFromBackend(...)` MAY be invoked OR the route watcher in `useChapterNav` MAY handle the load via the route param change; in either case `navigateToStory(series, story)` SHALL be called and the URL SHALL change to the new story's route

#### Scenario: Header reflects loaded story regardless of origin route

- **WHEN** a story has been loaded via `StorySelector` from any route (reading, settings, or tools)
- **THEN** the header SHALL display `series / story` via the shared `folderName` ref from `useChapterNav`, and SHALL NOT display `尚未選擇故事`
