## Context

Story chapters contain `<JSONPatch>` XML blocks that describe incremental state mutations. The initial state lives in `init-status.yml` at the story root directory. Each sub-directory represents a story branch, and numbered markdown files (001.md, 002.md, …) contain patches applied in sequence. No tool currently automates this pipeline.

The script must handle hundreds of directories per minute in production. Performance is a key requirement.

## Goals / Non-Goals

**Goals:**
- Provide a single compiled binary to process all story branches under a given root directory
- Support four custom operations: `replace`, `delta`, `insert`, `remove`
- Produce `current-status.yml` in each sub-directory with the final state
- Isolate each sub-directory's patches so they don't affect each other (clone per branch)
- Maximum performance via native compiled Rust binary

**Non-Goals:**
- Standard RFC 6902 JSON Patch compliance (custom `delta` op is non-standard)
- Watch mode or incremental processing
- Validation or schema enforcement on the YAML structure
- Cross-platform builds (Linux-only is fine)

## Decisions

### 1. Language: Rust

**Chosen:** Rust with Cargo
**Alternatives considered:**
- **Zsh**: YAML parsing and nested object manipulation are impractical in shell.
- **Node.js**: Viable, but user requires maximum performance for hundreds of directories per minute. Rust avoids V8 startup overhead and provides faster YAML/JSON parsing via native code.
- **Python**: Slowest option for CPU-bound workloads.

**Rationale:** Rust compiles to a single native binary with no runtime dependencies. `serde_yaml` and `serde_json` are mature, battle-tested crates. The compiled binary starts instantly and processes data at native speed.

### 2. Dependencies

- `serde` + `serde_json`: JSON parsing for patch operations
- `serde_yaml`: YAML load/dump for `init-status.yml` and `current-status.yml`
- `regex`: Extract `<JSONPatch>…</JSONPatch>` blocks from markdown content

### 3. Data representation: `serde_yaml::Value`

Use `serde_yaml::Value` as the dynamic type for the YAML state tree. This allows navigating and mutating arbitrary nested structures without defining concrete Rust structs. `Value::clone()` provides deep copying for sub-directory isolation.

### 4. Path resolution: JSON Pointer style

Paths like `/蘭堂悠奈/物品庫/隨身物品/書籍` are split by `/` (ignoring leading `/`). Each segment navigates one level into the nested mapping. For sequences (arrays), segments are parsed as numeric indices; `-` means "append to end" (insert only).

### 5. File discovery: `std::fs::read_dir` + numeric sort

Numbered markdown files are discovered by matching the regex `^\d+\.md$` and sorted numerically by parsing the leading digits.

### 6. CLI interface

Accept an optional argument for the root directory path. Default to the binary's parent directory (`./`). Print processed directory count and any errors to stderr.

## Risks / Trade-offs

- **[Non-standard patch format]** → The `delta` operation is custom. If upstream SillyTavern changes the format, the script needs updating. Mitigation: operations are clearly separated in a match statement, easy to extend.
- **[serde_yaml Value mutation]** → Navigating and mutating `serde_yaml::Value` requires careful pattern matching. Mitigation: wrap path traversal in a helper function with clear error propagation.
- **[Build requirement]** → Requires Rust toolchain to compile. Mitigation: compile once, distribute binary. Could add CI build step later.
- **[Multiple JSONPatch blocks per file]** → Use regex with `find_iter` (global matching) to capture all blocks in a single file.
