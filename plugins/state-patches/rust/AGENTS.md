# AGENTS.md

## Overview

**state-patches** — A Rust CLI tool that processes YAML state files by applying custom JSONPatch operations extracted from numbered markdown files. For each sub-directory containing an `init-status.yml`, it clones the initial state, applies `<JSONPatch>` blocks from `.md` files in numeric order, and writes the result to `current-status.yml`.

## File Structure

```
Cargo.toml              # Dependencies: serde, serde_json, serde_yaml, regex
Cargo.lock
src/
  main.rs               # Complete implementation (~400 lines, single file)
```

### Key Functions

```
main()                       # Entry point, directory traversal, pipeline orchestration
sorted_subdirs(dir)          # List and sort sub-directories
collect_numbered_md_files(dir) # Find ^\d+\.md$ files, sort numerically
parse_patch_operations(json_text) # Parse JSON with fallback for malformed data
parse_malformed_entry(entry) # Line-by-line extraction for unescaped quotes
apply_operation(state, op)   # Match on op type (replace/delta/insert/remove)
navigate_to_parent(root, segments) # JSON Pointer path traversal on serde_yaml::Value
descend(value, segment)      # Navigate one level into mapping or sequence
json_to_yaml(json)           # Convert serde_json::Value to serde_yaml::Value
parse_path(path)             # Split JSON Pointer path into segments
```

## Technology Stack

- **Rust** — 2024 edition, single-file architecture
- **serde_yaml 0.9** — YAML parse/dump, `serde_yaml::Value` as dynamic type
- **serde_json 1** — JSON parsing for `<JSONPatch>` blocks
- **regex 1** — `<JSONPatch>` extraction and filename matching

## Code Style

- Single-file architecture — all logic in `main.rs`
- Idiomatic Rust with `Result`-based error handling
- Pattern matching for `serde_yaml::Value` navigation
- Errors logged to stderr, never abort on a single bad patch
- Comments and code in English

### Custom JSONPatch Format

The `<JSONPatch>` format is **not** RFC 6902. It supports 4 operations:

| Op        | Description                                        |
|-----------|----------------------------------------------------|
| `replace` | Set value at path                                  |
| `delta`   | Numeric addition to existing value                 |
| `insert`  | Add key to object, or append to array (path `-`)   |
| `remove`  | Delete value at path                               |

Paths use JSON Pointer style: `/key1/key2/key3`

## Development

### Build & Run

```bash
cargo build --release
./target/release/state-patches [root_directory]  # default: current directory
```

### Important Constraints

- Do **NOT** read files under `playground/` directories — they contain story data
- The malformed-JSON fallback parser exists intentionally — some source `.md` files contain unescaped quotes in string values
