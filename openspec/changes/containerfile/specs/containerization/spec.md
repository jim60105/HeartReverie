# Spec: containerization (delta)

> Delta spec for the `containerfile` change. Defines requirements for containerizing the HeartReverie application using a two-Containerfile architecture: a Deno-only root Containerfile and a separate Rust CLI builder.

## Requirements

### R1: Two-Containerfile Architecture

The containerization MUST use two separate Containerfiles:

1. **Root `Containerfile`** — Deno-only container for the main application. MUST NOT contain any Rust build stages. The Rust binary is COPYd from the source tree as a pre-built artifact.
2. **`plugins/state-patches/rust/Containerfile`** — Rust CLI builder that compiles the `state-patches` binary and supports `--output` extraction.

### R2: Rust Containerfile — cargo-chef Pattern

The Rust Containerfile at `plugins/state-patches/rust/Containerfile` MUST use the cargo-chef pattern with the following stages:

1. **`chef`** — Base stage from `docker.io/lukemathwalker/cargo-chef:latest-rust-alpine` (musl, statically linked) with `WORKDIR /app` and `/licenses` directory creation
2. **`planner`** — Runs `cargo chef prepare --recipe-path recipe.json` with bind-mounted source files (`Cargo.toml`, `Cargo.lock`, `src/`)
3. **`cook`** — Installs system build dependencies (`pkg-config`, `libssl-dev`) with BuildKit apt cache mounts keyed by `$TARGETARCH$TARGETVARIANT`, mounts recipe from planner, runs `cargo chef cook --release --locked`
4. **`builder`** — Builds the binary via `cargo build --release --locked` with bind-mounted source files
5. **`binary`** — `FROM scratch AS binary`, COPYs the compiled binary from the builder stage for `--output` extraction

The `binary` stage MUST be the last stage in the Rust Containerfile. It MUST NOT have a `final` stage — the Rust Containerfile is a builder only, not a runtime image.

### R3: Rust Binary Extraction Workflow

The Rust Containerfile MUST support the `--output` flag for binary extraction:

```bash
cd plugins/state-patches
podman build --output=. --target=binary -f rust/Containerfile rust/
```

This command MUST produce the binary at `plugins/state-patches/state-patches` (at the plugin root, NOT inside `rust/target/`).

The extracted binary MUST be committed to git so that:
- The root Containerfile can COPY it without needing Rust
- Developers without the Rust toolchain can still build and run the main application

### R4: Root Containerfile — Deno-Only Multi-Stage Build

The root `Containerfile` MUST use a multi-stage build with these stages:

**Deno cache stage:**
1. **`deno-cache`** — Base `docker.io/denoland/deno:debian`, copies `deno.json`, `deno.lock`, and `writer/`, runs `deno cache --lock=deno.lock writer/server.ts`

**Final stage:**
2. **`final`** — Base `docker.io/denoland/deno:debian`, assembles the runtime image with all application files

The `final` stage MUST be the last stage in the root Containerfile.

### R5: Containerfile Syntax and Structure

Both Containerfiles MUST follow these conventions:
- Begin with `# syntax=docker/dockerfile:1`
- Declare `ARG UID=1001`, `ARG VERSION=EDGE`, and `ARG RELEASE=0` at the top level (root Containerfile). The Rust Containerfile MUST declare `ARG UID=1001` for license directory permissions.
- Build stages MUST be separated by a line of exactly 40 `#` characters
- Files MUST be named `Containerfile` (not `Dockerfile`)

### R6: Deno Dependency Caching

- The `deno-cache` stage MUST use `docker.io/denoland/deno:debian` as base image
- The stage MUST copy `deno.json`, `deno.lock`, and the `writer/` directory
- The stage MUST run `deno cache --lock=deno.lock writer/server.ts` to populate the cache
- The cached dependencies MUST be copied to the final stage at `/deno-dir/`

### R7: Rust Binary Placement in Container

The pre-built `state-patches` binary MUST be placed at `/app/plugins/state-patches/state-patches` in the final image. This path corresponds to the updated `handler.js` which resolves the binary at `plugins/state-patches/state-patches` relative to `context.rootDir`.

### R8: Handler.js Binary Path Change

