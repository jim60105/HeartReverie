# Delta Spec: state-modules (renamed from state-patches-modules)

## RENAMED Requirements

FROM: `openspec/specs/state-patches-modules/`
TO: `openspec/specs/state-modules/`

The spec directory is renamed from `state-patches-modules` to `state-modules` to reflect the `state-patches` plugin being renamed to `state`. The Rust binary/crate name `state-patches` is unchanged.

## MODIFIED Requirements

### Requirement: Module separation
The codebase SHALL be organized into focused modules within `src/`, each with a single responsibility.

#### Scenario: Module inventory
- **WHEN** the `plugins/state/rust/src/` directory is examined
- **THEN** it SHALL contain at minimum: `main.rs`, `pipeline.rs`, `parser.rs`, `patch_ops.rs`, `yaml_nav.rs`, `convert.rs`

#### Scenario: main.rs is thin orchestration
- **WHEN** `main.rs` is examined
- **THEN** it SHALL contain only the CLI entry point (`main()`), module declarations, and re-exports — no business logic
