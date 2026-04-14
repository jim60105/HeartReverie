# Delta Spec: gitignore-config

## MODIFIED Requirements

### Requirement: Rust project gitignore

The `plugins/state/rust/` directory SHALL have its own `.gitignore` file with standard Rust/Cargo ignore patterns. The root `.gitignore` entry for `plugins/state/rust/target/` SHALL be removed, as the nested `.gitignore` takes ownership of Rust-specific ignores.

#### Scenario: Rust gitignore created
- **WHEN** the Rust project `.gitignore` is created at `plugins/state/rust/.gitignore`
- **THEN** it SHALL contain standard Cargo ignore patterns covering at minimum: `target/`, `**/*.rs.bk`, and Cargo.lock (if applicable to binary projects — note: for binary projects Cargo.lock SHOULD be committed, so it SHALL NOT ignore `Cargo.lock`)

#### Scenario: Root gitignore cleaned up
- **WHEN** the Rust project has its own `.gitignore`
- **THEN** the root `.gitignore` SHALL no longer contain the `plugins/state/rust/target/` entry
