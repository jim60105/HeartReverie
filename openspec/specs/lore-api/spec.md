# Lore API Specification

## Purpose

REST API endpoints for lore passage CRUD operations.

## Requirements

### Requirement: List All Tags
The API SHALL provide an endpoint to retrieve all unique tags across all lore scopes.

#### Scenario: Retrieve all unique tags
- **WHEN** client sends GET request to `/api/lore/tags` with valid authentication
- **THEN** server returns 200 status with JSON array of unique tag strings from all lore passages

#### Scenario: Retrieve tags without authentication
- **WHEN** client sends GET request to `/api/lore/tags` without valid passphrase
- **THEN** server returns 401 status with RFC 9457 Problem Details format

### Requirement: List Passages in Scope
The API SHALL provide an endpoint to list lore passages within a specific scope with optional tag filtering.

#### Scenario: List passages in global scope
- **WHEN** client sends GET request to `/api/lore/global` with valid authentication
- **THEN** server returns 200 status with JSON array of passage metadata (filename, tags, priority, enabled, scope, directory)

#### Scenario: List passages filtered by tag
- **WHEN** client sends GET request to `/api/lore/global?tag=character` with valid authentication
- **THEN** server returns 200 status with JSON array containing only passages that have "character" tag

### Requirement: Read Specific Passage
The API SHALL provide an endpoint to retrieve a specific lore passage by scope and path.

#### Scenario: Read existing passage
- **WHEN** client sends GET request to `/api/lore/global/characters/alice.md` with valid authentication
- **THEN** server returns 200 status with JSON object containing `frontmatter` and `content` fields

#### Scenario: Read non-existent passage
- **WHEN** client sends GET request to `/api/lore/global/nonexistent.md` with valid authentication
- **THEN** server returns 404 status with RFC 9457 Problem Details format

### Requirement: Create or Update Passage
The API SHALL provide an endpoint to create new or update existing lore passages.

#### Scenario: Create new passage
- **WHEN** client sends PUT request to `/api/lore/global/new-character.md` with valid JSON body containing `frontmatter` and `content` fields
- **THEN** server creates the passage file and returns 201 status with success message

#### Scenario: Update existing passage
- **WHEN** client sends PUT request to `/api/lore/global/existing-character.md` with valid JSON body containing updated `frontmatter` and `content`
- **THEN** server updates the passage file and returns 200 status with success message

### Requirement: Delete Passage
The API SHALL provide an endpoint to remove lore passages.

#### Scenario: Delete existing passage
- **WHEN** client sends DELETE request to `/api/lore/global/unwanted-character.md` with valid authentication
- **THEN** server removes the passage file and returns 204 status with no content

#### Scenario: Delete non-existent passage
- **WHEN** client sends DELETE request to `/api/lore/global/nonexistent.md` with valid authentication
- **THEN** server returns 404 status with RFC 9457 Problem Details format

### Requirement: Path Security Validation
The API SHALL validate all path parameters to prevent path traversal attacks and restrict access to markdown files only.

#### Scenario: Attempt path traversal attack
- **WHEN** client sends GET request to `/api/lore/global/../../../etc/passwd` with valid authentication
- **THEN** server returns 400 status with RFC 9457 Problem Details indicating invalid path

#### Scenario: Access non-markdown file
- **WHEN** client sends GET request to `/api/lore/global/config.json` with valid authentication
- **THEN** server returns 400 status with RFC 9457 Problem Details indicating only markdown files are allowed

### Requirement: Scope Parameter Encoding
The API SHALL use explicit scope prefixes in route paths to unambiguously identify the target scope. Global scope routes SHALL use `/api/lore/global/...`, series scope routes SHALL use `/api/lore/series/:series/...`, and story scope routes SHALL use `/api/lore/story/:series/:story/...`. The backend SHALL resolve these route prefixes to co-located `_lore/` directories within the playground tree.

#### Scenario: Global scope routing
- **WHEN** client sends GET request to `/api/lore/global`
- **THEN** server maps to directory `playground/_lore/` and lists its passages

#### Scenario: Series scope routing
- **WHEN** client sends GET request to `/api/lore/series/my-series`
- **THEN** server maps to directory `playground/my-series/_lore/` and lists its passages

#### Scenario: Story scope routing
- **WHEN** client sends GET request to `/api/lore/story/my-series/my-story`
- **THEN** server maps to directory `playground/my-series/my-story/_lore/` and lists its passages

### Requirement: Authentication Required
All lore API endpoints SHALL require valid passphrase authentication using the same mechanism as existing API endpoints.

#### Scenario: Valid authentication header
- **WHEN** client sends request with valid `X-Passphrase` header
- **THEN** server processes the request normally

#### Scenario: Missing authentication header
- **WHEN** client sends request without `X-Passphrase` header
- **THEN** server returns 401 status with RFC 9457 Problem Details format

### Requirement: Error Response Format
The API SHALL return error responses in RFC 9457 Problem Details format for consistency with existing API endpoints.

#### Scenario: Validation error response
- **WHEN** server encounters invalid input data
- **THEN** server returns appropriate HTTP status code with JSON object containing `type`, `title`, `status`, and `detail` fields

#### Scenario: Server error response
- **WHEN** server encounters internal error during processing
- **THEN** server returns 500 status with RFC 9457 Problem Details format without exposing sensitive information
