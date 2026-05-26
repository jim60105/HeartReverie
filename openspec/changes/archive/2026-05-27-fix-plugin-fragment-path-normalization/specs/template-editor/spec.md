## MODIFIED Requirements

### Requirement: Plugin-fragment template paths SHALL reject script-y and markup extensions

`resolveTemplatePath()` SHALL reject any `plugin:<name>:<rel>` template path whose `<rel>` portion either ends (case-insensitively) in one of `.js`, `.mjs`, `.cjs`, `.html`, `.htm`, `.svg`, OR — after stripping any leading `./` segments — contains any path segment whose first character is `.`, OR contains any path segment equal to `..`. Rejection SHALL result in HTTP `400` from the consuming endpoint. This is defense-in-depth: the `PUT /api/templates` route already refuses plugin-fragment writes with `403`, but the GET surface is read-allowed and the constraint prevents the editor from inadvertently exposing executable assets or traversing outside the plugin directory through the template channel.

The reject list SHALL NOT block other extensions (e.g. `.md`, `.vento`, `.txt`) that plugin authors legitimately use for fragments.

Plugin-fragment relative paths in `promptFragments[].file` MAY use a leading `./` prefix per the Node.js relative-import convention, matching the examples documented in `docs/plugin-system.md` and `docs/prompt-template.md`. The resolver SHALL normalize any number of leading `./` segments off the relative path before applying the dotfile-segment rejection, so that `./snippet.md` is accepted as equivalent to `snippet.md`. The `..` rejection SHALL be a segment-equals check (a path segment whose entire value is `..`), not a substring check, so legitimate file names containing two consecutive dots (e.g. `foo..bar.md`) are not falsely rejected; the post-resolution `isPathContained()` check remains the authoritative guard against directory escape.

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

#### Scenario: Plugin-fragment path with leading ./ accepted

- **GIVEN** plugin `thinking` ships `T-task.md` at its plugin root
- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:./T-task.md`
- **THEN** the response status is `200` and `source` contains the fragment contents

#### Scenario: Plugin-fragment path with leading ./ on nested file accepted

- **GIVEN** plugin `thinking` ships `fragments/think.md`
- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:./fragments/think.md`
- **THEN** the response status is `200` and `source` contains the fragment contents

#### Scenario: Plugin-fragment path with dotfile segment after ./ rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:./.env`
- **THEN** the response status is `400`

#### Scenario: Plugin-fragment path with dotfile segment in a nested directory rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:foo/.git/bar.md`
- **THEN** the response status is `400`

#### Scenario: Plugin-fragment path with bare .. segment rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:..`
- **THEN** the response status is `400`

#### Scenario: Plugin-fragment path with ../ traversal rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:../escape.md`
- **THEN** the response status is `400`

#### Scenario: Plugin-fragment path with embedded .. segment rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:foo/../bar.md`
- **THEN** the response status is `400`

#### Scenario: Plugin-fragment path with compound dots in filename accepted

- **GIVEN** plugin `thinking` ships `foo..bar.md` at its plugin root
- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:foo..bar.md`
- **THEN** the response status is `200` and `source` contains the fragment contents

#### Scenario: Plugin-fragment path that normalizes to empty rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:./` (or `plugin:thinking:././`, or any all-`./` sequence)
- **THEN** the response status is `400` with `detail: "Plugin path is empty"`
- **AND** the resolver SHALL NOT call `Deno.readTextFile()` on the plugin directory itself

#### Scenario: Plugin-fragment path with backslash leading marker rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:.\foo.md` (backslash form of leading current-dir)
- **THEN** the response status is `400`
- **AND** the resolver SHALL NOT normalize backslash-separated leading markers; plugin-fragment paths are forward-slash-only per Node convention

#### Scenario: Plugin-fragment path with interior ./ segment rejected

- **WHEN** the caller `GET /api/templates/source?templatePath=plugin:thinking:sub/./foo.md`
- **THEN** the response status is `400` (the interior `.` segment fails the dotfile-segment check; only **leading** `./` markers are stripped during normalization)
