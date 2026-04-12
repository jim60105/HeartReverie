## MODIFIED Requirements

### Requirement: Story loading

When a story is selected (either from the dropdown or after creation), the `StorySelector.vue` component SHALL navigate to the story route `/:series/:story` using `router.push()` instead of emitting a `load` event. The router navigation SHALL trigger `useChapterNav()` to load chapters from the backend via route param watching. This replaces the event-based loading pattern with route-based navigation. In FSA mode (no backend story), the existing `loadFromFSA()` flow SHALL remain unchanged since it does not involve routing.

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
