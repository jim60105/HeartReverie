# Tasks: Migrate Frontend from npm to Deno-Native Toolchain

## 1. Dependency and Configuration Migration

- [x] 1.1 Add all frontend npm packages to `deno.json` imports as `npm:` specifiers (vue, vue-router, marked, dompurify, @types/dompurify, vite, vitest, vue-tsc, @vitejs/plugin-vue, @vue/test-utils, autoprefixer, postcss, tailwindcss, happy-dom, typescript)
- [x] 1.2 Update `reader-src/vite.config.ts`: replace `__dirname` with `import.meta.dirname`
- [x] 1.3 Update `reader-src/tsconfig.json`: remove `node_modules` from the `exclude` array
- [x] 1.4 Update `deno.json` task commands: replace `npx` with version-pinned `deno run -A npm:` for `dev:reader`, `build:reader`, `test:frontend`, and the root `test` task
- [x] 1.5 Delete `reader-src/package.json` and `reader-src/package-lock.json`
- [x] 1.6 Delete `reader-src/node_modules/` if it exists locally
- [x] 1.7 Regenerate `deno.lock` to include all frontend npm package resolutions
- [x] 1.8 Run `deno task build:reader` and `deno task test:frontend` to verify frontend builds and tests pass without npm
- [x] 1.9 Verify PostCSS and Tailwind CSS configs load correctly through Deno's npm compat (run build, inspect output CSS)

## 2. Containerfile Simplification

- [x] 2.1 Remove the `FROM node:22-slim AS frontend-build` stage from root `Containerfile`
- [x] 2.2 Expand `deno-cache` stage to copy frontend entry point (`reader-src/src/main.ts`) and config files alongside backend deps to resolve the full npm dependency graph
- [x] 2.3 Add a new `frontend-build` stage using `docker.io/denoland/deno:debian` that runs version-pinned `deno run -A npm:vue-tsc@^2.2.8 --noEmit && deno run -A npm:vite@^6.3.2 build`
- [x] 2.4 Update `final` stage to copy frontend output from the new Deno-based `frontend-build` stage
- [x] 2.5 Update `.containerignore` to remove `node_modules/` entry (vestigial) and verify `reader-src/` is NOT excluded
- [x] 2.6 Run `podman build -t heartreverie:latest .` to verify the container builds successfully

## 3. CI Workflow Updates

- [x] 3.1 Remove Node.js setup and `npm ci` steps from `.github/workflows/ci.yaml`
- [x] 3.2 Remove Node.js setup and `npm ci` steps from `.github/workflows/release.yml`
- [x] 3.3 Remove `npm ci` step from `.github/workflows/copilot-setup-steps.yml` if present
- [x] 3.4 Verify all workflow files contain no references to `npm`, `npx`, `node`, or `package.json`

## 4. Documentation Updates

- [x] 4.1 Update `AGENTS.md`: remove npm/package.json references, document Deno-only frontend workflow
- [x] 4.2 Update `README.md`: remove Node.js/npm from prerequisites, update build instructions
- [x] 4.3 Update `docs/` files if they reference npm, npx, package.json, or node_modules

## 5. Final Verification

- [x] 5.1 Run full test suite (`deno task test`) to verify no regressions
- [x] 5.2 Run `podman build` to verify container image builds end-to-end
- [x] 5.3 Grep the entire repository for stale references to `npm`, `npx`, `package.json`, and `node_modules` (excluding expected entries like `.gitignore` and docs about the migration itself)
