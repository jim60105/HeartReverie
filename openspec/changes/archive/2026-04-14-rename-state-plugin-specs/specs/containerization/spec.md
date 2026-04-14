# Delta Spec: containerization

## MODIFIED Requirements

### R1: Two-Containerfile Architecture

The containerization MUST use two separate Containerfiles:

1. **Root `Containerfile`** — Deno-only container for the main application. MUST NOT contain any Rust build stages. The Rust binary is COPYd from the source tree as a pre-built artifact.
2. **`plugins/state/rust/Containerfile`** — Rust CLI builder that compiles the `state-patches` binary and supports `--output` extraction.

#### Scenario: Two Containerfiles exist
- **WHEN** the repository is examined
- **THEN** `Containerfile` at the root and `plugins/state/rust/Containerfile` for the Rust builder SHALL both exist

### R2: Rust Containerfile — cargo-chef Pattern

The Rust Containerfile at `plugins/state/rust/Containerfile` MUST use the cargo-chef pattern with the following stages:

1. **`chef`** — Base stage from `docker.io/lukemathwalker/cargo-chef:latest-rust-alpine` (musl, statically linked) with `WORKDIR /app`, `/licenses` directory creation, and `ENV RUSTFLAGS="-C target-feature=+crt-static"` for explicit static linking. MUST detect the host target triple dynamically via `rustc -vV | sed -n 's|host: ||p'` and save it to `/tmp/rust-target` for use in subsequent stages.
2. **`planner`** — Runs `cargo chef prepare --recipe-path recipe.json` with bind-mounted source files (`Cargo.toml`, `Cargo.lock`, `src/`)
3. **`cook`** — Installs system build dependencies with BuildKit apk cache mounts keyed by `$TARGETARCH$TARGETVARIANT`, mounts recipe from planner, runs `cargo chef cook --release --locked --target "$(cat /tmp/rust-target)"`. The explicit `--target` flag separates host (proc-macro) from target compilation, ensuring `RUSTFLAGS` only applies to the final binary.
4. **`builder`** — Builds the binary via `cargo build --release --locked --target "$(cat /tmp/rust-target)"` with bind-mounted source files. Output binary is at `target/*/release/state-patches` (the target triple creates a subdirectory).
5. **`binary`** — `FROM scratch AS binary`, COPYs the compiled binary from the builder stage using a glob pattern `target/*/release/state-patches` to handle the target-specific subdirectory, for `--output` extraction.

The `binary` stage MUST be the last stage in the Rust Containerfile. It MUST NOT have a `final` stage — the Rust Containerfile is a builder only, not a runtime image.

#### Scenario: Rust Containerfile location
- **WHEN** the Rust builder Containerfile is examined
- **THEN** it SHALL be located at `plugins/state/rust/Containerfile`

### R3: Rust Binary Extraction Workflow

The Rust Containerfile MUST support the `--output` flag for binary extraction:

```bash
cd plugins/state
podman build --output=. --target=binary -f rust/Containerfile rust/
```

This command MUST produce the binary at `plugins/state/state-patches` (at the plugin root, NOT inside `rust/target/`).

The extracted binary MUST be committed to git so that:
- The root Containerfile can COPY it without needing Rust
- Developers without the Rust toolchain can still build and run the main application

#### Scenario: Binary extraction produces correct output
- **WHEN** `podman build --output=. --target=binary -f rust/Containerfile rust/` is run from `plugins/state/`
- **THEN** the `state-patches` binary SHALL appear at `plugins/state/state-patches`

### R7: Rust Binary Placement in Container

The pre-built `state-patches` binary MUST be placed at `/app/plugins/state/state-patches` in the final image. This path corresponds to the updated `handler.js` which resolves the binary at `plugins/state/state-patches` relative to `context.rootDir`.

#### Scenario: Binary exists at correct path in container
- **WHEN** the container image is inspected
- **THEN** the `state-patches` binary SHALL be at `/app/plugins/state/state-patches`

### R8: Handler.js Binary Path Change

The `state` plugin handler (`plugins/state/handler.js`) MUST be updated to resolve the binary path as:

```javascript
path.join(context.rootDir, 'plugins', 'state', 'state-patches')
```

Instead of the current path:

```javascript
path.join(context.rootDir, 'plugins', 'state', 'rust', 'target', 'release', 'state-patches')
```

#### Scenario: Handler resolves binary at plugin root
- **WHEN** the `state` plugin handler constructs the binary path
- **THEN** it SHALL resolve to `plugins/state/state-patches` relative to `context.rootDir`

