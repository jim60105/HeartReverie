## ADDED Requirements

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
