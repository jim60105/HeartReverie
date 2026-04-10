## 1. Setup Test Infrastructure

- [x] 1.1 Add `tempfile` to `[dev-dependencies]` in `apply-patches/Cargo.toml`
- [x] 1.2 Verify `cargo test` runs successfully with zero tests (baseline)

## 2. Write Unit Tests (Before Refactoring)

- [x] 2.1 Add `#[cfg(test)] mod tests` to `main.rs` with unit tests for `parse_path`, `yaml_to_f64`, `f64_to_yaml_number`, and `json_to_yaml` (conversion utilities)
- [x] 2.2 Add unit tests for `descend_or_create` and `navigate_to_parent` (YAML navigation — auto_create true/false, single/multi-segment paths)
- [x] 2.3 Add unit tests for `parse_patch_operations` including single block, multiple blocks, no blocks, and well-formed JSON parsing
- [x] 2.4 Add unit tests for `parse_malformed_entry` — unescaped quotes, op/path/value field extraction, mixed entries
- [x] 2.5 Add unit tests for `apply_replace` — existing value, upsert, root replace, sequence element, out-of-bounds error
- [x] 2.6 Add unit tests for `apply_delta` — positive, negative, missing path, string numeric, non-numeric error, sequence element, root
- [x] 2.7 Add unit tests for `apply_insert` — into mapping, upsert, append to sequence, empty path error, scalar-to-sequence conversion
- [x] 2.8 Add unit tests for `apply_remove` — mapping key, sequence element, non-existent key error, out-of-bounds error, empty path error
- [x] 2.9 Add unit tests for `apply_operation` — unknown operation error, dispatch to correct sub-function
- [x] 2.10 Verify all unit tests pass with `cargo test`

## 3. Write Integration Tests

- [x] 3.1 Create `apply-patches/tests/integration.rs` with helper to build temp fixture directories (init-status.yml, sub-dirs, numbered .md files)
- [x] 3.2 Add integration test: full pipeline with single sub-directory and multiple .md files producing expected current-status.yml
- [x] 3.3 Add integration test: multiple sub-directories processed independently from same init-status.yml
- [x] 3.4 Add integration test: error recovery — invalid patch in one file, valid patches in others still applied
- [x] 3.5 Add integration test: file ordering — verify numeric (not lexicographic) sort of .md files
- [x] 3.6 Verify all integration tests pass with `cargo test`

## 4. Extract Modules

- [x] 4.1 Create `apply-patches/src/convert.rs` — move `json_to_yaml`, `yaml_to_f64`, `f64_to_yaml_number`, `parse_path` with `pub(crate)` visibility; move their unit tests into `convert.rs`'s `#[cfg(test)]` block
- [x] 4.2 Create `apply-patches/src/yaml_nav.rs` — move `navigate_to_parent`, `descend_or_create` with `pub(crate)` visibility; move their unit tests
- [x] 4.3 Create `apply-patches/src/patch_ops.rs` — move `PatchOperation` struct, `apply_operation`, `apply_replace`, `apply_delta`, `apply_insert`, `apply_remove` with `pub(crate)` visibility; move their unit tests; import from `convert` and `yaml_nav`
- [x] 4.4 Create `apply-patches/src/parser.rs` — move `parse_patch_operations`, `parse_malformed_entry`, `extract_simple_string_field`, `extract_value_field` with `pub(crate)` visibility; move their unit tests; import from `convert` and `patch_ops`
- [x] 4.5 Create `apply-patches/src/pipeline.rs` — move `sorted_subdirs`, `collect_numbered_md_files`, `process_subdirectory`, and scenario-level processing with `pub(crate)` visibility; add unit tests for sorted_subdirs and collect_numbered_md_files using tempfile
- [x] 4.6 Slim `main.rs` to module declarations and `main()` entry point only; `main()` calls into `pipeline`
- [x] 4.7 Verify all unit tests and integration tests pass with `cargo test`
- [x] 4.8 Verify `cargo build` produces a working binary with no warnings

## 5. Apply KISS/DRY/SRP Cleanup

- [x] 5.1 Deduplicate any repeated error-formatting patterns across patch operations (DRY)
- [x] 5.2 Simplify complex match arms or control flow where possible (KISS)
- [x] 5.3 Verify all tests still pass after cleanup with `cargo test`
- [x] 5.4 Verify test coverage is at least 75% line coverage (install and run `cargo tarpaulin` or equivalent); add missing tests if below threshold
