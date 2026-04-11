# Tasks — restructure-project-layout

## 1. Move apply-patches Rust CLI into plugin

- [x] 1.1 Move `apply-patches/` directory to `plugins/apply-patches/rust/` using `git mv` (includes Cargo.toml, Cargo.lock, src/, tests/, AGENTS.md)
- [x] 1.2 Update `plugins/apply-patches/handler.js` binary path from `path.join(context.rootDir, 'apply-patches', ...)` to `path.join(context.rootDir, 'plugins', 'apply-patches', 'rust', ...)`
- [x] 1.3 Update `.gitignore` to change `apply-patches/target` to `plugins/apply-patches/rust/target`
- [x] 1.4 Verify `cargo build --release` succeeds from `plugins/apply-patches/rust/`
- [x] 1.5 Verify `cargo test` passes from `plugins/apply-patches/rust/`

## 2. Move writer test files to tests/writer/

- [x] 2.1 Create directory structure `tests/writer/lib/` and `tests/writer/routes/`
- [x] 2.2 Move all 9 writer lib test files from `writer/lib/*_test.ts` to `tests/writer/lib/` using `git mv`
- [x] 2.3 Move all 6 writer route test files from `writer/routes/*_test.ts` to `tests/writer/routes/` using `git mv`
- [x] 2.4 Update import paths in all 15 moved writer test files to use relative paths back to `writer/` (e.g., `"../../../writer/lib/errors.ts"`)

## 3. Move reader test files to tests/reader/

- [x] 3.1 Create directory structure `tests/reader/js/`
- [x] 3.2 Move all 7 reader test files from `reader/js/*_test.js` to `tests/reader/js/` using `git mv`
- [x] 3.3 Update import paths in all 7 moved reader test files to use relative paths back to `reader/js/` (e.g., `"../../../reader/js/utils.js"`)

## 4. Update configuration

- [x] 4.1 Update `deno.json` task `test:backend` path from `writer/` to `tests/writer/`
- [x] 4.2 Update `deno.json` task `test:frontend` path from `reader/js/` to `tests/reader/js/`
- [x] 4.3 Update `deno.json` task `test` to reference `tests/writer/` and `tests/reader/js/`

## 5. Update documentation

- [x] 5.1 Update root `AGENTS.md` project structure section to reflect new layout (apply-patches under plugins, tests/ directory)
- [x] 5.2 Update root `AGENTS.md` "Running the Rust CLI" section with new path `plugins/apply-patches/rust/`
- [x] 5.3 Update root `AGENTS.md` test command examples to reference `tests/` paths

## 6. Verification

- [x] 6.1 Run `deno test --allow-read --allow-write --allow-env --allow-net tests/writer/` — all backend tests pass
- [x] 6.2 Run `deno test --allow-read tests/reader/js/` — all frontend tests pass
- [x] 6.3 Verify no `*_test.ts` or `*_test.js` files remain under `writer/` or `reader/`
- [x] 6.4 Verify `cargo test` passes from `plugins/apply-patches/rust/`
- [x] 6.5 Verify no `apply-patches/` directory exists at project root
- [x] 6.6 Commit all changes atomically with message `refactor: restructure project layout`
