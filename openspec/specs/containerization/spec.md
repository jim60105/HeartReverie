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
4. **`final`** — Base `docker.io/denoland/deno:debian`, installs `openssl` (not pre-installed in the deno:debian image, required by entrypoint.sh for TLS cert generation), assembles the runtime image with all application files. Copies the built frontend from the `frontend-build` stage.

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

- The `download` stage MUST download the `dumb-init` static binary appropriate for the target architecture
- Architecture mapping MUST handle at least `amd64` → `x86_64` and `arm64` → `aarch64`
- The download MUST include SHA256 checksum verification for integrity
- The binary MUST be COPYd from the `download` stage into the `final` stage (since `deno:debian` lacks `curl`)
- `dumb-init` MUST be used as PID 1 in the container `ENTRYPOINT` to ensure proper signal forwarding and zombie reaping
- In local development, the entrypoint script MUST gracefully skip `dumb-init` when it is not available

### R12: TLS Certificate Handling and HTTP_ONLY Mode

- An `entrypoint.sh` script MUST be provided that handles both container and local development startup
- When `HTTP_ONLY=true` environment variable is set, the entrypoint MUST skip TLS certificate generation entirely and the server MUST start in plain HTTP mode. This supports Kubernetes deployments where TLS termination is handled at the ingress/reverse-proxy level (e.g., Traefik, Nginx Ingress).
- If `CERT_FILE` and `KEY_FILE` environment variables are set and point to existing files, the entrypoint MUST use them directly
- If either is not set or the files don't exist, the entrypoint MUST auto-detect the certificate directory: `/certs/` in container (when the directory exists), or `$CERT_DIR` / `.certs/` for local development
- The entrypoint MUST reuse existing certificates if they already exist in the cert directory, only generating new ones when missing
- Certificate generation MUST use `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1` and set `CERT_FILE`/`KEY_FILE` accordingly
- The `openssl` package MUST be explicitly installed in the final stage (it is NOT pre-installed in `deno:debian`)
- The generated certificates MUST be placed in a directory writable by the non-root user
- The entrypoint MUST use `dumb-init` as PID 1 when available (container), or `exec deno run` directly when `dumb-init` is not present (local dev)
- The entrypoint MUST `exec` the final command to ensure proper signal handling
- The script MUST use `#!/bin/sh` and `set -eu` for POSIX portability
- The server MUST listen on `::` (dual-stack IPv4+IPv6) instead of `0.0.0.0` (IPv4-only) to support clients that connect via IPv6

### R12a: Unified Startup Scripts

- The `entrypoint.sh` MUST work for both container and local development environments
- A thin wrapper script (`scripts/serve.sh`) MAY exist for local development convenience, setting project-relative environment variables (`PORT`, `PLAYGROUND_DIR`, `READER_DIR`, `CERT_DIR`) and delegating to `entrypoint.sh`
- The wrapper script MUST NOT duplicate any cert generation or server startup logic — all such logic MUST be in `entrypoint.sh`

### R13: OCI Labels

- `LABEL` instructions MUST be the very last instructions in the root Containerfile
- Labels MUST reference `ARG VERSION` and `ARG RELEASE` declared immediately before
- Labels MUST include at minimum: `org.opencontainers.image.title`, `org.opencontainers.image.description`, `org.opencontainers.image.version`, `org.opencontainers.image.licenses`

### R14: Instruction Ordering in Final Stage

The root Containerfile's `final` stage MUST follow this instruction order:
1. Cleanup and dependency installation (dumb-init download)
2. User creation
3. Directory creation
4. `COPY` instructions (deps cache, binary, app files, entrypoint, license)
5. `ENV` instructions
6. `WORKDIR`
7. `VOLUME`
8. `EXPOSE`
9. `USER`
10. `STOPSIGNAL`
11. `ENTRYPOINT` / `CMD`
12. `ARG VERSION` + `ARG RELEASE`
13. `LABEL` (very last)

### R15: .containerignore

A `.containerignore` file MUST exclude at minimum:
- `.git/`, `.gitignore`
- `.certs/`, `.env`
- `playground/`
- `tmp/`
- `plugins/state/rust/` — Rust source not needed (pre-built binary is at plugin root)
- `openspec/`, `docs/`, `tests/`, `skills/`
- OS/editor artifacts (`.DS_Store`, `*.swp`, `Thumbs.db`)
- `node_modules/`

### R16: Exposed Port and Signal

- The root Containerfile MUST declare `EXPOSE 8443`
- The root Containerfile MUST declare `STOPSIGNAL SIGTERM`

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
- Container run command with required environment variables
- Volume mount instructions for `playground/` and optional TLS certs

### R21: .gitignore Update

The `.gitignore` MUST be updated to ensure `plugins/state/state-patches` (the pre-built binary) is NOT ignored. If there is a pattern that would match it, an explicit negation (`!plugins/state/state-patches`) MUST be added.

## Acceptance Criteria

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
