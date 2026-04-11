# Design: Containerfile

## Overview

The containerization strategy uses **two separate Containerfiles** with distinct responsibilities:

1. **Root `Containerfile`** — A Deno-only container for the main application, with NO Rust build stage. It COPYs a pre-built Rust binary from the source tree.
2. **`plugins/state-patches/rust/Containerfile`** — A Rust CLI builder that compiles the `state-patches` binary and supports `--output` extraction to the host filesystem.

This separation decouples the Rust toolchain from the main application deployment. Rust is only needed for plugin development — not for running or deploying the app.

## Two-Containerfile Architecture Rationale

### Why not a single Containerfile?

A monolithic Containerfile that builds both Deno and Rust has several drawbacks:
- **Slow builds** — Rust compilation is expensive; rebuilding every time a `.js` file changes wastes minutes
- **Unnecessary coupling** — the Rust toolchain is a ~1 GB download that only produces a ~5 MB binary
- **Developer friction** — contributors who only work on the frontend/backend shouldn't need Rust knowledge

### Binary workflow: Build → Extract → Commit → COPY

The binary lifecycle is:

1. **Build**: Run `podman build --output=. --target=binary -f plugins/state-patches/rust/Containerfile plugins/state-patches/rust/` to build the Rust binary inside a container
2. **Extract**: The `--output=.` flag copies the binary from the `scratch`-based `binary` stage to `plugins/state-patches/state-patches` on the host
3. **Commit**: The extracted binary is committed to git (checked into the codebase)
4. **COPY**: The root Containerfile simply `COPY`s this pre-built binary into the image — no Rust build needed

This means the root Containerfile is fast, simple, and Rust-free. The binary only needs to be rebuilt when the Rust source code changes.

## Rust Containerfile Design (`plugins/state-patches/rust/Containerfile`)

### cargo-chef Pattern

The Rust Containerfile follows the cargo-chef pattern for optimal dependency caching:

#### Stage 1: `chef`

Base stage with shared configuration:
- **Base image**: `docker.io/lukemathwalker/cargo-chef:latest-rust-alpine` (musl, statically linked)
- `WORKDIR /app`
- Create `/licenses` directory

#### Stage 2: `planner`

Generates a dependency recipe from project source:
- Bind-mount `Cargo.toml`, `Cargo.lock`, and `src/`
- Run `cargo chef prepare --recipe-path recipe.json`

#### Stage 3: `cook`

Pre-builds dependencies separately from source code:
- Install system build deps (`musl-dev`) with BuildKit apk cache mounts keyed by `$TARGETARCH$TARGETVARIANT`
- Mount `recipe.json` from planner stage
- Run `cargo chef cook --release --locked`

#### Stage 4: `builder`

Builds the actual binary:
- Bind-mount source files (`Cargo.toml`, `Cargo.lock`, `src/`)
- Run `cargo build --release --locked`
- Output: `/app/target/release/state-patches` statically-linked binary

#### Stage 5: `binary`

Extraction stage for `--output` workflow:
- `FROM scratch AS binary`
- `COPY --from=builder` the compiled binary
- Users run `podman build --output=. --target=binary` to extract the binary to the host

### Build Command

```bash
cd plugins/state-patches
podman build --output=. --target=binary -f rust/Containerfile rust/
# Produces: plugins/state-patches/state-patches
```

## Root Containerfile Design

### Stage 1: `deno-cache`

**Base image**: `docker.io/denoland/deno:debian`

Pre-caches all Deno dependencies:
1. Copy `deno.json`, `deno.lock`, and `writer/` directory
2. Run `deno cache --lock=deno.lock writer/server.ts`
3. Output: populated `/deno-dir/` cache directory

### Stage 2: `final`

**Base image**: `docker.io/denoland/deno:debian`

Assembles the runtime image:
1. Download `dumb-init` static binary (architecture-aware via `TARGETARCH` mapping: `amd64` → `x86_64`, `arm64` → `aarch64`)
2. Create non-root user with UID from `$UID` build arg and GID 0
3. Create application directories (`/app`, `/licenses`, `/certs`, `/deno-dir/`)
4. Copy license to `/licenses/`
5. Copy Deno cache from `deno-cache` stage to `/deno-dir/`
6. Copy pre-built Rust binary from source tree to `/app/plugins/state-patches/state-patches`
7. Copy application files (writer, reader, assets, plugins, system.md, deno.json, deno.lock)
8. Copy `entrypoint.sh`
9. Configure ENV, WORKDIR, VOLUME, EXPOSE, USER, STOPSIGNAL, ENTRYPOINT/CMD
10. Apply OCI labels (as the very last instruction per guidelines)

## File Layout in Container

