## ADDED Requirements

### Requirement: Stock Deno gitignore coverage

The root `.gitignore` file SHALL include standard Deno ignore patterns in addition to existing project-specific entries. The standard patterns SHALL cover at minimum: Deno cache directories, lock file artifacts, IDE/editor files, and OS-generated files.

#### Scenario: Merged gitignore content
- **WHEN** the root `.gitignore` is updated
- **THEN** it SHALL contain all existing project-specific entries (`.env`, `.certs/`, `playground/`, `**/current-status.yml`, `.coverage/`) plus standard Deno community ignore patterns

### Requirement: Rust project gitignore

The `plugins/state-patches/rust/` directory SHALL have its own `.gitignore` file with standard Rust/Cargo ignore patterns. The root `.gitignore` entry for `plugins/state-patches/rust/target/` SHALL be removed, as the nested `.gitignore` takes ownership of Rust-specific ignores.

#### Scenario: Rust gitignore created
- **WHEN** the Rust project `.gitignore` is created at `plugins/state-patches/rust/.gitignore`
- **THEN** it SHALL contain standard Cargo ignore patterns covering at minimum: `target/`, `**/*.rs.bk`, and Cargo.lock (if applicable to binary projects — note: for binary projects Cargo.lock SHOULD be committed, so it SHALL NOT ignore `Cargo.lock`)

#### Scenario: Root gitignore cleaned up
- **WHEN** the Rust project has its own `.gitignore`
- **THEN** the root `.gitignore` SHALL no longer contain the `plugins/state-patches/rust/target/` entry
