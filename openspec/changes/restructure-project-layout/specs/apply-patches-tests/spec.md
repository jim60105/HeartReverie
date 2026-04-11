## MODIFIED Requirements

### Requirement: Test organization
Tests SHALL be organized into module-specific `#[cfg(test)]` blocks within each source module, not concentrated in a single test file. The Rust crate SHALL reside at `plugins/apply-patches/rust/`.

#### Scenario: Tests distributed across modules
- **WHEN** the source tree is examined
- **THEN** each module containing testable logic SHALL have its own `#[cfg(test)] mod tests` block

#### Scenario: Integration tests separate from unit tests
- **WHEN** the source tree is examined
- **THEN** integration tests SHALL reside in the `plugins/apply-patches/rust/tests/` directory, separate from unit test modules

#### Scenario: Cargo test invocation
- **WHEN** `cargo test` is run from `plugins/apply-patches/rust/`
- **THEN** all unit and integration tests SHALL execute and pass