The `state-patches` plugin handler (`plugins/state-patches/handler.js`) MUST be updated to resolve the binary path as:

```javascript
path.join(context.rootDir, 'plugins', 'state-patches', 'state-patches')
```

Instead of the current path:

```javascript
path.join(context.rootDir, 'plugins', 'state-patches', 'rust', 'target', 'release', 'state-patches')
```

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

Note: `plugins/state-patches/rust/` (Rust source) does NOT need to be included in the root container image. The `.dockerignore` SHOULD exclude it. Only the pre-built binary at `plugins/state-patches/state-patches` needs to be present.

### R10: Non-Root User Execution

- The final stage MUST create a non-root user with UID from the `$UID` build arg (default 1001) and GID 0
- The `USER` instruction MUST use the format `$UID:0` for OpenShift arbitrary UID compatibility
- All application files and directories MUST be owned by `$UID:0`

### R11: dumb-init as PID 1

- The final stage MUST download the `dumb-init` static binary appropriate for the target architecture
- Architecture mapping MUST handle at least `amd64` → `x86_64` and `arm64` → `aarch64`
- `dumb-init` MUST be used as PID 1 in the `ENTRYPOINT` to ensure proper signal forwarding and zombie reaping

### R12: TLS Certificate Handling

- An `entrypoint.sh` script MUST be provided that handles TLS certificate provisioning
- If `CERT_FILE` and `KEY_FILE` environment variables are set and point to existing files, the entrypoint MUST use them directly
- If either is not set or the files don't exist, the entrypoint MUST generate a self-signed certificate and key using `openssl req` and set `CERT_FILE`/`KEY_FILE` accordingly
- The generated certificates MUST be placed in a directory writable by the non-root user (e.g., `/certs/`)
- The entrypoint MUST `exec` the final command (dumb-init + deno) to ensure proper signal handling
- The script MUST use `#!/bin/sh` and `set -eu` for portability

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

### R15: .dockerignore

A `.dockerignore` file MUST exclude at minimum:
- `.git/`, `.gitignore`
- `.certs/`, `.env`
- `playground/`
- `tmp/`
- `plugins/state-patches/rust/` — Rust source not needed (pre-built binary is at plugin root)
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
- Reference the pre-built binary in `plugins/state-patches/state-patches`
- Add container build and run instructions as an alternative deployment path

### R19: README.md Updates — Plugin

The `plugins/state-patches/README.md` MUST be updated to:
- Document how to build the binary via the Rust Containerfile with `--output` extraction
- Include the Rust toolchain requirement (moved from root README — Rust is only needed for plugin development)
- Document the new binary output path at `plugins/state-patches/state-patches` (not inside `rust/target/`)

### R20: AGENTS.md Update

The project's `AGENTS.md` MUST be updated to include:
- Container build commands for both Containerfiles (Rust binary builder + main app)
- Container run command with required environment variables
- Volume mount instructions for `playground/` and optional TLS certs

### R21: .gitignore Update

The `.gitignore` MUST be updated to ensure `plugins/state-patches/state-patches` (the pre-built binary) is NOT ignored. If there is a pattern that would match it, an explicit negation (`!plugins/state-patches/state-patches`) MUST be added.

## Acceptance Criteria

1. `podman build --output=. --target=binary -f plugins/state-patches/rust/Containerfile plugins/state-patches/rust/` produces a working static binary
2. The binary at `plugins/state-patches/state-patches` can be committed to git
3. `podman build -t heartreverie:latest .` completes successfully (Deno-only, no Rust build)
4. The built image starts and the Deno server listens on port 8443
5. The `state-patches` binary is executable and at `/app/plugins/state-patches/state-patches` inside the container
6. Auto-generated TLS certificates allow HTTPS connections
7. The container runs as non-root (UID 1001, GID 0)
8. `dumb-init` is PID 1 inside the running container
9. `LABEL` is the last instruction in the root Containerfile
10. The image does not contain playground data, `.env`, `.certs/`, Rust source code, or development-only files
11. `handler.js` correctly resolves the binary at `plugins/state-patches/state-patches`
12. Root `README.md` does not require Rust toolchain for quick start
13. Plugin `README.md` documents the Containerfile build workflow
