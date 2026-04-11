# Tasks

## Group 1: Rust Containerfile

- [x] **Task 1.1**: Create `plugins/state-patches/rust/Containerfile` with cargo-chef pattern + binary extraction stage
  - Begin with `# syntax=docker/dockerfile:1` and `ARG UID=1001`
  - Stage `chef`: base `docker.io/lukemathwalker/cargo-chef:latest-rust-slim`, `WORKDIR /app`, `ENV RUSTFLAGS="-C target-feature=+crt-static"`, create `/licenses` dir with `$UID:0` permissions
  - Stage `planner`: bind-mount `Cargo.toml`, `Cargo.lock`, `src/`, run `cargo chef prepare --recipe-path recipe.json`
  - Stage `cook`: declare `ARG TARGETARCH` + `ARG TARGETVARIANT`, install `pkg-config`, `libssl-dev` with BuildKit apt cache mounts keyed by `$TARGETARCH$TARGETVARIANT`, mount `recipe.json` from planner, run `cargo chef cook --release --locked`
  - Stage `builder`: bind-mount source files, run `cargo build --release --locked`
  - Stage `binary`: `FROM scratch AS binary`, `COPY --from=builder /app/target/release/state-patches /state-patches` — this is the extraction target for `--output`
  - Separate each stage with 40 `#` characters
  - Ref: R2, R3, R5, R17

## Group 2: Root Containerfile

- [x] **Task 2.1**: Create root `Containerfile` with deno-cache + final stages (Deno-only, NO Rust build)
  - Begin with `# syntax=docker/dockerfile:1`, `ARG UID=1001`, `ARG VERSION=EDGE`, `ARG RELEASE=0`
  - Stage `deno-cache`: base `docker.io/denoland/deno:debian`, copy `deno.json`, `deno.lock`, `writer/`, run `deno cache --lock=deno.lock writer/server.ts`
  - Stage `final`: base `docker.io/denoland/deno:debian`
    - Download `dumb-init` static binary (arch-aware: `amd64` → `x86_64`, `arm64` → `aarch64`) via curl
    - Create non-root user (`$UID:0` OpenShift compatible)
    - Create directories (`/app`, `/licenses`, `/certs`, `/deno-dir/`, `/app/playground`)
    - Copy license to `/licenses/LICENSE`
    - Copy Deno cache from `deno-cache` stage to `/deno-dir/`
    - Copy pre-built Rust binary from `plugins/state-patches/state-patches` to `/app/plugins/state-patches/state-patches`
    - Copy app files (`writer/`, `reader/`, `assets/`, `plugins/`, `system.md`, `deno.json`, `deno.lock`) — use `--link --chown=$UID:0 --chmod=775`
    - Copy `entrypoint.sh`
    - Follow instruction ordering: user → dirs → COPY → ENV → WORKDIR → VOLUME → EXPOSE → USER → STOPSIGNAL → ENTRYPOINT/CMD → ARG VERSION/RELEASE → LABEL (last)
  - Separate stages with 40 `#` characters
  - Ref: R1, R4, R5, R6, R7, R9, R10, R11, R13, R14, R16

## Group 3: Entrypoint

- [x] **Task 3.1**: Create `entrypoint.sh` script for TLS cert auto-generation
  - Use `#!/bin/sh` and `set -eu` for portability
  - Check if `CERT_FILE` and `KEY_FILE` env vars are set and files exist
  - If missing, generate self-signed cert+key via `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 365 -subj '/CN=localhost'` to `/certs/cert.pem` and `/certs/key.pem`, export `CERT_FILE` and `KEY_FILE`
  - `exec` dumb-init with deno run command and all required permissions (`--allow-net --allow-read --allow-write --allow-env --allow-run`)
  - Ref: R12

## Group 4: Binary Workflow

