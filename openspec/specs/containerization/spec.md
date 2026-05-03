# Spec: containerization

> Defines requirements for containerizing the application using a two-Containerfile architecture: a Deno-only root Containerfile and a separate Rust CLI builder.

## Purpose

This specification covers the containerization strategy for the MD Story Tools application. It defines a two-Containerfile architecture that separates the Rust binary compilation from the Deno application build, enabling developers without the Rust toolchain to build and run the main application container. The design follows OCI best practices including non-root execution, proper signal handling, BuildKit cache optimization, and OpenShift compatibility.

## Requirements

### R1: Two-Containerfile Architecture

The containerization MUST use two separate Containerfiles:

1. **Root `Containerfile`** — Deno-only container for the main application. MUST NOT contain any Rust build stages. The Rust binary is COPYd from the source tree as a pre-built artifact.
2. **`plugins/state/rust/Containerfile`** — Rust CLI builder that compiles the `state-patches` binary and supports `--output` extraction.

### R2: Rust Containerfile — cargo-chef Pattern

The Rust Containerfile at `plugins/state/rust/Containerfile` MUST use the cargo-chef pattern with the following stages:

1. **`chef`** — Base stage from `docker.io/lukemathwalker/cargo-chef:latest-rust-alpine` (musl, statically linked) with `WORKDIR /app`, `/licenses` directory creation, and `ENV RUSTFLAGS="-C target-feature=+crt-static"` for explicit static linking. MUST detect the host target triple dynamically via `rustc -vV | sed -n 's|host: ||p'` and save it to `/tmp/rust-target` for use in subsequent stages.
2. **`planner`** — Runs `cargo chef prepare --recipe-path recipe.json` with bind-mounted source files (`Cargo.toml`, `Cargo.lock`, `src/`)
3. **`cook`** — Installs system build dependencies with BuildKit apk cache mounts keyed by `$TARGETARCH$TARGETVARIANT`, mounts recipe from planner, runs `cargo chef cook --release --locked --target "$(cat /tmp/rust-target)"`. The explicit `--target` flag separates host (proc-macro) from target compilation, ensuring `RUSTFLAGS` only applies to the final binary.
4. **`builder`** — Builds the binary via `cargo build --release --locked --target "$(cat /tmp/rust-target)"` with bind-mounted source files. Output binary is at `target/*/release/state-patches` (the target triple creates a subdirectory).
5. **`binary`** — `FROM scratch AS binary`, COPYs the compiled binary from the builder stage using a glob pattern `target/*/release/state-patches` to handle the target-specific subdirectory, for `--output` extraction.

The `binary` stage MUST be the last stage in the Rust Containerfile. It MUST NOT have a `final` stage — the Rust Containerfile is a builder only, not a runtime image.

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

### R4: Root Containerfile — Deno-Only Multi-Stage Build

The root `Containerfile` MUST use a multi-stage build with these stages:

**Download stage:**
1. **`download`** — Base `docker.io/library/debian:bookworm-slim`, installs `curl` and `ca-certificates` via BuildKit apt cache mounts, downloads the `dumb-init` static binary with SHA256 checksum verification. This stage exists because the `deno:debian` base image does not include `curl`.

**Deno cache stage:**
2. **`deno-cache`** — Base `docker.io/denoland/deno:debian`, copies `deno.json` and `deno.lock`, then runs `deno install --lock=deno.lock` to cache all npm packages declared in the import map. This ensures frontend npm dependencies (vue, vite, vitest, tailwindcss, etc.) are cached before any source files are copied, maximizing Docker layer reuse. After npm dependencies are cached, copies the `writer/` directory and runs `deno cache --lock=deno.lock writer/server.ts` to cache backend JSR dependencies (Hono, std lib). The split between `deno install` and `deno cache writer/server.ts` ensures that backend source changes do not invalidate the npm dependency cache layer.

