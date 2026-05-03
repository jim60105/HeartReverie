## MODIFIED Requirements

### Requirement: List All Tags
The API SHALL provide an endpoint to retrieve all unique tags across all lore scopes. While discovering series/story scopes from the playground tree, the server SHALL ignore system-reserved directories (hidden dot-prefixed directories, underscore-prefixed directories, and the exact literals `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, and `.fseventsd`) so non-story filesystem metadata directories are never treated as lore scopes.

#### Scenario: Retrieve all unique tags
- **WHEN** client sends GET request to `/api/lore/tags` with valid authentication
- **THEN** server returns 200 status with JSON array of unique tag strings from all lore passages

#### Scenario: Retrieve tags without authentication
- **WHEN** client sends GET request to `/api/lore/tags` without valid passphrase
- **THEN** server returns 401 status with RFC 9457 Problem Details format

#### Scenario: Skip reserved platform system directories during traversal
- **WHEN** the playground tree contains reserved directories such as `lost+found/`, `$RECYCLE.BIN/`, `System Volume Information/`, `.Spotlight-V100/`, `.Trashes/`, or `.fseventsd/` at series-discovery or story-discovery levels while handling `GET /api/lore/tags`
- **THEN** the server SHALL skip those directories and SHALL NOT include any tags from files reachable only through those reserved paths
