# Story Selector

## Purpose

Frontend story browser panel for selecting and creating stories via the backend API.

## Requirements

### Requirement: Series selection

The frontend SHALL display a `StorySelector.vue` component containing a dropdown populated from `GET /api/stories` that allows the user to select a story series. The series list and selected series SHALL be managed as reactive state within the `useStorySelector()` composable. When a series is selected, the story selection dropdown SHALL be updated reactively to show stories within that series. All fetch requests SHALL include the `X-Passphrase` header via the `getAuthHeaders()` function from the `useAuth()` composable.

#### Scenario: Series dropdown population
- **WHEN** the `StorySelector.vue` component is mounted
- **THEN** the `useStorySelector()` composable SHALL fetch the list of series from `GET /api/stories` with the `X-Passphrase` header and populate the reactive `seriesList` ref, which the component renders as dropdown options

#### Scenario: Series selection triggers story list update
- **WHEN** the user selects a series from the dropdown (bound via `v-model` to the reactive `selectedSeries` ref)
- **THEN** the `useStorySelector()` composable SHALL call `GET /api/stories/:series` with the `X-Passphrase` header and update the reactive `storyList` ref, which the component renders as story dropdown options

### Requirement: Story selection

The `StorySelector.vue` component SHALL display a dropdown or input for selecting a story name within the currently selected series, bound to the reactive `selectedStory` ref from the `useStorySelector()` composable. The dropdown SHALL be populated reactively from the composable's `storyList` ref. The user SHALL also be able to type a new story name that does not yet exist.

#### Scenario: Story dropdown population
- **WHEN** a series is selected and the `storyList` ref updates
- **THEN** the story dropdown SHALL reactively display the available story names for that series

#### Scenario: Custom story name input
- **WHEN** the user types a story name that does not appear in the dropdown
- **THEN** the input SHALL accept the custom name for use with new story creation

### Requirement: New story creation

The `StorySelector.vue` component SHALL allow the user to create a new story by entering a story name and triggering `POST /api/stories/:series/:name/init`. All fetch requests SHALL include the `X-Passphrase` header via the `getAuthHeaders()` function from the `useAuth()` composable. This SHALL create the story directory and an empty `001.md` file. After creation, the story SHALL be automatically selected and loaded — the auto-load after create behavior SHALL be preserved.

#### Scenario: Create a new story
- **WHEN** the user enters a new story name and triggers creation
- **THEN** the composable SHALL POST to `/api/stories/:series/:name/init` with the `X-Passphrase` header, and upon success, auto-select and load the newly created story

#### Scenario: Create story that already exists
- **WHEN** the user triggers creation for a story name that already exists
- **THEN** the frontend SHALL load the existing story without error (the backend returns HTTP 200 without modifying existing files)

### Requirement: Story loading

When a story is selected (either from the dropdown or after creation), the `StorySelector.vue` component SHALL navigate to the story route `/:series/:story` using `router.push()` instead of emitting a `load` event. The router navigation SHALL trigger `useChapterNav()` to load chapters from the backend via route param watching. This replaces the event-based loading pattern with route-based navigation.

#### Scenario: Load story from backend via router
- **WHEN** the user selects a story from the story selector
- **THEN** the `StorySelector.vue` component SHALL call `router.push({ name: 'story', params: { series, story } })` to navigate to the story route, and the `useChapterNav()` composable SHALL react to the route params to load chapters

#### Scenario: Switch between stories via router
- **WHEN** the user selects a different story while one is already loaded
- **THEN** the component SHALL call `router.push()` for the new story route, and `useChapterNav()` SHALL detect the route param change, clear current state, and load the newly selected story

#### Scenario: Story creation navigates to new story
- **WHEN** a new story is successfully created via `POST /api/stories/:series/:name/init`
- **THEN** the component SHALL call `router.push()` to navigate to the new story route instead of emitting a `load` event

### Requirement: useStorySelector composable

The `useStorySelector()` composable SHALL manage story selection state using Vue's Composition API. It SHALL expose: a reactive `seriesList` ref (string array of available series), a reactive `storyList` ref (string array of stories in selected series), a reactive `selectedSeries` ref (string), a reactive `selectedStory` ref (string), a `fetchSeries(): Promise<void>` method, a `fetchStories(series: string): Promise<void>` method, and a `createStory(series: string, name: string): Promise<void>` method. All API calls within the composable SHALL use `getAuthHeaders()` from `useAuth()`. The composable SHALL watch the route's `:series` and `:story` params and sync `selectedSeries` and `selectedStory` refs accordingly, enabling the story selector UI to reflect the current route state.

#### Scenario: Composable provides reactive state
- **WHEN** `useStorySelector()` is called from the `StorySelector.vue` component
- **THEN** the component SHALL receive reactive refs for `seriesList`, `storyList`, `selectedSeries`, and `selectedStory` that drive the template bindings

#### Scenario: API calls include auth headers
- **WHEN** the composable fetches series or stories from the backend
- **THEN** all fetch requests SHALL include the `X-Passphrase` header obtained from `useAuth().getAuthHeaders()`

#### Scenario: Route params sync to composable state
- **WHEN** the user navigates to `/my-series/my-story` via URL or browser history
- **THEN** the composable SHALL detect the route params and set `selectedSeries` to `'my-series'` and `selectedStory` to `'my-story'`, updating the story selector UI

### Requirement: StorySelector component events

The `StorySelector.vue` component SHALL use `router.push()` for story navigation instead of emitting a `load` event. The `defineEmits` for the `load` event SHALL be removed. The component SHALL import `useRouter()` from `vue-router` to perform programmatic navigation.

#### Scenario: Story selection navigates via router
- **WHEN** the user selects a story from the dropdown
- **THEN** the component SHALL call `router.push({ name: 'story', params: { series: selectedSeries, story: selectedStory } })` instead of emitting a `load` event

#### Scenario: Story creation navigates via router
- **WHEN** a new story is successfully created via `POST /api/stories/:series/:name/init`
- **THEN** the component SHALL call `router.push()` to navigate to the new story's route

### Requirement: Collapsed toggle label after story selection

The `StorySelector.vue` `<summary>` element SHALL render its label dynamically based on whether a backend story is currently selected. When `selectedStory` is the empty string, the summary SHALL render the visible text `📖 故事選擇` and SHALL NOT set an `aria-label` (the visible text already labels the control). When `selectedStory` is a non-empty string (a story is selected), the summary SHALL render only the glyph `📖` and the `<summary>` element itself SHALL set `aria-label="故事選擇"` so assistive technologies still announce the control's purpose. The glyph itself MAY be marked `aria-hidden="true"` so it is not announced twice.

The collapsed and expanded summary forms SHALL share the same `themed-btn selector-toggle` styling so the toggle does not visually shift between forms — only the rendered text differs.

#### Scenario: Full label when no story selected

- **WHEN** the `StorySelector.vue` is mounted with `selectedStory === ""`
- **THEN** the summary SHALL render the visible text `📖 故事選擇` and SHALL NOT carry an `aria-label` attribute

#### Scenario: Glyph-only label after story selected

- **WHEN** the user picks a story from the dropdown and `selectedStory` becomes a non-empty string
- **THEN** the summary SHALL render only the glyph `📖` and the `<summary>` element itself SHALL carry `aria-label="故事選擇"`

#### Scenario: Label restores after story is cleared

- **WHEN** `selectedStory` reverts to the empty string (e.g., user clears the selection)
- **THEN** the summary SHALL re-render the full `📖 故事選擇` label and the `aria-label` attribute SHALL be removed
