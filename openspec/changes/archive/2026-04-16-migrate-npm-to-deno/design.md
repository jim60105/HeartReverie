# Design: Migrate Frontend from npm to Deno-Native Toolchain

## Context

The HeartReverie project currently operates a split dependency management strategy:

- **Backend** (`writer/`): Fully Deno-native. All dependencies are declared as `jsr:` or `npm:` specifiers in the root `deno.json` imports. No `package.json` involved.
- **Frontend** (`reader-src/`): Uses a conventional `package.json` with `npm ci` / `npx` for Vue 3, Vite, Vitest, Tailwind CSS, and related tooling. This requires a separate Node.js runtime.

This split manifests in several places:

1. **`deno.json` tasks** invoke `npx` for frontend commands (`npx vite`, `npx vitest run`).
2. **`Containerfile`** maintains a dedicated `FROM node:22-slim AS frontend-build` stage that runs `npm ci` and `npm run build`, separate from the Deno cache stage.
3. **CI workflows** (`.github/workflows/`) require both Deno and Node.js setup steps.
4. **Developer environment** requires both Deno and Node.js/npm installed locally.

Deno 2.x provides first-class npm compatibility through `npm:` specifiers, making the separate Node.js toolchain unnecessary for this project.

## Goals / Non-Goals

**Goals:**

- Eliminate `package.json`, `package-lock.json`, and `node_modules/` from the project
- Consolidate all dependency declarations into the root `deno.json` using `npm:` specifiers
- Simplify the Containerfile to a single runtime (Deno) for both backend caching and frontend builds
- Reduce CI workflow complexity by removing Node.js setup and npm caching steps
- Maintain identical frontend build output and runtime behavior

**Non-Goals:**

- Migrating away from Vite, Vitest, or any existing frontend libraries
- Rewriting frontend source code (Vue SFCs, composables, etc.)
- Changing the Vue 3 Composition API architecture
- Adopting Deno-native alternatives to npm packages (e.g., replacing `marked` with a Deno-native markdown parser)
- Modifying the plugin system's frontend module loading mechanism

## Decisions

### 1. Dependency Declaration Strategy

**Decision:** Move all npm packages from `reader-src/package.json` into `deno.json` imports using `npm:` specifiers.

**Rationale:** Deno 2.x resolves `npm:` specifiers transparently, caching packages in `~/.cache/deno/npm/`. This eliminates the need for a separate `node_modules/` tree and `npm install` step. The root `deno.json` already serves as the project's import map for backend dependencies — extending it to cover frontend packages creates a single source of truth.

**What this looks like in `deno.json`:**

```jsonc
{
  "imports": {
    // Existing backend deps...
    "@hono/hono": "jsr:@hono/hono@^4",
    // New frontend runtime deps
    "vue": "npm:vue@^3.5.13",
    "vue-router": "npm:vue-router@^5.0.4",
    "marked": "npm:marked@^15.0.12",
    "dompurify": "npm:dompurify@^3.3.3",
    // Frontend dev deps (used by vite/vitest at build time)
    "@vitejs/plugin-vue": "npm:@vitejs/plugin-vue@^5.2.3",
    "tailwindcss": "npm:tailwindcss@^3.4.17"
    // ...
  }
}
```

**Alternative considered:** Keep `package.json` but run `deno install` to populate `node_modules/` — rejected because it retains the separate install step and `node_modules/` directory, gaining nothing over the current npm workflow.

### 2. Task Command Migration

**Decision:** Replace `npx` invocations in `deno.json` tasks with `deno run -A npm:` commands.

**New task definitions:**

```jsonc
{
  "tasks": {
    "dev:reader": "cd reader-src && deno run -A npm:vite@^6.3.2",
    "build:reader": "cd reader-src && deno run -A npm:vue-tsc@^2.2.8 --noEmit && deno run -A npm:vite@^6.3.2 build --outDir ../reader-dist",
    "test:frontend": "cd reader-src && deno run -A npm:vitest@^3.1.2 run",
    "test": "deno test --allow-read --allow-write --allow-env --allow-net --allow-run tests/writer/ && cd reader-src && deno run -A npm:vitest@^3.1.2 run"
  }
}
```

