## MODIFIED Requirements

### Requirement: Story directory listing

The server SHALL expose `GET /api/stories` to list story series directories under `playground/`. The server SHALL expose `GET /api/stories/:series` to list story name directories under `playground/:series/`. Directory listings SHALL exclude hidden files/directories (those starting with `.`), non-directory entries, and system-reserved directories (those starting with `_`, such as `_lore` and `_prompts`).

#### Scenario: List all story series
- **WHEN** a client sends `GET /api/stories`
- **THEN** the server SHALL return a JSON array of directory names found directly under `playground/`, excluding hidden directories and any underscore-prefixed directories (e.g., `_lore/`, `_prompts/`)

#### Scenario: List stories within a series
- **WHEN** a client sends `GET /api/stories/:series` with a valid series name
- **THEN** the server SHALL return a JSON array of directory names found under `playground/:series/`, excluding hidden directories and any underscore-prefixed directories (e.g., `_lore/`)

#### Scenario: Series not found
- **WHEN** a client sends `GET /api/stories/:series` with a non-existent series name
- **THEN** the server SHALL return HTTP 404
