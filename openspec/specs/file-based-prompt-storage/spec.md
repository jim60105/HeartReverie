# File-Based Prompt Storage

## Purpose

Backend file-based persistence for custom prompt templates, providing PUT/DELETE/GET endpoints for the `PROMPT_FILE` path with fallback to the default `system.md`.
## Requirements
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

### Requirement: Read template with fallback

`GET /api/template` SHALL read the custom prompt file at `PROMPT_FILE` first. If the custom file does not exist, it SHALL fall back to `system.md` at `ROOT_DIR`. The response SHALL include a `source` field indicating `"custom"` or `"default"`.

#### Scenario: Custom file exists
- **WHEN** a client sends `GET /api/template` and the file at `PROMPT_FILE` exists
- **THEN** the server SHALL return `{ "content": "<file content>", "source": "custom" }`

#### Scenario: Custom file missing, fallback to system.md
- **WHEN** a client sends `GET /api/template` and no file exists at `PROMPT_FILE`
- **THEN** the server SHALL return `{ "content": "<system.md content>", "source": "default" }`

### Requirement: readTemplate prompt-file helper canonical home is a library module

The `readTemplate` helper — which reads the custom prompt file at `PROMPT_FILE` and falls back to `system.md` under `ROOT_DIR` when the custom file does not exist (returning `{ content, source: "custom" | "default" }`) — SHALL reside canonically in the library module `writer/lib/prompt-file.ts`. Its signature and read-with-fallback behavior SHALL be unchanged from the prior implementation: it SHALL read `config.PROMPT_FILE`; on `Deno.errors.NotFound` it SHALL read `system.md` under `config.ROOT_DIR` and report `source: "default"`; any other error SHALL be rethrown.

A re-export `export { readTemplate } from "../lib/prompt-file.ts";` SHALL be retained from `writer/routes/prompt.ts` so existing importers (including the prompt GET/PUT route handlers) continue to resolve `readTemplate` without call-site changes.

#### Scenario: Custom prompt file is read when present

- **WHEN** `readTemplate` is called and a file exists at `config.PROMPT_FILE`
- **THEN** it SHALL return `{ content: <file content>, source: "custom" }`

#### Scenario: Fallback to system.md when custom file missing

- **WHEN** `readTemplate` is called and no file exists at `config.PROMPT_FILE` (`Deno.errors.NotFound`)
- **THEN** it SHALL read `system.md` under `config.ROOT_DIR` and return `{ content: <system.md content>, source: "default" }`

#### Scenario: Non-NotFound errors propagate

- **WHEN** reading `config.PROMPT_FILE` throws an error other than `Deno.errors.NotFound`
- **THEN** `readTemplate` SHALL rethrow that error and SHALL NOT fall back to `system.md`

#### Scenario: Re-export keeps the routes path working

- **WHEN** a module imports `readTemplate` from `writer/routes/prompt.ts`
- **THEN** the import SHALL resolve via the re-export to the implementation in `writer/lib/prompt-file.ts`, and the prompt GET/PUT route handlers SHALL continue to call `readTemplate` unchanged

### Requirement: Chat route uses server-side prompt

The chat route SHALL read the prompt template from the server-side file (`PROMPT_FILE` with `system.md` fallback) when no `template` body field is provided. The `template` body field SHALL remain supported as an override for backward compatibility but the frontend SHALL stop sending it for normal chat requests.

#### Scenario: Chat without template body uses server-side file
- **WHEN** a client sends `POST /api/stories/:series/:name/chat` without a `template` field in the body
- **THEN** the server SHALL use the prompt template read from `PROMPT_FILE` (or `system.md` fallback) for prompt rendering

#### Scenario: Chat with template body override
- **WHEN** a client sends `POST /api/stories/:series/:name/chat` with a `template` field in the body
- **THEN** the server SHALL use the provided template text (existing behavior preserved)

### Requirement: Template writes use atomic write with backup and symlink rejection

All file writes performed by the templates route SHALL follow the atomic write + backup pattern: (a) copy the existing target (if any) to `<target>.bak`, rotating to `<target>.bak.<timestamp>` if `.bak` already exists; (b) write to a unique temp file `<parent>/.<basename>.tmp.<uuid>` within the realpath-resolved parent directory; (c) `Deno.rename` to the final target. If the target exists and is a symlink (verified via `Deno.lstat`), the write SHALL be rejected with status `400`.

