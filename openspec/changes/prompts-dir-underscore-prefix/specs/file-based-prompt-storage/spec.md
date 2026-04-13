## MODIFIED Requirements

### Requirement: Custom prompt file persistence

The backend SHALL persist the user's custom prompt template to a file at the path specified by the `PROMPT_FILE` environment variable. When `PROMPT_FILE` is not set, the default path SHALL be `playground/_prompts/system.md` relative to `ROOT_DIR`. The file SHALL be created (including parent directories) on the first `PUT /api/template` request and deleted on `DELETE /api/template`.

#### Scenario: Write custom prompt via PUT
- **WHEN** a client sends `PUT /api/template` with a JSON body `{ "content": "<template text>" }`
- **THEN** the server SHALL validate the template using `validateTemplate()`, write the content to `PROMPT_FILE`, and return HTTP 200 with `{ "ok": true }`

#### Scenario: PUT validation failure
- **WHEN** a client sends `PUT /api/template` with a template containing unsafe expressions
- **THEN** the server SHALL return HTTP 422 with a Problem Details response listing the validation errors and SHALL NOT write the file

#### Scenario: PUT creates parent directories
- **WHEN** a client sends `PUT /api/template` and the parent directory of `PROMPT_FILE` does not exist
- **THEN** the server SHALL create the directory hierarchy recursively before writing the file

#### Scenario: DELETE removes custom prompt
- **WHEN** a client sends `DELETE /api/template`
- **THEN** the server SHALL delete the file at `PROMPT_FILE` (if it exists) and return HTTP 200 with `{ "ok": true }`

#### Scenario: DELETE when no custom file exists
- **WHEN** a client sends `DELETE /api/template` and no file exists at `PROMPT_FILE`
- **THEN** the server SHALL return HTTP 200 with `{ "ok": true }` (idempotent)
