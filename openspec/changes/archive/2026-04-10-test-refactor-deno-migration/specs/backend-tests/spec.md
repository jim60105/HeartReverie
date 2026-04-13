## ADDED Requirements

### Requirement: Utility function tests
Unit tests SHALL cover all pure utility functions: `isValidParam()`, `safePath()`, `validateTemplate()`, `levenshtein()`, `findClosestMatch()`, `stripPromptTags()`, `escapeRegex()`, `isValidPluginName()`, `isPathContained()`.

#### Scenario: Path traversal rejection
- **WHEN** `isValidParam()` receives a string containing `..` or null bytes
- **THEN** it returns `false`

#### Scenario: Template validation accepts safe expressions
- **WHEN** `validateTemplate()` receives a template with only simple variables, for-of loops, if/else, and pipe filters
- **THEN** it returns no errors

#### Scenario: Template validation rejects unsafe expressions
- **WHEN** `validateTemplate()` receives a template with function calls, property access, or `process.env`
- **THEN** it returns an error describing the rejected expression

### Requirement: Middleware tests
Unit tests SHALL cover the `verifyPassphrase` middleware with correct, incorrect, and missing passphrase scenarios.

#### Scenario: Correct passphrase
- **WHEN** the middleware receives a request with the correct `X-Passphrase` header
- **THEN** it calls `next()` without error

#### Scenario: Missing passphrase
- **WHEN** the middleware receives a request without the `X-Passphrase` header
- **THEN** it responds with HTTP 401 and an RFC 9457 Problem Details body

### Requirement: Route handler tests
Integration tests SHALL cover all API route handlers with mocked file system and plugin dependencies.

#### Scenario: List series
- **WHEN** a GET request is sent to `/api/stories` with valid auth
- **THEN** the response contains an array of series directory names

#### Scenario: Chat endpoint validation
- **WHEN** a POST request to `/api/stories/:series/:name/chat` has an empty or missing `message` field
- **THEN** the response is HTTP 400 with an appropriate error detail

### Requirement: Plugin system tests
Unit tests SHALL cover `PluginManager` methods: `getStripTagPatterns()`, `getPromptVariables()`, `getParameters()`, and manifest validation logic.

#### Scenario: Strip tag pattern generation
- **WHEN** plugins declare both plain tag names and regex patterns in `stripTags`
- **THEN** `getStripTagPatterns()` returns a combined RegExp that matches all declared patterns

#### Scenario: Invalid plugin name rejection
- **WHEN** a plugin directory name contains path traversal characters
- **THEN** the plugin is skipped with a warning log

### Requirement: Prompt pipeline tests
Unit tests SHALL cover `renderSystemPrompt()` and `buildPromptFromStory()` with mocked file system and Vento engine.

#### Scenario: System prompt rendering with plugin variables
- **WHEN** `renderSystemPrompt()` is called with plugin variables
- **THEN** the rendered output contains the injected variable values

#### Scenario: First round detection
- **WHEN** all chapter files are empty
- **THEN** `buildPromptFromStory()` sets `isFirstRound` to `true`

### Requirement: Error helper tests
Unit tests SHALL cover `problemJson()` helper and `buildVentoError()` output format.

#### Scenario: Problem Details format
- **WHEN** `problemJson()` is called with status 404 and detail message
- **THEN** the response body matches RFC 9457 format with `type`, `title`, `status`, and `detail` fields
