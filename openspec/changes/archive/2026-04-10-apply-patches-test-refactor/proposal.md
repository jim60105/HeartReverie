## Why

The `apply-patches` Rust CLI tool (~660 lines, single `main.rs`) has zero test coverage and a monolithic architecture. All logic — directory scanning, JSONPatch parsing (including a malformed-JSON fallback parser), YAML tree navigation, and four patch operations — lives in one file with no module boundaries. This makes it fragile to change and impossible to verify correctness without manual testing against real story data.

## What Changes

- Set up a Rust test framework with `#[cfg(test)]` module(s) and integration test fixtures
- Write comprehensive unit tests for all core functions: `parse_patch_operations`, `parse_malformed_entry`, `apply_operation` (replace/delta/insert/remove), `navigate_to_parent`, `descend_or_create`, `json_to_yaml`, `parse_path`, `yaml_to_f64`, `f64_to_yaml_number`, `collect_numbered_md_files`, `sorted_subdirs`
- Write integration tests that verify end-to-end processing of fixture directories
- Refactor `main.rs` into focused modules following SRP, KISS, DRY, and SOLID principles:
  - `patch_ops.rs` — patch operation application logic (replace, delta, insert, remove)
  - `parser.rs` — JSONPatch block extraction and parsing (including malformed-JSON fallback)
  - `yaml_nav.rs` — YAML tree navigation (`navigate_to_parent`, `descend_or_create`)
  - `convert.rs` — JSON↔YAML conversion and numeric utilities
  - `pipeline.rs` — directory scanning, numbered markdown file collection, file I/O pipeline
  - `main.rs` — CLI entry point and orchestration only
- Ensure all tests pass after refactoring with no behavioral regressions

## Capabilities

### New Capabilities
- `apply-patches-tests`: Comprehensive Rust test suite covering all JSONPatch operations, parsing (well-formed and malformed), YAML navigation, and end-to-end integration
- `apply-patches-modules`: Modular Rust architecture with clear separation of concerns, replacing the monolithic single-file design

### Modified Capabilities
- `jsonpatch-processor`: Module boundaries change (single file → multi-module), but all behavioral requirements remain unchanged

## Impact

- `apply-patches/src/main.rs` — Split into multiple module files
- `apply-patches/src/` — New module files added
- `apply-patches/tests/` — New integration test directory with fixture data
- No API or CLI interface changes — the binary behaves identically
- No dependency changes (serde, serde_json, serde_yaml, regex remain the same)
