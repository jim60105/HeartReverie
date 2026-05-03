## MODIFIED Requirements

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
