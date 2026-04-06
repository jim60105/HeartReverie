## ADDED Requirements

### Requirement: Delete last chapter

The server SHALL expose `DELETE /api/stories/:series/:name/chapters/last` that deletes the highest-numbered `.md` chapter file in the story directory. The endpoint SHALL use the same path validation as other story endpoints. After deletion, the server SHALL return HTTP 200 with a JSON body containing the deleted chapter number. If no chapter files exist, the server SHALL return HTTP 404.

#### Scenario: Delete the last chapter file
- **WHEN** a client sends `DELETE /api/stories/:series/:name/chapters/last` and the story directory contains `001.md`, `002.md`, and `003.md`
- **THEN** the server SHALL delete `003.md` and return HTTP 200 with `{ "deleted": 3 }`

#### Scenario: Delete when only one chapter exists
- **WHEN** a client sends `DELETE /api/stories/:series/:name/chapters/last` and the story directory contains only `001.md`
- **THEN** the server SHALL delete `001.md` and return HTTP 200 with `{ "deleted": 1 }`

#### Scenario: Delete when no chapters exist
- **WHEN** a client sends `DELETE /api/stories/:series/:name/chapters/last` and the story directory contains no `.md` chapter files
- **THEN** the server SHALL return HTTP 404

#### Scenario: Path traversal prevention on delete
- **WHEN** a client sends a DELETE request with path parameters containing `..` or other traversal sequences
- **THEN** the server SHALL reject the request with HTTP 400