### R9: Application Files in Root Container

The final image MUST contain all files required for the application to function:

| Source | Destination | Purpose |
|--------|-------------|---------|
| `writer/` | `/app/writer/` | Backend server |
| `reader/` | `/app/reader/` | Frontend static files |
| `assets/` | `/app/assets/` | Background images and static assets |
| `plugins/` | `/app/plugins/` | Plugin manifests, handlers, and frontend modules |
| `system.md` | `/app/system.md` | Vento prompt template |
| `deno.json` | `/app/deno.json` | Import map and task definitions |
| `deno.lock` | `/app/deno.lock` | Dependency lock file |
| `LICENSE` | `/licenses/LICENSE` | GPL-3.0-or-later license text |

All copied files MUST use `--link --chown=$UID:0 --chmod=775` for OpenShift compatibility.

Note: `plugins/state/rust/` (Rust source) does NOT need to be included in the root container image. The `.dockerignore` SHOULD exclude it. Only the pre-built binary at `plugins/state/state-patches` needs to be present.

#### Scenario: Rust source excluded from image
- **WHEN** the container image is built
- **THEN** `plugins/state/rust/` SHALL NOT be present in the image, but `plugins/state/state-patches` SHALL be present

### R15: .dockerignore

A `.dockerignore` file MUST exclude at minimum:
- `.git/`, `.gitignore`
- `.certs/`, `.env`
- `playground/`
- `tmp/`
- `plugins/state/rust/` — Rust source not needed (pre-built binary is at plugin root)
- `openspec/`, `docs/`, `tests/`, `skills/`
- OS/editor artifacts (`.DS_Store`, `*.swp`, `Thumbs.db`)
- `node_modules/`

#### Scenario: Rust source directory excluded
- **WHEN** the `.dockerignore` is examined
- **THEN** it SHALL contain an entry excluding `plugins/state/rust/`

### R18: README.md Updates — Root

The root `README.md` MUST be updated to:
- **Remove** the Rust toolchain from the quick start prerequisites (only Deno is required for the main app)
- Remove the `cargo build --release` step from the quick start
- Reference the pre-built binary in `plugins/state/state-patches`
- Add container build and run instructions as an alternative deployment path

#### Scenario: README references correct binary path
- **WHEN** the root `README.md` is examined
- **THEN** it SHALL reference `plugins/state/state-patches` as the pre-built binary location

### R19: README.md Updates — Plugin

The `plugins/state/README.md` MUST be updated to:
- Document how to build the binary via the Rust Containerfile with `--output` extraction
- Include the Rust toolchain requirement (moved from root README — Rust is only needed for plugin development)
- Document the new binary output path at `plugins/state/state-patches` (not inside `rust/target/`)

#### Scenario: Plugin README documents extraction workflow
- **WHEN** the `plugins/state/README.md` is examined
- **THEN** it SHALL document the `podman build --output=. --target=binary -f rust/Containerfile rust/` command and the output path `plugins/state/state-patches`

### R21: .gitignore Update

The `.gitignore` MUST be updated to ensure `plugins/state/state-patches` (the pre-built binary) is NOT ignored. If there is a pattern that would match it, an explicit negation (`!plugins/state/state-patches`) MUST be added.

#### Scenario: Pre-built binary not ignored
- **WHEN** the `.gitignore` rules are evaluated
- **THEN** `plugins/state/state-patches` SHALL NOT be ignored by any gitignore pattern

## MODIFIED Acceptance Criteria

1. `podman build --output=. --target=binary -f plugins/state/rust/Containerfile plugins/state/rust/` produces a working static binary
2. The binary at `plugins/state/state-patches` can be committed to git
3. `podman build -t heartreverie:latest .` completes successfully (Deno-only, no Rust build)
4. The built image starts and the Deno server listens on port 8443
5. The `state-patches` binary is executable and at `/app/plugins/state/state-patches` inside the container
6. Auto-generated TLS certificates allow HTTPS connections
7. The container runs as non-root (UID 1001, GID 0)
8. `dumb-init` is PID 1 inside the running container
9. `LABEL` is the last instruction in the root Containerfile
10. The image does not contain playground data, `.env`, `.certs/`, Rust source code, or development-only files
11. `handler.js` correctly resolves the binary at `plugins/state/state-patches`
12. Root `README.md` does not require Rust toolchain for quick start
13. Plugin `README.md` documents the Containerfile build workflow