**Rationale:** `deno run -A npm:<package>@<version>` invokes the package CLI through Deno's npm compatibility. Version ranges MUST be pinned explicitly in task commands because `deno run npm:<pkg>` resolves independently from `deno.json` imports — the import map only affects `import` statements in source code, not CLI invocations. The `-A` flag grants all permissions, which is acceptable for build tooling that needs filesystem access, network access (for dev server proxy), and environment variables. The `test` task chains backend and frontend tests and MUST also be updated.

### 3. Vite Configuration Compatibility

**Decision:** Replace `__dirname` with `import.meta.dirname` in `vite.config.ts`.

**Current code:**

```ts
import { resolve } from "node:path";
// ...
alias: { "@": resolve(__dirname, "src") }
```

**New code:**

```ts
import { resolve } from "node:path";
// ...
alias: { "@": resolve(import.meta.dirname!, "src") }
```

**Rationale:** `__dirname` is a Node.js CJS global not available in Deno's ESM context. `import.meta.dirname` is the standard ESM equivalent, supported by both Deno and Node.js 21+. The `node:path` import is kept as-is since Deno fully supports Node.js built-in modules via the `node:` prefix.

### 4. TypeScript Configuration Updates

**Decision:** Remove `node_modules` from `tsconfig.json` exclude and adjust vitest type references.

**Changes to `reader-src/tsconfig.json`:**

- Remove `"exclude": ["node_modules"]` — no `node_modules/` directory exists to exclude.
- The `"types": ["vitest/globals"]` entry may need verification. If Deno's module resolution cannot locate vitest's type declarations through this path, switch to a `/// <reference types="vitest/globals" />` triple-slash directive in a test setup file or `env.d.ts`.

### 5. PostCSS and Tailwind CSS Configuration

**Decision:** Keep `postcss.config.ts` and `tailwind.config.ts` unchanged; verify through testing.

**Rationale:** Both config files use standard ESM exports with no Node.js-specific APIs:

- `postcss.config.ts` declares plugins as `{ tailwindcss: {}, autoprefixer: {} }`
- `tailwind.config.ts` imports only `type { Config }` from tailwindcss

Vite loads these configs internally during the build. Since Deno's npm compat handles Node.js-style resolution for `npm:` packages, the plugin loading chain (Vite → PostCSS → Tailwind/Autoprefixer) should resolve correctly. This is the highest-risk area and must be validated through a full build test before considering the migration complete.

### 6. Containerfile Simplification

**Decision:** Remove the `FROM node:22-slim AS frontend-build` stage. Build the frontend within a Deno-based stage.

**New stage structure (4 stages):**

1. **`download`** — Unchanged (dumb-init download)
2. **`deno-cache`** — Expanded to cache both backend and frontend deps
3. **`frontend-build`** — New Deno-based stage replacing the old Node.js stage
4. **`final`** — Copies frontend from the new Deno-based frontend-build stage

```dockerfile
# Cache stage (expanded for frontend npm deps)
FROM docker.io/denoland/deno:debian AS deno-cache
WORKDIR /app
COPY deno.json deno.lock ./
COPY writer/ ./writer/
COPY reader-src/src/main.ts reader-src/src/
COPY reader-src/vite.config.ts reader-src/tsconfig.json reader-src/tailwind.config.ts reader-src/
RUN deno cache --lock=deno.lock writer/server.ts \
    && deno cache reader-src/src/main.ts

# Frontend build stage (Deno-based, no Node.js)
FROM docker.io/denoland/deno:debian AS frontend-build
COPY --from=deno-cache /deno-dir/ /deno-dir/
COPY reader-src/ /app/reader-src/
COPY deno.json deno.lock /app/
WORKDIR /app/reader-src
RUN deno run -A npm:vue-tsc@^2.2.8 --noEmit \
    && deno run -A npm:vite@^6.3.2 build --outDir ../reader-dist
```

