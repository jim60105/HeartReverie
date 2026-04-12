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

When a story is selected (either from the dropdown or after creation), the `StorySelector.vue` component SHALL emit a `load` event with the selected series and story name. The parent component SHALL handle this event to fetch chapters from the backend API and render them in the reader view. This SHALL function as an alternative to the existing File System Access API chooser.

#### Scenario: Load story from backend
- **WHEN** the user selects a story from the story selector
- **THEN** the `StorySelector.vue` component SHALL emit a `load` event with `{ series, name }` payload, and the parent component SHALL fetch the chapter list from `GET /api/stories/:series/:name/chapters`, fetch each chapter's content, and render them in the reader view

#### Scenario: Switch between stories
- **WHEN** the user selects a different story while one is already loaded
- **THEN** the component SHALL emit a `load` event for the new story, and the parent SHALL clear the current story content and load the newly selected story

### Requirement: useStorySelector composable

The `useStorySelector()` composable SHALL manage story selection state using Vue's Composition API. It SHALL expose: a reactive `seriesList` ref (string array of available series), a reactive `storyList` ref (string array of stories in selected series), a reactive `selectedSeries` ref (string), a reactive `selectedStory` ref (string), a `fetchSeries(): Promise<void>` method, a `fetchStories(series: string): Promise<void>` method, and a `createStory(series: string, name: string): Promise<void>` method. All API calls within the composable SHALL use `getAuthHeaders()` from `useAuth()`.

#### Scenario: Composable provides reactive state
- **WHEN** `useStorySelector()` is called from the `StorySelector.vue` component
- **THEN** the component SHALL receive reactive refs for `seriesList`, `storyList`, `selectedSeries`, and `selectedStory` that drive the template bindings

#### Scenario: API calls include auth headers
- **WHEN** the composable fetches series or stories from the backend
- **THEN** all fetch requests SHALL include the `X-Passphrase` header obtained from `useAuth().getAuthHeaders()`

### Requirement: StorySelector component events

The `StorySelector.vue` component SHALL use `defineEmits<{ load: [payload: { series: string; name: string }] }>()` to declare a typed `load` event. The component SHALL emit this event when a story is successfully selected or created and ready for loading.

#### Scenario: Typed emit on story selection
- **WHEN** the user selects a story from the dropdown
- **THEN** the component SHALL call `emit('load', { series: selectedSeries, name: selectedStory })` with typed payload

#### Scenario: Typed emit after story creation
- **WHEN** a new story is successfully created via `POST /api/stories/:series/:name/init`
- **THEN** the component SHALL emit `load` with the newly created story's series and name
