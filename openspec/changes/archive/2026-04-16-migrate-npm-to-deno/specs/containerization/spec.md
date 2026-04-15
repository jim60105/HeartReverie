# Delta Spec: containerization

## MODIFIED Requirements

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
