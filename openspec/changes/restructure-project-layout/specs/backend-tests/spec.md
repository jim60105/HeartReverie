## MODIFIED Requirements

### Requirement: Utility function tests
Unit tests SHALL cover all pure utility functions: `isValidParam()`, `safePath()`, `validateTemplate()`, `levenshtein()`, `findClosestMatch()`, `stripPromptTags()`, `escapeRegex()`, `isValidPluginName()`, `isPathContained()`. Test files SHALL reside in `tests/writer/lib/` with relative imports back to `writer/lib/`.

#### Scenario: Path traversal rejection
- **WHEN** `isValidParam()` receives a string containing `..` or null bytes
- **THEN** it returns `false`

#### Scenario: Template validation accepts safe expressions
- **WHEN** `validateTemplate()` receives a template with only simple variables, for-of loops, if/else, and pipe filters
- **THEN** it returns no errors

#### Scenario: Template validation rejects unsafe expressions
- **WHEN** `validateTemplate()` receives a template with function calls, property access, or `process.env`
- **THEN** it returns an error describing the rejected expression

### Requirement: Route handler tests
Integration tests SHALL cover all API route handlers with mocked file system and plugin dependencies. Test files SHALL reside in `tests/writer/routes/` with relative imports back to `writer/`.

#### Scenario: List series
- **WHEN** a GET request is sent to `/api/stories` with valid auth
- **THEN** the response contains an array of series directory names

#### Scenario: Chat endpoint validation
- **WHEN** a POST request to `/api/stories/:series/:name/chat` has an empty or missing `message` field
- **THEN** the response is HTTP 400 with an appropriate error detail
