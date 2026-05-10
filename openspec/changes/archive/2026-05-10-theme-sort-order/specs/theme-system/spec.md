## MODIFIED Requirements

### Requirement: Theme list endpoint

The server SHALL expose `GET /api/themes` returning a JSON array `[{ "id": string, "label": string }, ...]` of every successfully loaded theme. The endpoint SHALL NOT require authentication, parity with `/api/config` historically, so the SPA can render the dropdown before the user enters the passphrase.

The order SHALL be deterministic, following a three-tier priority:
1. The theme with id `default` SHALL always appear first.
2. Other built-in themes (ids: `light`, `dark`) SHALL appear next, sorted alphabetically by `id`.
3. Custom themes (any theme whose id is not in the built-in set `{default, light, dark}`) SHALL appear last, sorted alphabetically by `id`.

The built-in theme ID set SHALL be defined as a constant in the theme module. For ordering purposes, "built-in" is defined solely by theme id membership in this set; the loader does not distinguish repository-shipped files from operator-provided files.

#### Scenario: Lists themes in priority order with default first

- **GIVEN** the server has loaded themes with ids `default`, `light`, `dark`
- **WHEN** a client sends `GET /api/themes`
- **THEN** the response SHALL be HTTP 200 with the array ordered as: `default`, `dark`, `light`

#### Scenario: Custom themes appear after built-in themes

- **GIVEN** the server has loaded themes with ids `default`, `light`, `dark`, `cyberpunk`, `autumn`
- **WHEN** a client sends `GET /api/themes`
- **THEN** the response SHALL be HTTP 200 with the array ordered as: `default`, `dark`, `light`, `autumn`, `cyberpunk`

#### Scenario: Built-in themes remain before custom when default is absent

- **GIVEN** the server has loaded themes with ids `light`, `dark`, `autumn`
- **WHEN** a client sends `GET /api/themes`
- **THEN** the response SHALL be ordered as: `dark`, `light`, `autumn`

#### Scenario: Only custom themes present (no built-in)

- **GIVEN** the theme directory contains only `cyberpunk.toml` and `autumn.toml` (no `default`, `light`, or `dark`)
- **WHEN** a client sends `GET /api/themes`
- **THEN** the response SHALL be HTTP 200 with the array ordered alphabetically: `autumn`, `cyberpunk`

#### Scenario: Endpoint is publicly accessible

- **WHEN** a client sends `GET /api/themes` without an `X-Passphrase` header
- **THEN** the server SHALL respond with HTTP 200 (not 401)

#### Scenario: Empty index returns empty array

- **GIVEN** the theme directory is empty
- **WHEN** a client sends `GET /api/themes`
- **THEN** the response SHALL be HTTP 200 with body `[]`
