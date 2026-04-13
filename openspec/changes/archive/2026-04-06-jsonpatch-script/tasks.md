## 1. Project setup

- [x] 1.1 Create `apply-patches/` Rust project with `cargo init`
- [x] 1.2 Add dependencies to `Cargo.toml`: `serde`, `serde_json`, `serde_yaml`, `regex`
- [x] 1.3 Add `apply-patches/target/` to `.gitignore` if not already ignored

## 2. Core implementation

- [x] 2.1 Implement directory discovery: scan root directory children for `init-status.yml`
- [x] 2.2 Implement sub-directory enumeration: list sub-directories within each story directory
- [x] 2.3 Implement `extract_patches(md_content)`: regex-based extraction of all `<JSONPatch>…</JSONPatch>` blocks, returning parsed `serde_json::Value` arrays
- [x] 2.4 Implement path traversal: split path by `/`, navigate `serde_yaml::Value` tree, handle mapping keys, sequence indices, and `-` append token
- [x] 2.5 Implement `apply_operation(state, op)`: match on op type for `replace`, `delta`, `insert`, `remove`
- [x] 2.6 Implement per-sub-directory pipeline: clone init state, discover numbered `.md` files (regex `^\d+\.md$`), sort numerically, extract and apply patches in order
- [x] 2.7 Write final state to `current-status.yml` using `serde_yaml::to_string`

## 3. CLI and error handling

- [x] 3.1 Accept optional root directory argument (default: current directory)
- [x] 3.2 Add error handling: log file/operation/path errors to stderr, continue processing

## 4. Validation

- [x] 4.1 Build with `cargo build --release` and verify compilation
- [x] 4.2 Run against `playground/悠奈悠花姊妹大冒險/short-template/` and verify `current-status.yml` is generated
- [x] 4.3 Verify all four operations (replace, delta, insert, remove) produce correct results