**Frontend build stage:**
3. **`frontend-build`** — Base `docker.io/denoland/deno:debian`, copies cached dependencies from the `deno-cache` stage at `/deno-dir/`, copies `deno.json`, `deno.lock`, and the full `reader-src/` directory. Uses `WORKDIR` to set the working directory to `reader-src/`, then runs `deno run -A npm:vue-tsc@^2.2.8 --noEmit` for type checking followed by `deno run -A npm:vite@^6.3.2 build --outDir ../reader-dist` for the production build. This stage MUST NOT use Node.js or npm — all build tooling SHALL be invoked via version-pinned `deno run -A npm:` specifiers.

**Final stage:**
4. **`final`** — Base `docker.io/denoland/deno:debian`. The stage assembles the runtime image with all application files and copies the built frontend from the `frontend-build` stage. The stage MUST NOT install `openssl` (no longer needed — there is no in-pod TLS cert generation) and MUST NOT create a `/certs` directory. The stage MUST NOT copy any `entrypoint.sh` (the file does not exist in the repository).

The `final` stage MUST be the last stage in the root Containerfile.

#### Scenario: No Node.js image used in any stage
- **WHEN** the root `Containerfile` is examined
- **THEN** no stage SHALL use a `node:` base image — all stages SHALL use `debian:bookworm-slim` or `docker.io/denoland/deno:debian`

#### Scenario: Frontend build uses Deno
- **WHEN** the `frontend-build` stage executes
- **THEN** it SHALL run `deno run -A npm:vue-tsc --noEmit` and `deno run -A npm:vite build` (NOT `npx vue-tsc` or `npx vite build`)

#### Scenario: Four stages present
- **WHEN** the root `Containerfile` stages are listed
- **THEN** there SHALL be exactly four named stages: `download`, `deno-cache`, `frontend-build`, and `final`

#### Scenario: openssl is not installed in the final stage

- **WHEN** the root `Containerfile` final-stage `RUN` instructions are examined
- **THEN** there SHALL be no `apt-get install` line that installs `openssl` and no `/certs` directory creation

### R5: Containerfile Syntax and Structure

The root Containerfile MUST follow these conventions:
- Begin with `# syntax=docker/dockerfile:1`
- Declare `ARG UID=1000`, `ARG VERSION=EDGE`, and `ARG RELEASE=0` at the top level
- Build stages MUST be separated by a line of exactly 40 `#` characters
- Files MUST be named `Containerfile` (not `Dockerfile`)

#### Scenario: Default UID is 1000
- **WHEN** the root `Containerfile` top-level `ARG` instructions are examined
- **THEN** the UID argument SHALL be declared as `ARG UID=1000`

### R6: Deno Dependency Caching

- The `deno-cache` stage MUST use `docker.io/denoland/deno:debian` as base image
- The stage MUST copy `deno.json` and `deno.lock` and run `deno install --lock=deno.lock` to cache all npm packages from the import map (frontend and backend)
- The stage MUST then copy the `writer/` directory and run `deno cache --lock=deno.lock writer/server.ts` to cache backend JSR packages
- The cached dependencies MUST be copied to subsequent stages (both `frontend-build` and `final`) at `/deno-dir/`
- The `deno install` command SHALL resolve all npm packages declared in the `deno.json` imports map (e.g., `vue`, `vite`, `vitest`, `tailwindcss`, `ventojs`) without requiring individual source files to be copied

#### Scenario: npm dependencies cached via deno install
- **WHEN** the `deno-cache` stage `RUN` instructions are examined
- **THEN** `deno install --lock=deno.lock` SHALL be used to cache all npm packages from the import map

#### Scenario: Both backend and frontend deps cached
- **WHEN** the `deno-cache` stage completes
- **THEN** the Deno cache directory SHALL contain both backend JSR packages (e.g., `@hono/hono`) and frontend npm packages (e.g., `vue`, `vite`)

#### Scenario: Layer separation for cache efficiency
- **WHEN** the `deno-cache` stage `COPY` and `RUN` instructions are examined
- **THEN** `deno install` SHALL run before `COPY writer/` so that backend source changes do not invalidate the npm dependency cache layer

### R7: Rust Binary Placement in Container

The pre-built `state-patches` binary MUST be placed at `/app/plugins/state/state-patches` in the final image. This path corresponds to the updated `handler.js` which resolves the binary at `plugins/state/state-patches` relative to `context.rootDir`.

