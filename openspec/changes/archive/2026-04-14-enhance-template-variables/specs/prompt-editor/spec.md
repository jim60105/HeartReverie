## MODIFIED Requirements

### Requirement: Variable insertion pills

The editor SHALL display clickable pills above the textarea showing all available Vento template variables. Clicking a pill SHALL insert the `{{ variable_name }}` reference at the current cursor position in the textarea via a component method. Pills SHALL be color-coded by source type: blue for core variables, green for plugin-contributed variables, and amber/gold for lore-contributed variables. The `scenario` variable SHALL NOT appear in the core pills (it was replaced by the lore codex system). Lore pills SHALL be dynamically fetched based on the current story context and SHALL update when the story context changes.

#### Scenario: Display variable pills with three color categories
- **WHEN** the `PromptEditor.vue` component loads with an active story context that has lore passages
- **THEN** it SHALL fetch variables from `GET /api/plugins/parameters` and render them as clickable pill buttons with blue for core, green for plugin, and amber/gold for lore variables

#### Scenario: Insert variable from pill
- **WHEN** the user clicks a variable pill
- **THEN** the component method SHALL insert `{{ variable_name }}` at the textarea cursor position and update the `v-model` ref accordingly

#### Scenario: scenario variable not present in pills
- **WHEN** the pills are rendered from the parameters endpoint response
- **THEN** no pill with the variable name `scenario` SHALL be displayed

#### Scenario: Lore pills update on story context change
- **WHEN** the user switches from story "quest" (with tags ["character", "world"]) to story "journey" (with tags ["location", "npc"])
- **THEN** the lore pills SHALL re-fetch from `GET /api/plugins/parameters` with the new story context and display `lore_all`, `lore_tags`, `lore_location`, and `lore_npc` instead of the previous lore variables

## ADDED Requirements

### Requirement: Lore variable discovery via parameters endpoint

The `GET /api/plugins/parameters` endpoint SHALL accept optional `series` and `story` query parameters. Lore variable inclusion follows a three-tier scope model based on which parameters are provided:
- **No parameters**: lore variables SHALL NOT be included in the response (preserving backward compatibility).
- **`series` only**: the endpoint SHALL include lore variables from global scope (`_lore/`) and series scope (`<series>/_lore/`), with source type `"lore"`.
- **`series` and `story`**: the endpoint SHALL include lore variables from all three scopes — global, series, and story (`<series>/<story>/_lore/`) — with source type `"lore"`.

In all cases where lore variables are included, `lore_all`, `lore_tags`, and all applicable `lore_<tag>` variables SHALL be present.

#### Scenario: Parameters endpoint returns lore variables with full story context
- **WHEN** a request is made to `GET /api/plugins/parameters?series=fantasy&story=quest` and the story has lore passages with tags ["character", "world"]
- **THEN** the response SHALL include lore variables from global, series, and story scopes — `lore_all`, `lore_tags`, `lore_character`, and `lore_world` with source type `"lore"`, in addition to existing core and plugin variables

#### Scenario: Parameters endpoint with series-only context returns global and series lore
- **WHEN** a request is made to `GET /api/plugins/parameters?series=fantasy` (without `story`) and the global scope has a passage tagged "rules" and the series scope has a passage tagged "world"
- **THEN** the response SHALL include lore variables from global and series scopes — `lore_all`, `lore_tags`, `lore_rules`, and `lore_world` with source type `"lore"` — but SHALL NOT include any story-scope lore variables

#### Scenario: Parameters endpoint without story context omits lore variables
- **WHEN** a request is made to `GET /api/plugins/parameters` without `series` or `story` query parameters
- **THEN** the response SHALL include only core and plugin variables, with no lore variables present

#### Scenario: Parameters endpoint with empty lore scope
- **WHEN** a request is made to `GET /api/plugins/parameters?series=empty&story=none` and no lore passages exist for that story context
- **THEN** the response SHALL include `lore_all` and `lore_tags` with source type `"lore"` (as they are always available) but no dynamic `lore_<tag>` variables

### Requirement: Frontend re-fetch on story context change

The frontend SHALL re-fetch parameters from `GET /api/plugins/parameters` whenever the active story context changes, passing the current `series` and `story` as query parameters. This ensures that lore pills reflect the lore passages available for the currently selected story. An `AbortController` SHALL be used to cancel any in-flight parameter request when the story context changes, preventing stale-response races where a slow earlier response overwrites a newer one.

#### Scenario: Re-fetch triggered on story selection
- **WHEN** the user selects a different story in the story selector
- **THEN** the prompt editor SHALL re-fetch `GET /api/plugins/parameters?series=<new_series>&story=<new_story>` and update the displayed pills accordingly

#### Scenario: Re-fetch clears stale lore pills
- **WHEN** the story context changes from a story with lore tags ["character", "world"] to one with tags ["location"]
- **THEN** the previous lore pills (`lore_character`, `lore_world`) SHALL be removed and replaced with the new lore pills (`lore_all`, `lore_tags`, `lore_location`)

#### Scenario: Rapid story switching aborts in-flight requests
- **WHEN** the user switches from story A to story B and then immediately to story C before the story-B request completes
- **THEN** the in-flight request for story B SHALL be aborted via `AbortController.abort()`, only the story C request SHALL complete, and the displayed pills SHALL reflect story C's lore variables
