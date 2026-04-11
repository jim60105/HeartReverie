# state-patches-tests Specification

## Purpose
TBD - created by archiving change apply-patches-test-refactor (now state-patches). Update Purpose after archive.
## Requirements
### Requirement: Unit tests for patch operations
The test suite SHALL include unit tests for all four patch operations (replace, delta, insert, remove) covering happy paths, edge cases, and error conditions.

#### Scenario: Replace operation tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: replace existing value, replace with upsert, replace root, replace sequence element, replace out-of-bounds index error, replace on non-container error

#### Scenario: Delta operation tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: positive delta, negative delta, delta on missing path (treat as 0), delta with string numeric value, delta on non-numeric error, delta on sequence element, delta on root value

#### Scenario: Insert operation tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: insert into mapping, insert with upsert, append to sequence with `-`, insert on empty path error, insert on scalar parent with `-` converts to sequence

#### Scenario: Remove operation tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: remove mapping key, remove sequence element by index, remove non-existent key error, remove out-of-bounds index error, remove on empty path error, remove on non-container error

### Requirement: Unit tests for JSONPatch parsing
The test suite SHALL include unit tests for JSONPatch block extraction and JSON parsing, including the malformed-JSON fallback.

#### Scenario: Well-formed JSON parsing tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: single patch block, multiple patch blocks, no patch blocks returns empty, nested JSON values in operations

#### Scenario: Malformed JSON fallback tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: unescaped quotes in string values are handled, op/path/value fields are extracted correctly, mixed well-formed and malformed entries in same array

### Requirement: Unit tests for YAML navigation
The test suite SHALL include unit tests for `navigate_to_parent` and `descend_or_create` functions.

#### Scenario: Navigation with auto-create tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: descend into existing mapping, auto-create missing intermediate mappings, navigate to parent returns correct parent and final key, single-segment path, multi-segment path

#### Scenario: Navigation without auto-create tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: navigation to missing path returns error when auto_create is false, navigation to existing path succeeds

### Requirement: Unit tests for conversion utilities
The test suite SHALL include unit tests for JSON-to-YAML conversion, parse_path, yaml_to_f64, and f64_to_yaml_number.

#### Scenario: JSON to YAML conversion tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: null, boolean, integer, float, string, array, nested object conversions

#### Scenario: Numeric utility tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: yaml_to_f64 with integer, float, non-number returns None; f64_to_yaml_number stores whole numbers as i64, fractional as f64

#### Scenario: Path parsing tests
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify: simple path `/a/b/c` yields segments, empty segments filtered, root path `/` yields empty vec

### Requirement: Unit tests for file system operations
The test suite SHALL include unit tests for directory scanning and markdown file collection.

#### Scenario: sorted_subdirs tests
- **WHEN** `cargo test` is run using temporary directories
- **THEN** tests SHALL verify: directories are returned in sorted order, non-directory entries are excluded

#### Scenario: collect_numbered_md_files tests
- **WHEN** `cargo test` is run using temporary directories
- **THEN** tests SHALL verify: only files matching `/^\d+\.md$/` are collected, files are sorted numerically (not lexicographically), non-matching files are ignored

### Requirement: Integration tests for end-to-end pipeline
The test suite SHALL include integration tests that verify the full pipeline from directory scanning through patch application to YAML output.

#### Scenario: Full pipeline with fixture data
- **WHEN** `cargo test` is run with a temporary fixture directory containing init-status.yml, sub-directories, and numbered .md files with JSONPatch blocks
- **THEN** the output `current-status.yml` SHALL match the expected patched state

#### Scenario: Multiple sub-directories processed independently
- **WHEN** two sub-directories exist under a scenario directory
- **THEN** each sub-directory's `current-status.yml` SHALL reflect only its own patches applied to the original init-status.yml

#### Scenario: Error recovery in pipeline
- **WHEN** one .md file contains an invalid patch and others are valid
- **THEN** the valid patches SHALL still be applied and `current-status.yml` SHALL reflect the successful operations

### Requirement: Test organization
Tests SHALL be organized into module-specific `#[cfg(test)]` blocks within each source module, not concentrated in a single test file. The Rust crate SHALL reside at `plugins/state-patches/rust/`.

#### Scenario: Tests distributed across modules
- **WHEN** the source tree is examined
- **THEN** each module containing testable logic SHALL have its own `#[cfg(test)] mod tests` block

#### Scenario: Integration tests separate from unit tests
- **WHEN** the source tree is examined
- **THEN** integration tests SHALL reside in the `plugins/state-patches/rust/tests/` directory, separate from unit test modules

#### Scenario: Cargo test invocation
- **WHEN** `cargo test` is run from `plugins/state-patches/rust/`
- **THEN** all unit and integration tests SHALL execute and pass

### Requirement: Test coverage threshold
The test suite SHALL achieve at least 75% line coverage across the `state-patches` crate.

#### Scenario: Coverage meets threshold
- **WHEN** `cargo tarpaulin` or equivalent coverage tool is run
- **THEN** overall line coverage SHALL be at least 75%

#### Scenario: No module below 50% coverage
- **WHEN** per-module coverage is examined
- **THEN** each module containing testable logic SHALL have at least 50% line coverage

### Requirement: Regression tests for security and correctness fixes
The test suite SHALL include regression tests for symlink traversal prevention, multiline malformed-JSON parsing, RFC 6901 path escaping, and `/-` insert semantics on non-sequence parents.

#### Scenario: Symlink traversal regression test
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify that symlinked directories are skipped and a warning is logged

#### Scenario: Multiline malformed JSON regression test
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify that pretty-printed malformed JSON objects are correctly parsed across multiple lines

#### Scenario: RFC 6901 escaping regression test
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify `~0` → `~` and `~1` → `/` unescaping, empty segment preservation, and combined escape sequences

#### Scenario: Sequence creation regression test
- **WHEN** `cargo test` is run
- **THEN** tests SHALL verify that `insert` with `/-` on a scalar parent creates a sequence, not a mapping with key `"-"`

