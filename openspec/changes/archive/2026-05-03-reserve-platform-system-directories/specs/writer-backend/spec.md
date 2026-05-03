## MODIFIED Requirements

### Requirement: Story directory listing

The server SHALL expose `GET /api/stories` to list story series directories under `playground/`. The server SHALL expose `GET /api/stories/:series` to list story name directories under `playground/:series/`. Directory listings SHALL exclude hidden files/directories (those starting with `.`), non-directory entries, and system-reserved directories (underscore-prefixed directories such as `_lore`/`_prompts`, plus the exact literals `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, and `.fseventsd`).

#### Scenario: List all story series
- **WHEN** a client sends `GET /api/stories`
- **THEN** the server SHALL return a JSON array of directory names found directly under `playground/`, excluding hidden directories, underscore-prefixed directories (e.g., `_lore/`, `_prompts/`), and reserved platform directories (e.g., `lost+found/`, `$RECYCLE.BIN/`, `System Volume Information/`)

#### Scenario: List stories within a series
- **WHEN** a client sends `GET /api/stories/:series` with a valid series name
- **THEN** the server SHALL return a JSON array of directory names found under `playground/:series/`, excluding hidden directories, underscore-prefixed directories (e.g., `_lore/`), and reserved platform directories (e.g., `lost+found/`, `$RECYCLE.BIN/`, `System Volume Information/`)

#### Scenario: Series not found
- **WHEN** a client sends `GET /api/stories/:series` with a non-existent series name
- **THEN** the server SHALL return HTTP 404

### Requirement: Reserved directory name validation
The server SHALL reject series and story identifiers that are system-reserved in all endpoints that accept series or story parameters. System-reserved identifiers SHALL include names starting with `_` (underscore) and the exact, case-sensitive literals `lost+found`, `$RECYCLE.BIN`, `System Volume Information`, `.Spotlight-V100`, `.Trashes`, and `.fseventsd` after standard URL decoding of the path segment.

#### Scenario: Reject underscore-prefixed series name
- **WHEN** a client sends a request with series parameter set to `_lore` or any other underscore-prefixed name
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject underscore-prefixed story name
- **WHEN** a client sends a request with story parameter set to `_lore` or any other underscore-prefixed name in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject literal lost+found series name
- **WHEN** a client sends a request with series parameter set to `lost+found` in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject literal lost+found story name
- **WHEN** a client sends a request with story parameter set to `lost+found` in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject URL-encoded lost+found series name
- **WHEN** a client sends a request where the series path segment is `lost%2Bfound`
- **THEN** the server SHALL treat the decoded value as `lost+found` and return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject literal Windows system series name
- **WHEN** a client sends a request with series parameter set to `$RECYCLE.BIN` or `System Volume Information` in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject literal macOS system story name
- **WHEN** a client sends a request with story parameter set to `.Spotlight-V100`, `.Trashes`, or `.fseventsd` in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved
