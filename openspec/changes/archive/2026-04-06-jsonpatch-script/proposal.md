## Why

Story chapters in SillyTavern contain `<JSONPatch>` blocks that describe incremental state changes to character variables. Currently there is no automated tool to process these patches and produce the resulting state after each chapter sequence. A script is needed to walk directory trees, apply cumulative patches from numbered markdown files, and output the final state as `current-status.yml` for each sub-directory.

## What Changes

- Add a Rust CLI binary (`apply-patches/`) that:
  - Discovers all directories under a given root (default: script's parent directory) containing `init-status.yml`
  - For each sub-directory, clones the init state and applies `<JSONPatch>` blocks from numbered `.md` files in order
  - Supports four operations: `replace`, `delta` (numeric increment), `insert` (object key or array append via `-`), and `remove`
  - Outputs the final state as `current-status.yml` in each sub-directory
- Dependencies: `serde_yaml`, `serde_json`, `regex` (all mature Rust crates)
- Compiles to a single native binary — no runtime dependencies

## Capabilities

### New Capabilities
- `jsonpatch-processor`: CLI script that walks playground directories, extracts `<JSONPatch>` blocks from markdown files, applies custom patch operations to YAML state objects, and writes `current-status.yml` output files

### Modified Capabilities
<!-- None — this is a standalone script with no impact on the reader app -->

## Impact

- New directory: `apply-patches/` (Rust project with Cargo.toml)
- Compiled binary: `apply-patches/target/release/apply-patches`
- No changes to the reader app or existing specs
- Output files (`current-status.yml`) are generated artifacts, not source code
