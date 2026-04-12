# File-Based Prompt Storage

## Purpose

Backend file-based persistence for custom prompt templates, providing PUT/DELETE/GET endpoints for the `PROMPT_FILE` path with fallback to the default `system.md`.

## Requirements

### Requirement: Custom prompt file persistence

The backend SHALL persist the user's custom prompt template to a file at the path specified by the `PROMPT_FILE` environment variable. When `PROMPT_FILE` is not set, the default path SHALL be `playground/prompts/system.md` relative to `ROOT_DIR`. The file SHALL be created (including parent directories) on the first `PUT /api/template` request and deleted on `DELETE /api/template`.

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

### Requirement: Read template with fallback

`GET /api/template` SHALL read the custom prompt file at `PROMPT_FILE` first. If the custom file does not exist, it SHALL fall back to `system.md` at `ROOT_DIR`. The response SHALL include a `source` field indicating `"custom"` or `"default"`.

#### Scenario: Custom file exists
- **WHEN** a client sends `GET /api/template` and the file at `PROMPT_FILE` exists
- **THEN** the server SHALL return `{ "content": "<file content>", "source": "custom" }`

#### Scenario: Custom file missing, fallback to system.md
- **WHEN** a client sends `GET /api/template` and no file exists at `PROMPT_FILE`
- **THEN** the server SHALL return `{ "content": "<system.md content>", "source": "default" }`

### Requirement: Chat route uses server-side prompt

The chat route SHALL read the prompt template from the server-side file (`PROMPT_FILE` with `system.md` fallback) when no `template` body field is provided. The `template` body field SHALL remain supported as an override for backward compatibility but the frontend SHALL stop sending it for normal chat requests.

#### Scenario: Chat without template body uses server-side file
- **WHEN** a client sends `POST /api/stories/:series/:name/chat` without a `template` field in the body
- **THEN** the server SHALL use the prompt template read from `PROMPT_FILE` (or `system.md` fallback) for prompt rendering

#### Scenario: Chat with template body override
- **WHEN** a client sends `POST /api/stories/:series/:name/chat` with a `template` field in the body
- **THEN** the server SHALL use the provided template text (existing behavior preserved)
