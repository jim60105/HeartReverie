## Context

The `apply-patches` tool is a Rust CLI that processes custom JSONPatch operations against YAML state files for SillyTavern interactive fiction scenarios. Currently, all ~660 lines live in a single `src/main.rs` with zero test coverage. The tool works correctly but is fragile — any change risks breaking the malformed-JSON parser, patch operations, or YAML navigation logic without any safety net.

The codebase uses:
- **Rust 2024 edition** with serde, serde_json, serde_yaml, regex
- A custom JSONPatch format (NOT RFC 6902) with `replace`, `delta`, `insert`, `remove` operations
- A fallback malformed-JSON parser for SillyTavern's unescaped quotes
- YAML tree navigation with auto-creation of intermediate mappings

## Goals / Non-Goals

**Goals:**
- Achieve comprehensive test coverage for all core logic
- Organize tests into well-structured modules (not one giant test file)
- Extract modules following SRP so each has a clear, testable responsibility
- Maintain identical CLI behavior — the refactor is purely internal
- Keep all existing functionality including the malformed-JSON fallback parser

**Non-Goals:**
- Changing the CLI interface or command-line arguments
- Adding new patch operations or features
- Changing the directory structure convention (init-status.yml, numbered .md files)
- Migrating to a different YAML or JSON library
- Adding async I/O or concurrency

## Decisions

### Decision 1: Use built-in Rust test framework with `#[cfg(test)]` modules

**Choice**: Rust's built-in `cargo test` with `#[cfg(test)]` inline modules for unit tests and a `tests/` directory for integration tests.

**Alternatives considered**:
- External test frameworks (e.g., `rstest`, `proptest`) — adds dependencies, overkill for this scope
- Only integration tests — misses fine-grained unit testing of parsing edge cases

**Rationale**: Zero additional dependencies. Unit tests sit next to the code they test, making them easy to maintain during refactoring.

### Decision 2: Module extraction strategy

**Choice**: Extract into focused modules within `src/`:

| Module | Responsibility |
|--------|---------------|
| `main.rs` | CLI entry point, orchestration only |
| `pipeline.rs` | Directory traversal, sub-directory processing, file I/O pipeline |
| `parser.rs` | JSONPatch extraction from markdown, JSON parsing, malformed-JSON fallback |
| `patch_ops.rs` | Patch application (replace, delta, insert, remove) |
| `yaml_nav.rs` | YAML tree navigation (navigate_to_parent, descend_or_create) |
| `convert.rs` | JSON↔YAML conversion, numeric helpers (yaml_to_f64, f64_to_yaml_number, parse_path) |

**Alternatives considered**:
- Fewer modules (e.g., combine yaml_nav + convert) — violates SRP, yaml_nav is complex enough to be its own unit
- Library crate + binary crate — overkill for a single-binary tool with no external consumers
- Workspace with sub-crates — unnecessary complexity

**Rationale**: Each module maps to a distinct concern. `patch_ops` depends on `yaml_nav` and `convert`, `parser` depends on `convert`, and `pipeline` depends on all of them. This creates a clean dependency DAG with no cycles.

### Decision 3: Test file organization

**Choice**: Each module gets a `#[cfg(test)] mod tests` block for unit tests. Integration tests go in `tests/integration.rs` with fixture directories.

**Alternatives considered**:
- Separate test files per module in `tests/` — splits unit tests from the code they cover, harder to maintain
- Single `tests/mod.rs` — the "9999-line file" anti-pattern the user explicitly wants to avoid

**Rationale**: Unit tests next to code is idiomatic Rust and survives refactoring. Integration tests in `tests/` verify the end-to-end pipeline with real fixture data.

### Decision 4: Make functions `pub(crate)` during extraction

**Choice**: Functions extracted into modules get `pub(crate)` visibility — accessible within the crate for testing and cross-module use, but not exported.

**Rationale**: No external consumers. `pub(crate)` keeps the API surface minimal while allowing unit tests in each module to access functions from other modules if needed.

### Decision 5: Test fixtures as embedded strings and temp directories

**Choice**: Unit tests use inline YAML/JSON strings. Integration tests use `tempfile` crate to create fixture directories with init-status.yml, sub-directories, and numbered .md files.

**Alternatives considered**:
- Checked-in fixture directories — clutters the repo, fragile to path changes
- Only inline strings — can't test the full directory-scanning pipeline

**Rationale**: Inline strings keep unit tests self-contained and readable. Temp directories for integration tests verify the real file I/O path without polluting the workspace.

## Risks / Trade-offs

- **[Risk] Refactoring breaks malformed-JSON parser** → Mitigated by writing parser tests first (Phase 1), including explicit malformed-JSON scenarios, before any refactoring
- **[Risk] Module boundary changes alter error messages** → Integration tests capture expected error output; maintain stderr behavior
- **[Risk] `tempfile` adds a new dependency** → Minimal, well-maintained crate; only used in `[dev-dependencies]`
- **[Trade-off] More files to navigate** → Acceptable cost for testability and SRP; each file is small and focused
- **[Trade-off] `pub(crate)` exposes internals within crate** → Acceptable since there are no external consumers; keeps tests clean