#### Scenario: Write creates backup before overwrite

- **GIVEN** `system.md` exists
- **WHEN** the templates route writes new content
- **THEN** `system.md.bak` exists with the prior content
- **AND** `system.md` contains the new content
- **AND** no intermediate temp file remains in the parent directory

#### Scenario: Second write rotates backup

- **GIVEN** `system.md.bak` already exists from a prior write
- **WHEN** a second write succeeds
- **THEN** a file named `system.md.bak.<timestamp>` is created
- **AND** the prior `.bak` is preserved

#### Scenario: Symlink target is rejected

- **GIVEN** `system.md` is a symlink to another file
- **WHEN** the templates route attempts to write
- **THEN** the response is `400`
- **AND** the symlink and its target are unchanged

#### Scenario: Concurrent writes never produce partial content

- **WHEN** two `PUT /api/templates` requests race against the same target with different sources A and B
- **THEN** the final file contents are byte-for-byte equal to exactly one of A or B (no partial writes, no torn renames)
- **AND** at least one of `.bak` or `.bak.<ts>` files exists containing some prior version
- **AND** no temp file remains

> Note: with two concurrent writers, the `.bak` chain is best-effort — the exact prior content captured by each `.bak` depends on interleaving. Implementations SHOULD serialize writes per target via an in-process mutex keyed on the resolved absolute path to keep `.bak` deterministic; this MUST NOT block reads.

### Requirement: Plugin fragment paths are never writable

The templates route SHALL refuse any `PUT /api/templates` whose `templatePath` begins with `plugin:` (after path whitelisting) with status `403`. The route SHALL NOT support "Save As" to a different location, fork-and-overlay, or any other indirect write mechanism that produces a plugin-fragment override.

#### Scenario: Plugin path PUT returns 403

- **WHEN** the caller posts `PUT /api/templates` with `templatePath: "plugin:thinking:fragments/think.md"`
- **THEN** the response status is `403`
- **AND** no file under any plugin directory is modified

### Requirement: Lore passage paths are writable via lore: prefix

The templates route SHALL accept writes targeting `templatePath: "lore:global:<rel>"`, `"lore:series:<series>:<rel>"`, or `"lore:story:<series>:<story>:<rel>"`. The resolved absolute path SHALL be:

- `lore:global:<rel>` → `${PLAYGROUND_DIR}/_lore/<rel>`
- `lore:series:<series>:<rel>` → `${PLAYGROUND_DIR}/<series>/_lore/<rel>`
- `lore:story:<series>:<story>:<rel>` → `${PLAYGROUND_DIR}/<series>/<story>/_lore/<rel>`

Each `<series>` and `<story>` segment SHALL be validated (no path separators, no `..`). The final path SHALL pass `isPathContained` + `Deno.realPath` containment under the corresponding scope root and SHALL reject `..` traversal. Writes SHALL follow the same atomic write + backup + symlink rejection pattern.

#### Scenario: Series-scoped lore write succeeds

- **GIVEN** `playground/demo/_lore/character/alice.md` exists
- **WHEN** the caller posts `PUT /api/templates` with `templatePath: "lore:series:demo:character/alice.md"` and valid source
- **THEN** the file is updated atomically
- **AND** the `.bak` backup is created

#### Scenario: Story-scoped lore write succeeds

- **GIVEN** `playground/demo/ch01/_lore/scene/opening.md` exists
- **WHEN** the caller posts `PUT /api/templates` with `templatePath: "lore:story:demo:ch01:scene/opening.md"` and valid source
- **THEN** the file is updated atomically

#### Scenario: Traversal in lore path rejected

- **WHEN** the caller posts with `templatePath: "lore:global:../etc/passwd"`
- **THEN** the response status is `400`
- **AND** no file outside the lore directory is touched

#### Scenario: Invalid series segment rejected

- **WHEN** the caller posts with `templatePath: "lore:series:../evil:alice.md"`
- **THEN** the response status is `400`