### R8: Handler.js Binary Path Change

The `state` plugin handler (`plugins/state/handler.js`) MUST be updated to resolve the binary path as:

```javascript
path.join(context.rootDir, 'plugins', 'state', 'state-patches')
```

Instead of the current path:

```javascript
path.join(context.rootDir, 'plugins', 'state', 'rust', 'target', 'release', 'state-patches')
```

### R9: Application Files in Root Container

The final image MUST contain all files required for the application to function:

| Source | Destination | Purpose |
|--------|-------------|---------|
| `writer/` | `/app/writer/` | Backend server |
| `reader-dist/` | `/app/reader-dist/` | Frontend static files (built from `reader-src/` in the `frontend-build` stage) |
| `assets/` | `/app/assets/` | Background images and static assets |
| `plugins/` | `/app/plugins/` | Plugin manifests, handlers, and frontend modules |
| `system.md` | `/app/system.md` | Vento prompt template |
| `deno.json` | `/app/deno.json` | Import map and task definitions |
| `deno.lock` | `/app/deno.lock` | Dependency lock file |
| `LICENSE` | `/licenses/LICENSE` | AGPL-3.0-or-later license text |

All copied files MUST use `--link --chown=$UID:0 --chmod=775` for OpenShift compatibility.

The image MUST NOT contain `entrypoint.sh` (the file is deleted from the repository as part of removing in-application TLS).

Note: `plugins/state/rust/` (Rust source) does NOT need to be included in the root container image. The `.containerignore` SHOULD exclude it. Only the pre-built binary at `plugins/state/state-patches` needs to be present.

Note: `reader-src/package.json` no longer exists — the frontend build stage uses Deno with `npm:` specifiers. The frontend built output directory is `reader-dist/`.

#### Scenario: Frontend output at reader-dist
- **WHEN** the final container image is inspected
- **THEN** the built frontend files SHALL be at `/app/reader-dist/` (copied from the `frontend-build` stage)

#### Scenario: No package.json in container
- **WHEN** the final container image is inspected
- **THEN** no `package.json` or `node_modules` SHALL be present anywhere in the image

#### Scenario: Rust source excluded from image
- **WHEN** the container image is built
- **THEN** `plugins/state/rust/` SHALL NOT be present in the image, but `plugins/state/state-patches` SHALL be present

#### Scenario: No entrypoint.sh in image

- **WHEN** the final container image is inspected
- **THEN** there SHALL be no `/app/entrypoint.sh` file (the file does not exist in the source repository)

### R10: Non-Root User Execution

- The final stage MUST create a non-root user with UID from the `$UID` build arg (default 1000) and GID 0
- The `USER` instruction MUST use the format `$UID:0` for OpenShift arbitrary UID compatibility
- All application files and directories MUST be owned by `$UID:0`

#### Scenario: Container runs as non-root with default UID 1000
- **WHEN** the container starts with default build arguments
- **THEN** the process SHALL run as UID 1000, GID 0

#### Scenario: Custom UID override
- **WHEN** the image is built with `--build-arg UID=5000`
- **THEN** the container process SHALL run as UID 5000, GID 0

### R11: dumb-init as PID 1

