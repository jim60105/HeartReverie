## MODIFIED Requirements

### Requirement: Create or Update Passage
The API SHALL provide an endpoint to create new or update existing lore passages. Before persisting, the API SHALL validate the request body's `content` field against the same Vento SSTI whitelist (`validateTemplate()`) that governs the `PUT /api/templates` write path. A `content` value containing any expression outside the whitelist (e.g. member access, function calls, `__`-prefixed identifiers, or arbitrary JavaScript) SHALL be rejected and the passage SHALL NOT be written to disk.

This closes a privilege-escalation asymmetry: the same on-disk `_lore/*.md` file is writable through both `PUT /api/lore/{scope}/{path}` and `PUT /api/templates` (with a `lore:` template path), but previously only the templates route enforced the whitelist. An attacker who could reach the lore route could store an unsafe Vento body (e.g. `{{ Deno.env.toObject() |> JSON.stringify }}`) that is later executed during prompt assembly. Both write paths SHALL now enforce the identical whitelist.

#### Scenario: Create new passage
- **WHEN** client sends PUT request to `/api/lore/global/new-character.md` with valid JSON body containing `frontmatter` and a whitelist-safe `content` field
- **THEN** server creates the passage file and returns 201 status with success message

#### Scenario: Update existing passage
- **WHEN** client sends PUT request to `/api/lore/global/existing-character.md` with valid JSON body containing updated `frontmatter` and whitelist-safe `content`
- **THEN** server updates the passage file and returns 200 status with success message

#### Scenario: Reject passage body containing unsafe Vento expression
- **WHEN** client sends PUT request to `/api/lore/global/pwn.md` with a `content` field containing an expression outside the SSTI whitelist (e.g. `{{ Deno.env.toObject() |> JSON.stringify }}` or `{{ constructor.constructor }}`)
- **THEN** server SHALL return 422 status with a body listing the offending `expressions`
- **AND** the server SHALL NOT write the passage file to disk

#### Scenario: Reject passage body using the same whitelist as the templates route
- **WHEN** a `content` value would be rejected by `PUT /api/templates` for a `lore:` template path
- **THEN** the identical `content` submitted to `PUT /api/lore/...` SHALL also be rejected, so neither route can be used to bypass the other's SSTI validation