```
/app/                          # WORKDIR
├── writer/                    # Backend server (Hono + Deno)
│   ├── server.js
│   └── lib/
├── reader/                    # Frontend static files
│   ├── index.html
│   └── js/
├── assets/                    # Background images, etc.
├── plugins/                   # Plugin directory
│   └── state-patches/
│       ├── plugin.json
│       ├── handler.js
│       ├── frontend.js
│       ├── state-patches      # Pre-built Rust binary (at plugin root)
│       └── rust/              # Rust source (not included in image)
├── system.md                  # Vento prompt template
├── deno.json                  # Import map + task definitions
├── deno.lock                  # Dependency lock file
└── entrypoint.sh              # TLS cert generation + startup
/deno-dir/                     # Pre-cached Deno dependencies
/licenses/                     # License files (GPL-3.0-or-later)
/certs/                        # TLS certificates (generated or mounted)
```

## TLS Certificate Handling

The `entrypoint.sh` script handles TLS certificate provisioning:

1. **User-provided certs**: If `CERT_FILE` and `KEY_FILE` are set and point to existing files, use them directly
2. **Auto-generated certs**: If not provided, generate a self-signed certificate pair at `/certs/cert.pem` and `/certs/key.pem` using `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 365 -subj '/CN=localhost'`, then set `CERT_FILE` and `KEY_FILE` accordingly

The `openssl` binary is already available in the `denoland/deno:debian` base image. The `/certs/` directory is created during build with appropriate permissions.

The entrypoint script then exec's `dumb-init` → `deno run` with the required permissions. Script uses `#!/bin/sh` and `set -eu` for portability.

## Volume Strategy

| Mount Point | Purpose | Required |
|------------|---------|----------|
| `/app/playground` | Story data directory (series/stories/chapters) | Yes — empty by default, user mounts their data |
| `/certs` | TLS certificate and key files | Optional — auto-generated if not mounted |

The container ships with an empty `/app/playground` directory. Users mount their story data at runtime. This keeps user content completely separate from the application image.

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `LLM_API_KEY` | Yes | — | LLM API key (e.g. OpenRouter) |
| `PASSPHRASE` | Yes | — | API authentication passphrase |
| `PORT` | No | `8443` | Server listen port |
| `OPENROUTER_MODEL` | No | (server default) | LLM model identifier |
| `CERT_FILE` | No | (auto-generated) | Path to TLS certificate file |
| `KEY_FILE` | No | (auto-generated) | Path to TLS private key file |
| `PLUGIN_DIR` | No | — | External plugin directory (mount into container) |
| `PLAYGROUND_DIR` | No | `./playground` | Story data root (relative to WORKDIR) |

## Security Design

### Non-Root Execution
- A dedicated user is created with UID from build arg `$UID` (default 1001) and GID 0
- All application files are owned by `$UID:0` with mode `775`
- Compatible with OpenShift's arbitrary UID assignment (GID 0 ensures group-level access)

### Process Management
- `dumb-init` runs as PID 1 to handle signal forwarding and zombie process reaping
- The Deno process runs as a child of dumb-init
- `STOPSIGNAL SIGTERM` ensures graceful shutdown

### Minimal Permissions
- Deno runs with exactly the permissions it needs: `--allow-net --allow-read --allow-write --allow-env --allow-run`
- No `--allow-all` or `--allow-ffi`
- The `--allow-run` permission is required for the state-patches plugin to execute the Rust binary

### Image Labels
- OCI-standard labels (`org.opencontainers.image.*`) applied as the very last instructions
- `VERSION` and `RELEASE` build args enable proper image versioning

## .dockerignore Strategy

Exclude from build context:
- `.git/`, `.certs/`, `.env` — security-sensitive or unnecessary
- `playground/` — user data, not part of the image
- `tmp/`, `*.swp`, `.DS_Store` — development artifacts
- `plugins/state-patches/rust/` — Rust source not needed (binary is at plugin root)
- `openspec/`, `docs/`, `tests/`, `skills/` — development-only files not needed at runtime
- `node_modules/` — not used in container (Deno caches differently)

## Build and Run Commands

### Rust Binary (one-time or when Rust source changes)

```bash
# Build and extract the binary
cd plugins/state-patches
podman build --output=. --target=binary -f rust/Containerfile rust/
# Binary is now at plugins/state-patches/state-patches
# Commit to git
git add state-patches
git commit -m "chore: rebuild state-patches binary"
```

### Main Application

```bash
# Build
podman build -t heartreverie:latest .

# Run with minimal config
podman run -d \
  -p 8443:8443 \
  -e LLM_API_KEY=sk-... \
  -e PASSPHRASE=mysecret \
  -v ./playground:/app/playground \
  heartreverie:latest

# Run with custom certs
podman run -d \
  -p 8443:8443 \
  -e LLM_API_KEY=sk-... \
  -e PASSPHRASE=mysecret \
  -e CERT_FILE=/certs/cert.pem \
  -e KEY_FILE=/certs/key.pem \
  -v ./playground:/app/playground \
  -v ./my-certs:/certs:ro \
  heartreverie:latest
```

## Handler.js Binary Path Change

The `state-patches` plugin handler currently resolves the binary at:

```
plugins/state-patches/rust/target/release/state-patches
```

This changes to:

```
plugins/state-patches/state-patches
```

This reflects the new workflow where the binary lives at the plugin root, extracted from the Rust Containerfile and committed to git.
