# apply-patches-modules Specification

## Purpose
TBD - created by archiving change apply-patches-test-refactor. Update Purpose after archive.
## Requirements
### Requirement: Module separation
The codebase SHALL be organized into focused modules within `src/`, each with a single responsibility.

#### Scenario: Module inventory
- **WHEN** the `plugins/apply-patches/rust/src/` directory is examined
- **THEN** it SHALL contain at minimum: `main.rs`, `pipeline.rs`, `parser.rs`, `patch_ops.rs`, `yaml_nav.rs`, `convert.rs`

#### Scenario: main.rs is thin orchestration
- **WHEN** `main.rs` is examined
- **THEN** it SHALL contain only the CLI entry point (`main()`), module declarations, and re-exports — no business logic

### Requirement: Pipeline module
The `pipeline` module SHALL encapsulate directory traversal, sub-directory processing, and file I/O orchestration.

#### Scenario: Pipeline module contains directory logic
- **WHEN** `pipeline.rs` is examined
- **THEN** it SHALL contain `sorted_subdirs()`, `collect_numbered_md_files()`, `process_subdirectory()`, and the scenario directory processing logic

#### Scenario: Pipeline depends on parser and patch_ops
- **WHEN** `pipeline.rs` calls patch application or parsing functions
- **THEN** it SHALL import them from the `parser` and `patch_ops` modules (not duplicate the logic)

### Requirement: Parser module
The `parser` module SHALL encapsulate JSONPatch block extraction and JSON parsing (including malformed-JSON fallback).

#### Scenario: Parser module contains extraction logic
- **WHEN** `parser.rs` is examined
- **THEN** it SHALL contain `parse_patch_operations()`, `parse_malformed_entry()`, `extract_simple_string_field()`, `extract_value_field()`, and related helpers

#### Scenario: Malformed JSON parser preserved
- **WHEN** `parser.rs` is examined
- **THEN** the fallback line-by-line manual extraction for unescaped quotes SHALL be present and functionally identical to the original

### Requirement: Patch operations module
The `patch_ops` module SHALL encapsulate all patch application logic.

#### Scenario: Patch operations module contains apply functions
- **WHEN** `patch_ops.rs` is examined
- **THEN** it SHALL contain `apply_operation()`, `apply_replace()`, `apply_delta()`, `apply_insert()`, `apply_remove()`

#### Scenario: PatchOperation struct accessible
- **WHEN** other modules need the `PatchOperation` struct
- **THEN** it SHALL be defined in `patch_ops.rs` (or a shared types location) with `pub(crate)` visibility

### Requirement: YAML navigation module
The `yaml_nav` module SHALL encapsulate YAML tree traversal with auto-creation support.

#### Scenario: Navigation module contains traversal logic
- **WHEN** `yaml_nav.rs` is examined
- **THEN** it SHALL contain `navigate_to_parent()` and `descend_or_create()`

### Requirement: Conversion module
The `convert` module SHALL encapsulate type conversion utilities.

#### Scenario: Conversion module contains utilities
- **WHEN** `convert.rs` is examined
- **THEN** it SHALL contain `json_to_yaml()`, `yaml_to_f64()`, `f64_to_yaml_number()`, and `parse_path()`

### Requirement: No behavioral regression
The refactored modules SHALL produce identical behavior to the original monolithic `main.rs`.

#### Scenario: CLI output unchanged
- **WHEN** the refactored binary is run against the same input as the original
- **THEN** the output `current-status.yml` files SHALL be byte-identical

#### Scenario: Error messages preserved
- **WHEN** the refactored binary encounters the same error conditions
- **THEN** stderr messages SHALL convey the same information (exact wording may differ due to module context)

### Requirement: Visibility control
All extracted functions SHALL use `pub(crate)` visibility — accessible within the crate but not exported.

#### Scenario: No public API surface
- **WHEN** the crate is compiled
- **THEN** no functions SHALL be `pub` (only `pub(crate)` or private)

