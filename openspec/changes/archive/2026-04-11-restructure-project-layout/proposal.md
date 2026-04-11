## Why

The `apply-patches/` Rust CLI lives at the project root but is exclusively used by the `plugins/apply-patches/` plugin — its handler.js references the binary at `apply-patches/target/release/apply-patches`. Colocating the Rust source under the plugin directory makes the dependency explicit and reduces top-level clutter.

Test files (`*_test.ts`, `*_test.js`) are currently co-located alongside source files in both `reader/js/` and `writer/`. For `reader/`, this means test files are served as static assets by the HTTPS server, which is a security concern (leaking test code and internal assertions). Additionally, having co-located tests in `reader/` but also co-located tests in `writer/` creates inconsistency. Moving all test files to a dedicated `tests/` directory tree establishes a single convention across the project.

## What Changes

- Move the entire `apply-patches/` directory (Cargo.toml, src/, tests/, Cargo.lock, AGENTS.md) into `plugins/apply-patches/rust/`
- Update `plugins/apply-patches/handler.js` to reference the binary from the new path
- Move all 7 reader test files from `reader/js/*_test.js` to `tests/reader/js/`
- Move all 15 writer test files from `writer/**/*_test.ts` to `tests/writer/` mirroring the source directory structure
- Update `deno.json` test task paths
- Update import paths in all moved test files to reference source files at their original locations

## Capabilities

### New Capabilities

_None_

### Modified Capabilities

- `test-infrastructure`: Test file location convention changes from co-located to a dedicated `tests/` directory; test runner paths update accordingly
- `backend-tests`: Test file paths change from `writer/**/*_test.ts` to `tests/writer/**/*_test.ts`; import paths update
- `frontend-tests`: Test file paths change from `reader/js/*_test.js` to `tests/reader/js/*_test.js`; import paths update
- `apply-patches-tests`: Test file location changes from `apply-patches/tests/` to `plugins/apply-patches/rust/tests/`; Cargo test configuration remains the same

## Impact

- **File layout**: `apply-patches/` directory removed from project root; new `tests/` directory at root
- **Build system**: Cargo build/test commands need to run from `plugins/apply-patches/rust/` instead of `apply-patches/`
- **Plugin handler**: `handler.js` path to binary changes
- **deno.json**: Task definitions for `test`, `test:backend`, `test:frontend` update paths
- **Import paths**: All 22 test files need relative import path updates
- **AGENTS.md**: Root AGENTS.md project structure section needs updating
- **CI/CD**: Any workflow referencing `apply-patches/` or test paths needs updating
- **.gitignore**: Any ignore rules referencing `apply-patches/target` need updating
