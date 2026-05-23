## ADDED Requirements

### Requirement: Lore template paths SHALL be `.md`-only with no dotfile or empty segments

`parseTemplatePath()` SHALL reject any `lore:<scope>[:<series>[:<story>]]:<rel>` template path whose `<rel>` portion:

- Does not end (case-insensitively) in `.md`, OR
- Contains any empty segment after splitting on `/`, OR
- Contains any segment whose first character is `.` (dotfile segment, at any depth).

A rejected path SHALL produce an HTTP `400` response from any endpoint that consumes the parsed path (`GET /api/templates/source`, `PUT /api/templates`, `POST /api/templates/preview`, `POST /api/templates/lint`). This closes the audit-core F-1 arbitrary-extension-write primitive under `playground/_lore/`.

#### Scenario: Lore path with non-`.md` extension rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=lore:global:foo.html`
- **THEN** the response status is `400`

#### Scenario: Lore path with `.md` extension accepted

- **GIVEN** `playground/_lore/global/foo.md` exists with content "X"
- **WHEN** the caller `GET /api/templates/source?templatePath=lore:global:foo.md`
- **THEN** the response is `{ templatePath: "lore:global:foo.md", source: "X" }`

#### Scenario: Lore path containing dotfile segment rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=lore:global:.hidden/foo.md`
- **THEN** the response status is `400`

#### Scenario: Lore path with empty segment rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=lore:global:foo//bar.md`
- **THEN** the response status is `400`

### Requirement: Plugin-fragment template paths SHALL reject script-y and markup extensions

`resolveTemplatePath()` SHALL reject any `plugin:<name>:<rel>` template path whose `<rel>` portion either ends (case-insensitively) in one of `.js`, `.mjs`, `.cjs`, `.html`, `.htm`, `.svg`, OR contains any segment whose first character is `.`. Rejection SHALL result in HTTP `400` from the consuming endpoint. This is defense-in-depth: the `PUT /api/templates` route already refuses plugin-fragment writes with `403`, but the GET surface is read-allowed and the constraint prevents the editor from inadvertently exposing executable assets through the template channel.

The reject list SHALL NOT block other extensions (e.g. `.md`, `.vento`, `.txt`) that plugin authors legitimately use for fragments.

#### Scenario: Plugin-fragment path with `.js` extension rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:fragments/handler.js`
- **THEN** the response status is `400`

#### Scenario: Plugin-fragment path with `.html` extension rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:fragments/page.html`
- **THEN** the response status is `400`

#### Scenario: Plugin-fragment path with `.md` extension accepted

- **GIVEN** plugin `thinking` ships `fragments/think.md`
- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:fragments/think.md`
- **THEN** the response status is `200` and `source` contains the fragment contents

#### Scenario: Plugin-fragment path with dotfile segment rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:.secret/think.md`
- **THEN** the response status is `400`
