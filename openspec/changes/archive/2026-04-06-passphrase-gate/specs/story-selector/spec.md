## MODIFIED Requirements

### Requirement: Series selection

The frontend SHALL display a dropdown populated from `GET /api/stories` that allows the user to select a story series. When a series is selected, the story selection dropdown SHALL be updated to show stories within that series. All fetch requests SHALL include the `X-Passphrase` header via the shared `getAuthHeaders()` function from `passphrase-gate.js`.

#### Scenario: Series dropdown population
- **WHEN** the story selector panel is displayed
- **THEN** the series dropdown SHALL be populated with the list of series returned by `GET /api/stories`, with the `X-Passphrase` header included in the request

#### Scenario: Series selection triggers story list update
- **WHEN** the user selects a series from the dropdown
- **THEN** the frontend SHALL call `GET /api/stories/:series` with the `X-Passphrase` header and populate the story dropdown with the returned story names

### Requirement: New story creation

The frontend SHALL allow the user to create a new story by entering a story name and triggering `POST /api/stories/:series/:name/init`. All fetch requests SHALL include the `X-Passphrase` header via the shared `getAuthHeaders()` function. This SHALL create the story directory and an empty `001.md` file. After creation, the story SHALL be automatically selected and loaded.

#### Scenario: Create a new story
- **WHEN** the user enters a new story name and triggers creation
- **THEN** the frontend SHALL POST to `/api/stories/:series/:name/init` with the `X-Passphrase` header, and upon success, load the newly created story