- [x] **Task 4.1**: Build the Rust binary via Containerfile and place at `plugins/state-patches/state-patches`
  - Run `podman build --output=. --target=binary -f rust/Containerfile rust/` from `plugins/state-patches/` directory
  - Verify the binary is produced at `plugins/state-patches/state-patches` (at plugin root, NOT inside `rust/target/`)
  - Ref: R3

- [x] **Task 4.2**: Update `.gitignore` to NOT ignore the pre-built binary
  - If any existing pattern matches `plugins/state-patches/state-patches`, add an explicit negation
  - The binary must be committed to git
  - Ref: R21

## Group 5: Handler Update

- [x] **Task 5.1**: Update `plugins/state-patches/handler.js` binary path
  - Change `path.join(context.rootDir, 'plugins', 'state-patches', 'rust', 'target', 'release', 'state-patches')` to `path.join(context.rootDir, 'plugins', 'state-patches', 'state-patches')`
  - Ref: R8

## Group 6: Documentation

- [x] **Task 6.1**: Update `plugins/state-patches/README.md`
  - Update the "建置 Rust 二進位檔" section to document the Containerfile build workflow:
    - Build command: `podman build --output=. --target=binary -f rust/Containerfile rust/`
    - Output path: `plugins/state-patches/state-patches` (at plugin root)
  - Add Rust toolchain requirement info (moved from root README — Rust is only needed for plugin development, not for running the main app)
  - Keep alternative: native `cargo build --release` is still supported for developers with Rust installed
  - Ref: R19

- [x] **Task 6.2**: Update root `README.md` quick start section
  - Remove Rust from prerequisites (only Deno ≥ 2.0 is required)
  - Remove the `cd plugins/state-patches/rust && cargo build --release && cd ../../..` step
  - Note that the pre-built `state-patches` binary is included in the repository
  - Add container deployment as an alternative section
  - Ref: R18

- [x] **Task 6.3**: Update `AGENTS.md` with container build and run instructions
  - Document the two-Containerfile architecture
  - Rust binary build: `podman build --output=. --target=binary -f plugins/state-patches/rust/Containerfile plugins/state-patches/rust/`
  - Main app build: `podman build -t heartreverie:latest .`
  - Run command with required env vars (`OPENROUTER_API_KEY`, `PASSPHRASE`), volume mounts for `playground/` and optional TLS certs
  - Ref: R20

## Group 7: Supporting Files

- [x] **Task 7.1**: Create `.dockerignore` to exclude unnecessary files
  - Exclude: `.git/`, `.gitignore`, `.certs/`, `.env`, `playground/`, `tmp/`, `plugins/state-patches/rust/` (Rust source not needed — binary is at plugin root), `openspec/`, `docs/`, `tests/`, `skills/`, `node_modules/`, `*.swp`, `*.swo`, `.DS_Store`, `Thumbs.db`, `serve.zsh`, `AGENTS.md`, `.github/`
  - Ref: R15

## Group 8: Verification

- [x] **Task 8.1**: Verify Rust Containerfile builds and produces binary
  - Run `podman build --output=. --target=binary -f plugins/state-patches/rust/Containerfile plugins/state-patches/rust/`
  - Confirm binary is output at `plugins/state-patches/state-patches`
  - Verify the binary is statically linked (`file` or `ldd`)

- [x] **Task 8.2**: Build root container image and verify it starts correctly
  - Run `podman build -t heartreverie:latest .` and confirm successful build
  - Verify `LABEL` is the last instruction (inspect Containerfile)
  - Verify `dumb-init` is present and executable in the image
  - Verify the `state-patches` binary exists at `/app/plugins/state-patches/state-patches`
  - Verify the container runs as non-root user
  - Verify TLS auto-generation works when no certs are provided
  - Ref: Acceptance Criteria in spec

- [x] **Task 8.3**: Verify handler.js uses the correct binary path
  - Confirm `handler.js` resolves to `plugins/state-patches/state-patches`
  - Confirm the `.dockerignore` excludes Rust source but NOT the pre-built binary
