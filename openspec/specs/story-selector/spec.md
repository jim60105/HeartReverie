# Story Selector

## Purpose

Frontend story browser panel for selecting and creating stories via the backend API.

## Requirements

### Requirement: Series selection

The frontend SHALL display a dropdown populated from `GET /api/stories` that allows the user to select a story series. When a series is selected, the story selection dropdown SHALL be updated to show stories within that series. All fetch requests SHALL include the `X-Passphrase` header via the shared `getAuthHeaders()` function from `passphrase-gate.js`.

#### Scenario: Series dropdown population
- **WHEN** the story selector panel is displayed
- **THEN** the series dropdown SHALL be populated with the list of series returned by `GET /api/stories`, with the `X-Passphrase` header included in the request

#### Scenario: Series selection triggers story list update
- **WHEN** the user selects a series from the dropdown
- **THEN** the frontend SHALL call `GET /api/stories/:series` with the `X-Passphrase` header and populate the story dropdown with the returned story names

### Requirement: Story selection

The frontend SHALL display a dropdown or input for selecting a story name within the currently selected series. The dropdown SHALL be populated from `GET /api/stories/:series`. The user SHALL also be able to type a new story name that does not yet exist.

#### Scenario: Story dropdown population
- **WHEN** a series is selected
- **THEN** the story dropdown SHALL display the available story names for that series

#### Scenario: Custom story name input
- **WHEN** the user types a story name that does not appear in the dropdown
- **THEN** the input SHALL accept the custom name for use with new story creation

### Requirement: New story creation

The frontend SHALL allow the user to create a new story by entering a story name and triggering `POST /api/stories/:series/:name/init`. All fetch requests SHALL include the `X-Passphrase` header via the shared `getAuthHeaders()` function. This SHALL create the story directory and an empty `001.md` file. After creation, the story SHALL be automatically selected and loaded.

#### Scenario: Create a new story
- **WHEN** the user enters a new story name and triggers creation
- **THEN** the frontend SHALL POST to `/api/stories/:series/:name/init` with the `X-Passphrase` header, and upon success, load the newly created story

#### Scenario: Create story that already exists
- **WHEN** the user triggers creation for a story name that already exists
- **THEN** the frontend SHALL load the existing story without error (the backend returns HTTP 200 without modifying existing files)

### Requirement: Story loading

When a story is selected (either from the dropdown or after creation), the frontend SHALL fetch chapters from the backend API and render them in the reader view. This SHALL function as an alternative to the existing File System Access API chooser.

#### Scenario: Load story from backend
- **WHEN** the user selects a story from the story selector
- **THEN** the frontend SHALL fetch chapter list from `GET /api/stories/:series/:name/chapters`, fetch each chapter's content, and render them in the reader view

#### Scenario: Switch between stories
- **WHEN** the user selects a different story while one is already loaded
- **THEN** the frontend SHALL clear the current story content and load the newly selected story
