## Why

The frontend (`reader-src/`) currently manages dependencies via a separate `package.json` with `npm ci` / `npx` commands, while the backend already uses Deno-native dependency management. Deno 2.x has first-class npm compatibility (`npm:` specifiers in `deno.json`), making a separate Node.js toolchain unnecessary. Consolidating everything under Deno eliminates the dual package-manager workflow, simplifies the Containerfile (no Node.js build stage), and reduces CI setup complexity.

No backward compatibility concerns — the project is pre-release with zero users in the wild.

## What Changes

- **BREAKING**: Remove `reader-src/package.json` and `reader-src/package-lock.json` — all frontend dependencies move into the root `deno.json` import map using `npm:` specifiers
- **BREAKING**: Remove `reader-src/node_modules/` from the workflow — Deno caches npm packages in its own cache directory
- Replace all `npx vite`, `npx vitest`, `npx vue-tsc` invocations with `deno run` equivalents in `deno.json` tasks
- Update `reader-src/tsconfig.json` to remove `node_modules` exclusion (no longer exists)
- Update `reader-src/vite.config.ts` for Deno compatibility (use `import.meta.dirname` instead of `__dirname`)
- Simplify `Containerfile`: remove the Node.js `frontend-build` stage — Deno handles both backend caching and frontend building
- Update all GitHub Actions workflows (`.github/workflows/`) to remove `npm ci` steps and rely on Deno dependency caching only
- Update documentation (`docs/`, `AGENTS.md`, `README.md`) to reflect the unified Deno toolchain

## Capabilities

### New Capabilities
- `deno-frontend-toolchain`: Unified Deno-based frontend dependency management and build toolchain, replacing the npm/Node.js workflow for the Vue 3 frontend

### Modified Capabilities
- `containerization`: Containerfile simplification — remove the Node.js frontend-build stage, build frontend within the Deno stage
- `vue-frontend-tests`: Test execution changes from `npx vitest` to Deno-based vitest invocation

## Impact

- **Build toolchain**: `package.json`, `package-lock.json`, and `node_modules/` are eliminated
- **`deno.json`**: Gains all frontend npm dependencies (vue, vue-router, marked, dompurify, vite, vitest, etc.) as `npm:` imports; tasks updated to use `deno run` instead of `npx`
- **`Containerfile`**: The `frontend-build` stage (FROM node:22-slim) is removed; frontend build moves into the Deno cache or final stage
- **CI workflows**: `ci.yaml`, `release.yml`, `copilot-setup-steps.yml` — remove `npm ci` steps, update caching to Deno-only
- **Documentation**: `AGENTS.md` (project structure, tech stack, code style), `docs/plugin-system.md` (if npm references exist)
- **Developer experience**: Single `deno task` commands for all operations — no need for Node.js/npm installation
