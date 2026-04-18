## ADDED Requirements

### Requirement: No per-chapter content requests during initial load
During the initial story load or story switching, the chapter navigation system SHALL NOT make individual `GET /chapters/:num` requests for chapter content. Individual chapter requests are only permitted during HTTP polling fallback for the last chapter's streaming updates.

#### Scenario: Initial load uses only batch endpoint
- **WHEN** a user opens a story URL and the chapters are loaded for the first time
- **THEN** the browser network log SHALL show zero individual `/chapters/:num` requests for chapter content — only the single batch request `/chapters?include=content`

#### Scenario: HTTP polling only fetches last chapter individually
- **WHEN** WebSocket is disconnected and the HTTP polling fallback activates
- **THEN** each poll cycle SHALL make at most 1 request to `/chapters` (count check) and at most 1 request to `/chapters/:lastNum` (last chapter content) — never requests to multiple individual chapter numbers
