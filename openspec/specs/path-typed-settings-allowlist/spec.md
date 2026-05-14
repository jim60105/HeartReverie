# path-typed-settings-allowlist

## Purpose

Defines the hard-coded path-root sandbox for `format: "path"` settings, the per-field `x-path-roots` narrowing keyword, the realpath-based check enforced at `PUT` time, and the schema-meta endpoint contract that the frontend `PathPickerWidget` uses to constrain its picker UI.

## Requirements

### Requirement: Hard-coded path root allowlist

The engine SHALL define a hard-coded set of path roots that any setting of `type: string, format: path` is allowed to reference. The default set SHALL be:

- `playground/lore/`
- `playground/chapters/`
- `<PLAYGROUND_DIR>/_plugins/<pluginName>/` (per-plugin sandbox)

A path is considered "within a root" when, after resolution to an absolute realpath (with symlinks followed), its prefix equals the root's realpath and the next character is either the path separator or end-of-string.

#### Scenario: Path inside an allowed root is accepted

- **GIVEN** a string field `format: "path"`
- **WHEN** the client sends `PUT` with value `playground/lore/intro.md`
- **THEN** the server SHALL accept the field as valid

#### Scenario: Path outside all roots is rejected on PUT

- **GIVEN** the same field
- **WHEN** the client sends `PUT` with value `../../../etc/passwd`
- **THEN** the server SHALL respond `400` with a validation error keyword `format`, `params.format = "path"`, and a message identifying the violated root constraint

### Requirement: Plugin-narrowed `x-path-roots` intersects the hard-coded set

A `format: "path"` field MAY declare an `x-path-roots: string[]` array specifying which subset of roots the field is allowed to reference. The effective root set for that field SHALL be the **intersection** of the hard-coded set and `x-path-roots`. `x-path-roots` SHALL NOT widen the allowlist.

The plugin manager SHALL reject a manifest at load time when `x-path-roots` is declared but is not an array of strings.

When the intersection is empty, the plugin manager SHALL reject the manifest at load time with an error identifying the offending field.

#### Scenario: `x-path-roots` narrows to a subset

- **GIVEN** a field declares `x-path-roots: ["playground/lore/"]`
- **WHEN** the client sends `PUT` with value `playground/chapters/c1.md`
- **THEN** the server SHALL respond `400` because `playground/chapters/` is excluded by the field's narrower allowlist

#### Scenario: Empty intersection is rejected at manifest load

- **GIVEN** a field declares `x-path-roots: ["/etc/"]` (which has no overlap with the hard-coded set)
- **WHEN** the plugin manager loads the manifest
- **THEN** the manager SHALL reject the manifest with an error citing the empty intersection for that field

### Requirement: Schema-meta exposes hard-coded roots; widgets intersect per-field

`GET /api/plugins/:name/settings/schema-meta` SHALL return the hard-coded path root list as `pathRoots: string[]`. It SHALL NOT enumerate per-field narrowing.

The frontend `PathPickerWidget` SHALL compute the effective allowlist for each field as the intersection of `schemaMeta.pathRoots` with the field's `x-path-roots` (when declared). When `x-path-roots` is absent, the effective list equals `schemaMeta.pathRoots`. The widget's file/directory picker UI SHALL constrain navigation to this intersected set.

#### Scenario: Widget restricts picker to field's narrowed roots

- **GIVEN** `schemaMeta.pathRoots = ["playground/lore/", "playground/chapters/", "playground/_plugins/foo/"]`
- **AND** the field declares `x-path-roots: ["playground/lore/"]`
- **WHEN** the `PathPickerWidget` renders
- **THEN** its navigable root list SHALL be exactly `["playground/lore/"]`

### Requirement: Realpath check at PUT-time

The server SHALL resolve each `format: "path"` value via the filesystem's realpath at `PUT` time before deciding allow/deny. Symlinks within `playground/` that resolve outside the allowed roots SHALL be rejected.

The check SHALL NOT require that the path exist; non-existent paths are accepted when their parent's realpath is within a root.

#### Scenario: Symlink escaping the sandbox is rejected

- **GIVEN** `playground/lore/escape` is a symlink to `/etc/passwd`
- **WHEN** the client sends `PUT` with value `playground/lore/escape`
- **THEN** the server SHALL respond `400` with a `format` validation error

#### Scenario: Non-existent path inside a root is accepted

- **GIVEN** `playground/lore/new-file.md` does not exist but `playground/lore/` does
- **WHEN** the client sends `PUT` with that value
- **THEN** the server SHALL accept the field as valid
