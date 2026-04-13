## MODIFIED Requirements

### Requirement: Story directory listing

The server SHALL expose `GET /api/stories` to list story series directories under `playground/`. The server SHALL expose `GET /api/stories/:series` to list story name directories under `playground/:series/`. Directory listings SHALL exclude hidden files/directories (those starting with `.`), non-directory entries, and system-reserved directories (those starting with `_`, such as `_lore`; and `prompts`).

#### Scenario: List all story series
- **WHEN** a client sends `GET /api/stories`
- **THEN** the server SHALL return a JSON array of directory names found directly under `playground/`, excluding hidden directories, the `prompts/` directory, and any underscore-prefixed directories (e.g., `_lore/`)

#### Scenario: List stories within a series
- **WHEN** a client sends `GET /api/stories/:series` with a valid series name
- **THEN** the server SHALL return a JSON array of directory names found under `playground/:series/`, excluding hidden directories and any underscore-prefixed directories (e.g., `_lore/`)

#### Scenario: Series not found
- **WHEN** a client sends `GET /api/stories/:series` with a non-existent series name
- **THEN** the server SHALL return HTTP 404

## ADDED Requirements

### Requirement: Reserved directory name validation
The server SHALL reject directory names starting with `_` (underscore) as series or story identifiers in all endpoints that accept series or story parameters. This prevents collision between user-created directories and system-reserved directories such as `_lore`.

#### Scenario: Reject underscore-prefixed series name
- **WHEN** a client sends a request with series parameter set to `_lore` or any other underscore-prefixed name
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved

#### Scenario: Reject underscore-prefixed story name
- **WHEN** a client sends a request with story parameter set to `_lore` or any other underscore-prefixed name in any endpoint
- **THEN** the server SHALL return HTTP 400 with RFC 9457 Problem Details indicating the name is reserved