**Rationale:** A separate `frontend-build` stage provides better layer caching granularity — the deno-cache layer only invalidates when `deno.json` or config files change, not when `reader-src/` source files change. The cache stage copies the frontend entry point (`reader-src/src/main.ts`) and config files to resolve the full npm dependency graph (config files alone would not trigger Deno to download runtime deps like `vue`, `vue-router`, `marked`, `dompurify`).

**Layer caching note:** The `deno.lock` file serves a similar role to `package.json` for cache invalidation. Using `--mount=type=cache` for the Deno cache directory can improve rebuild performance.

### 7. CI Workflow Simplification

**Decision:** Remove all Node.js setup and `npm ci` steps from GitHub Actions workflows. Rely solely on Deno setup with dependency caching.

**Affected workflows:**

- `.github/workflows/ci.yaml` — Remove Node.js setup step and npm cache; frontend tests run via `deno task test:frontend`
- `.github/workflows/release.yml` — Remove npm-related build steps
- `.github/workflows/docker-publish-latest.yml` — No change needed (builds via Containerfile)
- `.github/workflows/copilot-setup-steps.yml` — Remove npm install if present

### 8. Lock File Consolidation

**Decision:** Delete `reader-src/package-lock.json`. The `deno.lock` at the project root will expand to cover all npm package resolutions.

**Rationale:** `deno.lock` already tracks integrity hashes for JSR and npm packages used by the backend. Adding frontend npm packages to `deno.json` imports automatically includes them in the lock file. This provides a single lock file for the entire project.

## Risks / Trade-offs

- **[PostCSS/Tailwind plugin resolution may fail through Deno's npm compat]** → Vite loads PostCSS config and resolves plugin packages internally. If Deno's npm resolution doesn't match Node.js's `require()` semantics for these plugins, the build will fail. **Mitigation:** Run a full `deno task build:reader` and inspect the output CSS before considering the migration complete. If resolution fails, explicit `npm:` imports in the config files can force correct resolution.

- **[vue-tsc may have issues under Deno]** → vue-tsc depends heavily on TypeScript's compiler API and the Vue language tools (Volar). These are complex packages with deep Node.js integration. **Mitigation:** Test `deno run -A npm:vue-tsc@^2.2.8 --noEmit` early in implementation. Type checking is a required part of the build pipeline and MUST NOT be dropped. If vue-tsc fails under Deno, investigate the specific error and find a workaround (e.g., explicit type imports, shims) before proceeding.

- **[Vitest globals type resolution]** → The current `"types": ["vitest/globals"]` in `tsconfig.json` relies on `node_modules` resolution. Deno may not resolve this the same way. **Mitigation:** If types break, use a `/// <reference types="vitest/globals" />` directive in `reader-src/env.d.ts` or a test setup file.

- **[Containerfile layer caching granularity reduction]** → The current setup caches `npm ci` independently from source changes (keyed on `package.json` hash). After migration, the Deno cache stage must copy `reader-src/` which changes frequently, potentially invalidating the cache more often. **Mitigation:** Use Docker `--mount=type=cache` for the Deno cache directory (`/deno-dir/`). Consider splitting frontend build into a separate Deno stage if cache invalidation becomes problematic.

- **[deno.lock churn on dependency updates]** → Adding ~15 npm packages to `deno.lock` increases the lock file size and diff noise on updates. **Mitigation:** Acceptable trade-off for toolchain unification. Lock file updates are infrequent and machine-generated.

- **[Developer onboarding simplification]** → This is a positive trade-off: developers only need Deno installed. Node.js/npm is no longer required. The `.gitignore` entry for `node_modules/` becomes vestigial but harmless.
