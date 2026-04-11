## Context

The project has a Rust CLI (`apply-patches/`) at the repository root that is exclusively consumed by one plugin (`plugins/apply-patches/`). The plugin's `handler.js` hard-codes the path `apply-patches/target/release/apply-patches` relative to the project root. This loose coupling across the root directory obscures the dependency.

Test files are co-located with source files: 7 `*_test.js` files in `reader/js/` and 15 `*_test.ts` files in `writer/`. The reader directory is served as static files by the HTTPS server, meaning test files are accessible to anyone who can reach the server. Moving tests to a dedicated `tests/` tree eliminates this exposure and unifies the project convention.

## Goals / Non-Goals

**Goals:**
- Colocate the Rust CLI source inside `plugins/apply-patches/rust/` so the plugin is self-contained
- Move all test files to `tests/` at the project root, mirroring the source directory structure
- Update all import paths, build paths, and configuration references
- Maintain zero regressions — all tests must pass after restructuring

**Non-Goals:**
- Refactoring test content or adding new tests
- Changing the plugin system architecture
- Modifying the Rust CLI implementation
- Converting reader test files from JS to TS (separate concern)

## Decisions

### Decision 1: Rust CLI location → `plugins/apply-patches/rust/`

Place the Rust project as a `rust/` subdirectory within the plugin, not at the plugin root.

**Rationale**: The plugin root already contains `plugin.json` and `handler.js`. Nesting under `rust/` keeps the Rust project self-contained (its own Cargo.toml, src/, tests/) and avoids mixing JavaScript plugin files with Rust build artifacts.

**Alternative considered**: Flatten into plugin root — rejected because Cargo.toml at the same level as plugin.json creates confusion about what the directory "is."

### Decision 2: Test directory structure → `tests/reader/` and `tests/writer/`

Mirror the source directory hierarchy under `tests/`:
```
tests/
  reader/
    js/
      utils_test.js
      md-renderer_test.js
      ...
  writer/
    lib/
      errors_test.ts
      hooks_test.ts
      ...
    routes/
      auth_test.ts
      chat_test.ts
      ...
```

**Rationale**: Mirroring makes it trivial to find the test for a given source file. The reader tests keep `.js` extension (they test browser ES modules) and writer tests keep `.ts`.

**Alternative considered**: Flat `tests/` with prefixed filenames — rejected because the existing subdirectory structure (lib/, routes/) carries useful semantic meaning.

### Decision 3: handler.js path update strategy

Update the single hard-coded path in `handler.js` from:
```
path.join(context.rootDir, 'apply-patches', 'target', 'release', 'apply-patches')
```
to:
```
path.join(context.rootDir, 'plugins', 'apply-patches', 'rust', 'target', 'release', 'apply-patches')
```

**Rationale**: Direct path update is simple and safe. The `context.rootDir` is already the project root.

### Decision 4: Import path update strategy for test files

Use relative paths from the new test locations back to source files. For example:
- `tests/writer/lib/errors_test.ts` → `import { ... } from "../../../writer/lib/errors.ts"`
- `tests/reader/js/utils_test.js` → `import { ... } from "../../../reader/js/utils.js"`

**Rationale**: Relative imports are the existing convention. The extra `../` depth is unavoidable but consistent.

**Alternative considered**: Import maps in deno.json — rejected as over-engineering for a path change.

### Decision 5: .gitignore update

Move the `apply-patches/target` ignore rule to `plugins/apply-patches/rust/target`.

## Risks / Trade-offs

- **[Longer import paths in tests]** → Tests will have deeper relative imports (`../../../writer/...`). Acceptable trade-off for eliminating the security exposure of serving test files.
- **[Cargo build path change]** → Anyone with muscle memory for `cd apply-patches && cargo build` needs to adjust. Mitigated by updating AGENTS.md documentation.
- **[git mv rename tracking]** → Use `git mv` for all moves to preserve history. Verify with `git log --follow` on key files.
