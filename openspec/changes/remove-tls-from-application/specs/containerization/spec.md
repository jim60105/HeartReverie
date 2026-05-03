## REMOVED Requirements

### Requirement: R12: TLS Certificate Handling and HTTP_ONLY Mode

**Reason:** The application no longer terminates TLS in-pod. There is no `entrypoint.sh`, no `openssl` cert generation, no `CERT_FILE` / `KEY_FILE` reads, and no `HTTP_ONLY` toggle. TLS termination is delegated entirely to the operator's reverse proxy / ingress controller. The server speaks plain HTTP on port `8080`.

### Requirement: R12a: Unified Startup Scripts

**Reason:** With `entrypoint.sh` deleted, there is no shared startup script to unify. The Containerfile launches `dumb-init -- deno run …` directly, and `scripts/serve.sh` independently execs `deno run …` for local development. Each launcher is one line of work, so a "unified script" requirement adds no value.

## MODIFIED Requirements

### Requirement: R4: Root Containerfile — Deno-Only Multi-Stage Build

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

### Requirement: R11: dumb-init as PID 1

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

### Requirement: R16: Exposed Port and Signal

The root Containerfile MUST declare `EXPOSE 8080` and `STOPSIGNAL SIGTERM`.

#### Scenario: Containerfile EXPOSEs 8080

- **WHEN** the root `Containerfile`'s `EXPOSE` directive is examined
- **THEN** the value SHALL be `8080`

#### Scenario: Containerfile sets STOPSIGNAL SIGTERM

- **WHEN** the root `Containerfile`'s `STOPSIGNAL` directive is examined
- **THEN** the value SHALL be `SIGTERM`

### Requirement: R9: Application Files in Root Container

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

### Requirement: R14: Instruction Ordering in Final Stage

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

### Requirement: R20: AGENTS.md Update

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

## ADDED Requirements

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
