# Proposal: Containerfile

## Why

HeartReverie currently requires both Deno and the Rust toolchain on the host machine for deployment. This creates unnecessary friction — Rust is only needed to compile the `state-patches` plugin binary, not to run the main application. By decoupling the Rust build into a separate Containerfile and committing the pre-built binary to git, we achieve:

- **Simplified deployment** — the main app only needs Deno; Rust is only required for plugin development
- **Reproducible builds** — the root Containerfile produces a Deno-only image with all dependencies pinned
- **Portable binary workflow** — the Rust binary is built via a dedicated Containerfile with `--output` extraction, then committed to git so the root Containerfile simply COPYs it
- **Security** — non-root execution, dumb-init as PID 1, minimal attack surface

## What Changes

1. **New root `Containerfile`** — Deno-only multi-stage build (NO Rust build stage):
   - `deno-cache`: pre-caches all Deno dependencies from `deno.json` + `deno.lock`
   - `final`: assembles the runtime image with Deno, the pre-built Rust binary (COPYd from source tree), application files, dumb-init, and an entrypoint script

2. **New `plugins/state-patches/rust/Containerfile`** — Rust CLI builder using the cargo-chef pattern:
   - `chef` → `planner` → `cook` → `builder` → `binary` (scratch stage for `--output` extraction)
   - Users run `podman build --output=. --target=binary` to extract the binary to `plugins/state-patches/state-patches`

3. **New `entrypoint.sh`** — Shell script that generates self-signed TLS certificates at startup when `CERT_FILE`/`KEY_FILE` are not provided, then exec's the Deno server via dumb-init

4. **New `.dockerignore`** — Excludes development artifacts, playground data, `.certs/`, `.env`, and other unnecessary files from the build context

5. **Updated `plugins/state-patches/handler.js`** — Change binary path from `plugins/state-patches/rust/target/release/state-patches` to `plugins/state-patches/state-patches`

6. **Updated `plugins/state-patches/README.md`** — Document how to build the binary via Containerfile + `--output` extraction; add Rust toolchain info moved from root README

7. **Updated root `README.md`** — Remove Rust requirement from quick start; reference the pre-built binary instead

8. **Updated `AGENTS.md`** — Document container build and run instructions for both Containerfiles

## Capabilities

### New Capabilities
- `containerization`: Container image build configuration for the HeartReverie application (root Deno-only Containerfile) and Rust CLI binary builder (plugin Containerfile with `--output` extraction)

### Modified Capabilities
- `state-patches-modules`: Handler binary path changes from `plugins/state-patches/rust/target/release/state-patches` to `plugins/state-patches/state-patches`; binary is now committed to git as a pre-built artifact

## Impact

### New Files
| File | Purpose |
|------|---------|
| `Containerfile` | Root Deno-only multi-stage OCI container build |
| `plugins/state-patches/rust/Containerfile` | Rust CLI cargo-chef builder with binary extraction stage |
| `entrypoint.sh` | Runtime TLS cert generation and process startup |
| `.dockerignore` | Build context exclusion rules |
| `plugins/state-patches/state-patches` | Pre-built Rust binary (committed to git) |

### Modified Files
| File | Change |
|------|--------|
| `plugins/state-patches/handler.js` | Change binary path to `plugins/state-patches/state-patches` |
| `plugins/state-patches/README.md` | Add Containerfile build docs, Rust toolchain info |
| `README.md` | Remove Rust requirement from quick start |
| `AGENTS.md` | Add container build/run instructions section |
| `.gitignore` | Ensure `plugins/state-patches/state-patches` is NOT ignored |

### Dependencies
- Root Containerfile build-time: `docker.io/denoland/deno:debian` (Deno cache + final stages)
- Root Containerfile runtime: `dumb-init` static binary (downloaded during build), `openssl` (already in Debian base for TLS cert generation)
- Rust Containerfile build-time: `docker.io/lukemathwalker/cargo-chef:latest-rust-slim` (cargo-chef stages)

### No Impact On
- Application logic (`writer/server.js`, `reader/`)
- Prompt templates (`system.md`)
- Test suite
- Existing host-based development workflow (`serve.zsh`)