The `download` stage MUST download the `dumb-init` static binary appropriate for the target architecture. Architecture mapping MUST handle at least `amd64` → `x86_64` and `arm64` → `aarch64`. The download MUST include SHA256 checksum verification for integrity. The binary MUST be COPYd from the `download` stage into the `final` stage (since `deno:debian` lacks `curl`). The container `ENTRYPOINT` MUST be `["dumb-init", "--"]` and the `CMD` MUST be a `sh -c` shim of the form `["sh", "-c", "umask 0002 && exec deno run --allow-net --allow-read --allow-write --allow-env --allow-run writer/server.ts"]`. The `umask 0002` inside the shim is load-bearing — it preserves OpenShift arbitrary-UID + shared-GID-0 group-write semantics for directories the application creates at runtime (Deno's `Deno.mkdir({ mode })` honours the inherited process umask). The `exec` ensures `deno` replaces the shell so signal forwarding from `dumb-init` reaches Deno directly.

#### Scenario: dumb-init is the container ENTRYPOINT

- **WHEN** the final-stage `ENTRYPOINT` instruction is examined
- **THEN** it SHALL be exactly `["dumb-init", "--"]`

#### Scenario: CMD is the umask + deno run shell shim

- **WHEN** the final-stage `CMD` instruction is examined
- **THEN** it SHALL be a JSON-array of exactly three elements: `"sh"`, `"-c"`, and a single shell command string that contains `umask 0002`, the `exec` builtin, `deno run`, the explicit permission flags `--allow-net`, `--allow-read`, `--allow-write`, `--allow-env`, `--allow-run`, and the `writer/server.ts` entry path

#### Scenario: Container runs dumb-init as PID 1

- **WHEN** the container starts
- **THEN** PID 1 inside the container SHALL be `dumb-init` and the Deno process SHALL be a (grand)child of PID 1, with the intervening `sh` having `exec`d into `deno`

#### Scenario: Runtime-created directories are group-writable

- **WHEN** the running container creates a new directory at runtime via `Deno.mkdir(path, { recursive: true, mode: 0o775 })`
- **THEN** the resulting directory mode SHALL be `0o775` (NOT `0o755`), because the `umask 0002` shim preserves the group-write bit

### R13: OCI Labels

- `LABEL` instructions MUST be the very last instructions in the root Containerfile
- Labels MUST reference `ARG VERSION` and `ARG RELEASE` declared immediately before
- Labels MUST include at minimum: `org.opencontainers.image.title`, `org.opencontainers.image.description`, `org.opencontainers.image.version`, `org.opencontainers.image.licenses`

### R14: Instruction Ordering in Final Stage

The root Containerfile's `final` stage MUST follow this instruction order:
1. Cleanup and dependency installation (dumb-init download)
2. User creation
3. Directory creation
4. `COPY` instructions (deps cache, binary, app files, license) — `entrypoint.sh` is NOT part of this list (the file does not exist in the repository)
5. `ENV` instructions
6. `WORKDIR`
7. `VOLUME`
8. `EXPOSE`
9. `USER`
10. `STOPSIGNAL`
11. `ENTRYPOINT` / `CMD`
12. `ARG VERSION` + `ARG RELEASE`
13. `LABEL` (very last)

#### Scenario: COPY list does not include entrypoint

- **WHEN** the root `Containerfile` final-stage `COPY` instructions are examined
- **THEN** there SHALL be no `COPY entrypoint.sh …` instruction (the file does not exist in the repository)

#### Scenario: Instruction order is preserved

- **WHEN** the root `Containerfile` final-stage instructions are read top-to-bottom
- **THEN** they SHALL appear in the order listed above, with `LABEL` last

### R15: .containerignore

A `.containerignore` file MUST exclude at minimum:
- `.git/`, `.gitignore`
- `.certs/`, `.env`
- `playground/`
- `tmp/`
- `plugins/state/rust/` — Rust source not needed (pre-built binary is at plugin root)
- `openspec/`, `docs/`, `tests/`, `.agents/`
- OS/editor artifacts (`.DS_Store`, `*.swp`, `Thumbs.db`)
- `node_modules/`

### R16: Exposed Port and Signal

The root Containerfile MUST declare `EXPOSE 8080` and `STOPSIGNAL SIGTERM`.

#### Scenario: Containerfile EXPOSEs 8080

- **WHEN** the root `Containerfile`'s `EXPOSE` directive is examined
- **THEN** the value SHALL be `8080`

#### Scenario: Containerfile sets STOPSIGNAL SIGTERM

- **WHEN** the root `Containerfile`'s `STOPSIGNAL` directive is examined
- **THEN** the value SHALL be `SIGTERM`

### R17: BuildKit Cache Mounts

All dependency installation steps (apt-get in Rust Containerfile, deno cache) SHOULD use BuildKit `--mount=type=cache` to speed up rebuilds. Cache mount IDs MUST include `$TARGETARCH$TARGETVARIANT` to support multi-architecture builds.

### R18: README.md Updates — Root

The root `README.md` MUST be updated to:
- **Remove** the Rust toolchain from the quick start prerequisites (only Deno is required for the main app)
- Remove the `cargo build --release` step from the quick start
- Reference the pre-built binary in `plugins/state/state-patches`
- Add container build and run instructions as an alternative deployment path

### R19: README.md Updates — Plugin

The `plugins/state/README.md` MUST be updated to:
- Document how to build the binary via the Rust Containerfile with `--output` extraction
- Include the Rust toolchain requirement (moved from root README — Rust is only needed for plugin development)
- Document the new binary output path at `plugins/state/state-patches` (not inside `rust/target/`)

### R20: AGENTS.md Update

The project's `AGENTS.md` MUST be updated to include:
- Container build commands for both Containerfiles (Rust binary builder + main app)
- Container run command with required environment variables (no `HTTP_ONLY`, `CERT_FILE`, or `KEY_FILE`)
- Volume mount instructions for `playground/` only (no optional TLS cert mount — the application no longer terminates TLS in-pod)
- The published container port SHALL be documented as `8080`, NOT `8443`
- The local default URL SHALL be documented as `http://localhost:8080`, NOT `https://localhost:8443`

#### Scenario: AGENTS.md no longer documents TLS cert mount

- **WHEN** `AGENTS.md` is searched for `HTTP_ONLY`, `CERT_FILE`, `KEY_FILE`, `/certs`, `https://localhost:8443`, or `8443`
- **THEN** none of those strings SHALL appear (except where part of an unrelated outbound URL like `https://openrouter.ai`)

#### Scenario: AGENTS.md documents plain-HTTP defaults

- **WHEN** `AGENTS.md`'s container-run example is examined
- **THEN** it SHALL reference port `8080` and `http://localhost:8080`, AND its volume-mount section SHALL only list `playground/` (no optional `/certs` mount)

### R21: .gitignore Update

The `.gitignore` MUST be updated to ensure `plugins/state/state-patches` (the pre-built binary) is NOT ignored. If there is a pattern that would match it, an explicit negation (`!plugins/state/state-patches`) MUST be added.

### Requirement: Containerization acceptance criteria

The containerization capability's acceptance criteria SHALL reflect the plain-HTTP-only contract:

- The built image SHALL listen on port `8080` after start (NOT `8443`)
- There SHALL be no acceptance criterion that requires "auto-generated TLS certificates allow HTTPS connections" — auto-generated TLS is removed from the application
- All other acceptance criteria (`dumb-init` is PID 1, non-root UID 1001 + GID 0, `LABEL` last, no playground/`.env`/`.certs/`/Rust source / dev files in image, `handler.js` resolves the binary, READMEs do not require Rust toolchain for quick start, plugin README documents Containerfile build) SHALL remain in force

#### Scenario: Built image listens on 8080

- **WHEN** the built image is started without env overrides for `PORT`
- **THEN** the running container SHALL listen on TCP port `8080` and SHALL respond to plain-HTTP requests

#### Scenario: No HTTPS acceptance criterion remains

- **WHEN** the containerization spec's acceptance-criteria section is examined
- **THEN** there SHALL be no acceptance criterion that requires HTTPS connections, self-signed cert generation, or `/certs` directory existence

## Acceptance Criteria

1. `podman build --output=. --target=binary -f plugins/state/rust/Containerfile plugins/state/rust/` produces a working static binary
2. The binary at `plugins/state/state-patches` can be committed to git
3. `podman build -t heartreverie:latest .` completes successfully (Deno-only, no Rust build)
4. The built image starts and the Deno server listens on port 8080
5. The `state-patches` binary is executable and at `/app/plugins/state/state-patches` inside the container
6. The container runs as non-root (UID 1001, GID 0)
7. `dumb-init` is PID 1 inside the running container
8. `LABEL` is the last instruction in the root Containerfile
9. The image does not contain playground data, `.env`, `.certs/`, Rust source code, or development-only files
10. `handler.js` correctly resolves the binary at `plugins/state/state-patches`
11. Root `README.md` does not require Rust toolchain for quick start
12. Plugin `README.md` documents the Containerfile build workflow

