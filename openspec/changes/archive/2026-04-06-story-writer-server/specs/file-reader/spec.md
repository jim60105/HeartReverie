# Spec: file-reader (delta)

> Adds a backend-driven file loading path to the existing file reader, as an alternative to the File System Access API.

## ADDED Requirements

### Requirement: Backend-driven file loading

The reader frontend SHALL support loading chapter files from the backend API (`/api/stories/:series/:name/chapters`) as an alternative to the existing File System Access (FSA) API chooser. When a story is selected via the story selector panel, the frontend SHALL fetch chapters through the backend API instead of requiring the user to pick a local directory. The existing FSA chooser MUST be preserved and SHALL continue to function as before.

#### Scenario: Load chapters from backend API
- **WHEN** a story is selected via the story selector panel
- **THEN** the frontend SHALL call `GET /api/stories/:series/:name/chapters` to list chapters, then fetch each chapter's content via `GET /api/stories/:series/:name/chapters/:number`, and render them in the reader view

#### Scenario: FSA chooser remains functional
- **WHEN** the user clicks the existing FSA directory chooser button
- **THEN** the frontend SHALL use the File System Access API to load chapter files from the local filesystem, exactly as it does today

#### Scenario: Switching between loading modes
- **WHEN** the user loads a story via the backend API and then uses the FSA chooser (or vice versa)
- **THEN** the frontend SHALL clear the previous content and load from the newly selected source without errors

#### Scenario: Backend API unavailable
- **WHEN** the backend API is unreachable or returns an error during chapter loading
- **THEN** the frontend SHALL display an error message and the FSA chooser SHALL remain available as a fallback
