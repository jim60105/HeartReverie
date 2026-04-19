## MODIFIED Requirements

### Requirement: Stock Deno gitignore coverage

The root `.gitignore` file SHALL include standard Deno ignore patterns in addition to existing project-specific entries. The standard patterns SHALL cover at minimum: Deno cache directories, lock file artifacts, IDE/editor files, and OS-generated files.

#### Scenario: Merged gitignore content
- **WHEN** the root `.gitignore` is updated
- **THEN** it SHALL contain all existing project-specific entries (`.env`, `.certs/`, `playground/`, `**/current-status.yaml`, `.coverage/`) plus standard Deno community ignore patterns
